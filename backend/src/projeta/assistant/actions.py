"""Ações que o assistente pode propor: o que a pessoa faz pela interface, pelos MESMOS serviços.

Cada ação liga um formato validado (pydantic, só IDs — nomes já foram resolvidos pelas
ferramentas) a uma chamada de serviço. Nada aqui decide permissão: quem decide é o serviço,
exatamente como na rota da API. Este módulo só acrescenta duas camadas de defesa:

- escopo: todo ID citado precisa pertencer ao espaço da conversa (`_check_scope`);
- simulação: `dry_run` executa o plano dentro de um SAVEPOINT desfeito, para a pessoa ver na
  prévia o erro real do serviço (permissão, regra de negócio) antes de confirmar. Nenhum serviço
  de escrita tem efeito fora do banco, então desfazer o SAVEPOINT desfaz tudo — inclusive as
  travas de linha que ele pegou.

Ficam de fora o que não cabe em linguagem natural ou não é do espaço: enviar arquivo (capa,
foto, importação), exportar, entrar/sair da sessão e aceitar convite (exige o link pessoal).
"""

from __future__ import annotations

import types
import typing
import unicodedata
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date
from typing import Annotated, Any, Literal

import psycopg
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, ValidationError, model_validator

from ..db import Ctx
from ..errors import AppError, BadRequestError, ForbiddenError
from ..identity import photos, workspaces
from ..identity.access import is_uuid, project_access
from ..identity.policy import PERMISSIONS
from ..work import (
    baselines,
    comments,
    covers,
    folders,
    formal,
    invites,
    okrs,
    org,
    phases,
    projects,
    risks,
    sprints,
    tasks,
)
from ..work.today import today_in

MAX_STEPS = 20


# ------------------------------------------------------------------ tipos


def _date(v: str) -> str:
    try:
        if date.fromisoformat(v).isoformat() != v:
            raise ValueError
    except ValueError as e:
        raise ValueError("Data inválida (use AAAA-MM-DD)") from e
    return v


def _uuid(v: str) -> str:
    if not is_uuid(v):
        raise ValueError("identificador inválido; use o nome (ex.: project, task, person)")
    return v


Date = Annotated[str, AfterValidator(_date)]
Id = Annotated[str, AfterValidator(_uuid)]
Status = Literal["todo", "doing", "blocked", "done"]
Priority = Literal["low", "medium", "high", "urgent"]
Phase = Literal["initiation", "planning", "execution", "monitoring", "closing"]
ProjectRole = Literal["gp", "po", "an", "as", "ex", "se", "qa", "ei"]
RiskKind = Literal["threat", "opportunity"]
RiskCategory = Literal["technical", "management", "commercial", "external"]
RiskStatus = Literal["open", "responding", "occurred", "closed"]
RiskStrategy = Literal[
    "escalate", "avoid", "transfer", "mitigate", "exploit", "share", "enhance", "accept", ""
]
RiskObjective = Literal["schedule", "cost", "scope", "quality"]
Confidence = Literal["on_track", "at_risk", "off_track"]
WorkspaceRole = Literal["admin", "manager", "member", "viewer"]
ConfigurableRole = Literal["manager", "member", "viewer"]
Permission = Literal[tuple(PERMISSIONS)]  # type: ignore[valid-type]
TermField = Literal[tuple(dict.fromkeys(formal.TAP_FIELDS + formal.TEP_FIELDS))]  # type: ignore[valid-type]

# Campos de controle: preenchidos pelo sistema, nunca mostrados nem editados na prévia.
HIDDEN = {"expected_version", "version"}

# Rótulos dos valores fixos, para a prévia mostrar em português.
OPTION_LABEL: dict[str, dict[str, str]] = {
    "status": {
        "todo": "A fazer",
        "doing": "Em andamento",
        "blocked": "Bloqueada",
        "done": "Concluída",
        "open": "Aberto",
        "responding": "Em resposta",
        "occurred": "Ocorreu",
        "closed": "Encerrado",
    },
    "priority": {"low": "Baixa", "medium": "Média", "high": "Alta", "urgent": "Urgente"},
    "phase": dict(formal.PHASE_LABEL),
    "approach": {"agile": "Ágil", "waterfall": "Preditiva (cascata)"},
    "roles": dict(formal.ROLE_LABEL),
    "kind": {
        "threat": "Ameaça",
        "opportunity": "Oportunidade",
        "number": "Número",
        "project": "Projeto",
        "tap": "Termo de Abertura (TAP)",
        "tep": "Termo de Encerramento (TEP)",
    },
    "category": {
        "technical": "Técnico",
        "management": "Gerencial",
        "commercial": "Comercial",
        "external": "Externo",
    },
    "affects": {"schedule": "Prazo", "cost": "Custo", "scope": "Escopo", "quality": "Qualidade"},
    "strategy": {
        "escalate": "Escalar",
        "avoid": "Evitar",
        "transfer": "Transferir",
        "mitigate": "Mitigar",
        "exploit": "Explorar",
        "share": "Compartilhar",
        "enhance": "Melhorar",
        "accept": "Aceitar",
        "": "(nenhuma)",
    },
    "confidence": {"on_track": "No caminho", "at_risk": "Em risco", "off_track": "Fora do caminho"},
    "role": {
        "admin": "Gestor",
        "manager": "Gerente de projeto",
        "member": "Membro",
        "viewer": "Leitor",
    },
    "carry_to": {"next": "Próxima sprint", "backlog": "Backlog"},
    "grant": dict(PERMISSIONS),
    "revoke": dict(PERMISSIONS),
}


class P(BaseModel):
    """Parâmetros de uma ação. Campo desconhecido é erro: o modelo não inventa campos."""

    model_config = ConfigDict(extra="forbid")


@dataclass
class Run:
    """Contexto de execução: conexão + pessoa (Ctx), espaço da conversa e fuso da pessoa."""

    ctx: Ctx
    workspace_id: str
    timezone: str

    @property
    def today(self) -> str:
        return today_in(self.timezone)


def _done(label: str, href: str | None = None, **extra: Any) -> dict:
    out: dict[str, Any] = {"label": label}
    if href:
        out["href"] = href
    out.update(extra)
    return out


def _phref(pid: str, view: str | None = None) -> str:
    return f"/projetos/{pid}" + (f"?view={view}" if view else "")


def _thref(t: dict) -> str:
    if t.get("project_id"):
        return f"/projetos/{t['project_id']}?view=lista&task={t['id']}"
    return f"/minhas-tarefas?task={t['id']}"


def _hours(d: dict, src: str, dst: str) -> None:
    if src in d:
        h = d.pop(src)
        d[dst] = None if h is None else round(h * 60)


# ------------------------------------------------------------------ projetos


class Attr(P):
    name: str = Field(max_length=200)
    value: str = Field(max_length=1000)


class ProjectCreate(P):
    name: str = Field(min_length=2, max_length=200, title="Nome")
    description: str = Field(default="", max_length=10000, title="Descrição")
    summary: str = Field(default="", max_length=4000, title="Resumo")
    responsible: str = Field(default="", max_length=200, title="Responsável (texto)")
    requester: str = Field(default="", max_length=200, title="Demandante")
    external_ref: str = Field(default="", max_length=200, title="Origem")
    attributes: list[Attr] | None = Field(default=None, max_length=50, title="Campos livres")


class ProjectUpdate(P):
    project_id: Id = Field(title="Projeto")
    name: str | None = Field(default=None, min_length=2, max_length=200, title="Nome")
    description: str | None = Field(default=None, max_length=10000, title="Descrição")
    phase: Phase | None = Field(default=None, title="Fase do ciclo de vida")
    approach: Literal["agile", "waterfall"] | None = Field(default=None, title="Abordagem")
    sei_process: str | None = Field(default=None, max_length=60, title="Processo SEI")
    summary: str | None = Field(default=None, max_length=4000, title="Resumo")
    responsible: str | None = Field(default=None, max_length=200, title="Responsável (texto)")
    requester: str | None = Field(default=None, max_length=200, title="Demandante")
    external_ref: str | None = Field(default=None, max_length=200, title="Origem")
    attributes: list[Attr] | None = Field(
        default=None, max_length=50, title="Campos livres (substitui todos)"
    )
    progress: int | None = Field(default=None, ge=0, le=100, title="% concluído informado")
    clear_progress: bool = Field(default=False, title="Voltar a calcular o % pelas tarefas")

    @model_validator(mode="after")
    def _some(self) -> ProjectUpdate:
        if not (self.model_fields_set - {"project_id"}):
            raise ValueError("diga o que mudar no projeto")
        return self


class ProjectRef(P):
    project_id: Id = Field(title="Projeto")


class ProjectPerson(P):
    project_id: Id = Field(title="Projeto")
    user_id: Id = Field(title="Pessoa")


class ProjectRoles(ProjectPerson):
    roles: list[ProjectRole] = Field(max_length=8, title="Funções no projeto")


class ProjectMatricula(P):
    project_id: Id = Field(title="Projeto")
    matricula: str = Field(min_length=1, max_length=40, title="Matrícula")


class ProjectFolder(P):
    project_id: Id = Field(title="Projeto")
    folder_id: Id | None = Field(default=None, title="Pasta (vazio = tirar da pasta)")


class DirectShare(P):
    project_id: Id = Field(title="Projeto")
    unit: str = Field(min_length=1, max_length=40, title="Unidade (sigla)")


def _attrs(items: list[Attr] | None) -> list[dict] | None:
    return None if items is None else [i.model_dump() for i in items]


def _project_create(r: Run, m: ProjectCreate) -> dict:
    p = projects.create_project(
        r.ctx,
        r.workspace_id,
        m.name,
        m.description,
        m.summary,
        m.responsible,
        m.requester,
        m.external_ref,
        _attrs(m.attributes),
    )
    return _done(f"Projeto “{p['name']}” criado", _phref(p["id"]))


def _project_update(r: Run, m: ProjectUpdate) -> dict:
    p = projects.update_project(
        r.ctx,
        m.project_id,
        m.name,
        m.description,
        None,
        m.phase,
        m.approach,
        m.sei_process,
        m.summary,
        m.responsible,
        m.requester,
        m.external_ref,
        _attrs(m.attributes),
        m.progress,
        m.clear_progress,
    )
    return _done(f"Projeto “{p['name']}” atualizado", _phref(m.project_id))


def _project_status(status: str, verb: str) -> Callable[[Run, ProjectRef], dict]:
    def run(r: Run, m: ProjectRef) -> dict:
        p = projects.update_project(r.ctx, m.project_id, status=status)
        return _done(f"Projeto “{p['name']}” {verb}", _phref(m.project_id))

    return run


def _member_add(r: Run, m: ProjectPerson) -> dict:
    projects.add_project_member(r.ctx, m.project_id, m.user_id)
    return _done("Pessoa vinculada ao projeto", _phref(m.project_id))


def _member_remove(r: Run, m: ProjectPerson) -> dict:
    projects.remove_project_member(r.ctx, m.project_id, m.user_id)
    return _done("Pessoa desvinculada do projeto", _phref(m.project_id))


def _set_roles(r: Run, m: ProjectRoles) -> dict:
    roles = formal.set_member_roles(r.ctx, m.project_id, m.user_id, list(m.roles))
    names = ", ".join(formal.ROLE_LABEL[x] for x in roles) or "nenhuma"
    return _done(f"Funções definidas: {names}", _phref(m.project_id))


def _invite_matricula(r: Run, m: ProjectMatricula) -> dict:
    invites.invite_by_matricula(r.ctx, m.project_id, m.matricula)
    return _done(f"Matrícula {m.matricula.upper()} convidada para o projeto", _phref(m.project_id))


def _revoke_matricula(r: Run, m: ProjectMatricula) -> dict:
    invites.revoke(r.ctx, m.project_id, m.matricula)
    return _done(f"Convite da matrícula {m.matricula.upper()} retirado", _phref(m.project_id))


def _project_folder(r: Run, m: ProjectFolder) -> dict:
    folders.set_project_folder(r.ctx, m.project_id, m.folder_id)
    return _done("Projeto movido de pasta" if m.folder_id else "Projeto tirado da pasta", "/projetos")


def _remove_cover(r: Run, m: ProjectRef) -> dict:
    covers.delete_cover(r.ctx, m.project_id)
    return _done("Capa do projeto removida", _phref(m.project_id))


def _share_up(r: Run, m: ProjectRef) -> dict:
    org.share_up(r.ctx, r.workspace_id, m.project_id)
    return _done("Projeto compartilhado com a unidade acima", "/configuracoes")


def _unshare_up(r: Run, m: ProjectRef) -> dict:
    org.unshare_up(r.ctx, r.workspace_id, m.project_id)
    return _done("Compartilhamento com a unidade acima desfeito", "/configuracoes")


def _share_direct(r: Run, m: DirectShare) -> dict:
    org.share_direct(r.ctx, r.workspace_id, m.project_id, m.unit.strip().upper())
    return _done(f"Projeto compartilhado com {m.unit.strip().upper()}", "/configuracoes")


def _unshare_direct(r: Run, m: DirectShare) -> dict:
    org.unshare_direct(r.ctx, r.workspace_id, m.project_id, m.unit.strip().upper())
    return _done(f"Compartilhamento com {m.unit.strip().upper()} desfeito", "/configuracoes")


class NoParams(P):
    pass


def _share_all(r: Run, _: NoParams) -> dict:
    n = org.share_all_up(r.ctx, r.workspace_id)
    return _done(f"{n} projeto(s) compartilhado(s) com a unidade acima", "/configuracoes")


# ------------------------------------------------------------------ pastas, fases, linhas de base


class FolderCreate(P):
    name: str = Field(min_length=1, max_length=120, title="Nome da pasta")


class FolderRename(P):
    folder_id: Id = Field(title="Pasta")
    name: str = Field(min_length=1, max_length=120, title="Novo nome")


class FolderRef(P):
    folder_id: Id = Field(title="Pasta")


def _folder_create(r: Run, m: FolderCreate) -> dict:
    f = folders.create_folder(r.ctx, r.workspace_id, m.name)
    return _done(f"Pasta “{f['name']}” criada", "/projetos")


def _folder_rename(r: Run, m: FolderRename) -> dict:
    f = folders.rename_folder(r.ctx, m.folder_id, m.name)
    return _done(f"Pasta renomeada para “{f['name']}”", "/projetos")


def _folder_delete(r: Run, m: FolderRef) -> dict:
    folders.delete_folder(r.ctx, m.folder_id)
    return _done("Pasta excluída (os projetos dela continuam existindo)", "/projetos")


class PhaseCreate(P):
    project_id: Id = Field(title="Projeto")
    name: str = Field(min_length=1, max_length=100, title="Nome da fase")


class PhaseRename(P):
    phase_id: Id = Field(title="Fase")
    name: str = Field(min_length=1, max_length=100, title="Novo nome")


class PhaseRef(P):
    phase_id: Id = Field(title="Fase")


class PhaseReorder(P):
    project_id: Id = Field(title="Projeto")
    names: list[str] = Field(min_length=1, max_length=100, title="Nova ordem das fases")


def _phase_project(r: Run, phase_id: str) -> str:
    row = r.ctx.one("SELECT project_id::text AS p FROM project_phases WHERE id=%s", (phase_id,))
    if not row:
        raise ForbiddenError()
    return row["p"]


def _phase_create(r: Run, m: PhaseCreate) -> dict:
    f = phases.create_phase(r.ctx, m.project_id, m.name)
    return _done(f"Fase “{f['name']}” criada", _phref(m.project_id))


def _phase_rename(r: Run, m: PhaseRename) -> dict:
    pid = _phase_project(r, m.phase_id)
    f = phases.rename_phase(r.ctx, m.phase_id, m.name)
    return _done(f"Fase renomeada para “{f['name']}”", _phref(pid))


def _phase_delete(r: Run, m: PhaseRef) -> dict:
    pid = _phase_project(r, m.phase_id)
    phases.delete_phase(r.ctx, m.phase_id)
    return _done("Fase excluída", _phref(pid))


def _norm(s: str) -> str:
    return unicodedata.normalize("NFD", s.casefold()).encode("ascii", "ignore").decode().strip()


def _phase_reorder(r: Run, m: PhaseReorder) -> dict:
    current = phases.list_phases(r.ctx, m.project_id)["phases"]
    by_name = {_norm(p["name"]): str(p["id"]) for p in current}
    ids: list[str] = []
    for n in m.names:
        pid = by_name.get(_norm(n))
        if not pid:
            raise BadRequestError(f"O projeto não tem a fase “{n[:60]}”. Confira os nomes.")
        if pid not in ids:
            ids.append(pid)
    # Fases não citadas continuam depois, na ordem em que estavam.
    ids += [str(p["id"]) for p in current if str(p["id"]) not in ids]
    phases.reorder_phases(r.ctx, m.project_id, ids)
    return _done("Fases reordenadas", _phref(m.project_id))


class BaselineCreate(P):
    project_id: Id = Field(title="Projeto")
    name: str = Field(default="", max_length=120, title="Nome")
    note: str = Field(default="", max_length=1000, title="Motivo / observação")


class BaselineRef(P):
    project_id: Id = Field(title="Projeto")
    baseline_id: Id = Field(title="Linha de base")


def _baseline_create(r: Run, m: BaselineCreate) -> dict:
    baselines.create_baseline(r.ctx, m.project_id, m.name, m.note)
    return _done("Linha de base registrada", _phref(m.project_id, "cronograma"))


def _baseline_delete(r: Run, m: BaselineRef) -> dict:
    baselines.delete_baseline(r.ctx, m.project_id, m.baseline_id)
    return _done("Linha de base excluída", _phref(m.project_id, "cronograma"))


# ------------------------------------------------------------------ termos TAP / TEP


class TermSave(P):
    project_id: Id = Field(title="Projeto")
    kind: Literal["tap", "tep"] = Field(title="Termo")
    content: dict[TermField, str] = Field(min_length=1, title="Campos")  # type: ignore[valid-type]
    expected_version: int | None = None

    @model_validator(mode="after")
    def _fields_of_kind(self) -> TermSave:
        allowed = formal.TAP_FIELDS if self.kind == "tap" else formal.TEP_FIELDS
        wrong = sorted(set(self.content) - set(allowed))
        if wrong:
            raise ValueError(f"campos que não existem no {self.kind.upper()}: {', '.join(wrong)}")
        if any(len(v) > 20000 for v in self.content.values()):
            raise ValueError("um dos campos passa de 20000 caracteres")
        return self


def _term_save(r: Run, m: TermSave) -> dict:
    current = formal.get_term(r.ctx, m.project_id, m.kind)
    # A ação muda só os campos citados; o resto do termo fica como está.
    merged = {**(current["content"] or {}), **m.content}
    version = current["version"] if m.expected_version is None else m.expected_version
    formal.save_term(r.ctx, m.project_id, m.kind, merged, version)
    return _done(f"{m.kind.upper()} salvo", _phref(m.project_id, "formal"))


# ------------------------------------------------------------------ tarefas


class TaskFields(P):
    title: str | None = Field(default=None, min_length=1, max_length=200, title="Título")
    description: str | None = Field(default=None, max_length=10000, title="Descrição")
    status: Status | None = Field(default=None, title="Estado")
    priority: Priority | None = Field(default=None, title="Prioridade")
    assignee_id: Id | None = Field(default=None, title="Responsável")
    start_date: Date | None = Field(default=None, title="Início")
    due_date: Date | None = Field(default=None, title="Prazo")
    estimate_hours: float | None = Field(default=None, ge=0, le=2000, title="Estimativa (h)")
    progress: int | None = Field(default=None, ge=0, le=100, title="Progresso (%)")
    phase: str | None = Field(default=None, max_length=100, title="Fase")
    is_milestone: bool | None = Field(default=None, title="Marco")
    labels: list[str] | None = Field(default=None, max_length=20, title="Etiquetas")
    parent_id: Id | None = Field(default=None, title="Tarefa-mãe")
    sprint_id: Id | None = Field(default=None, title="Sprint")


class TaskCreate(TaskFields):
    project_id: Id | None = Field(default=None, title="Projeto (vazio = tarefa pessoal)")
    title: str = Field(min_length=1, max_length=200, title="Título")


class TaskUpdate(TaskFields):
    task_id: Id = Field(title="Tarefa")
    expected_version: int | None = None

    @model_validator(mode="after")
    def _some(self) -> TaskUpdate:
        if not (self.model_fields_set - {"task_id", "expected_version"}):
            raise ValueError("diga o que mudar na tarefa")
        return self


class TaskRef(P):
    task_id: Id = Field(title="Tarefa")


class Dependency(P):
    task_id: Id = Field(title="Tarefa")
    depends_on_id: Id = Field(title="Depende de")


class CommentAdd(P):
    task_id: Id = Field(title="Tarefa")
    body: str = Field(min_length=1, max_length=5000, title="Comentário")


class CommentEdit(P):
    comment_id: Id = Field(title="Comentário")
    body: str = Field(min_length=1, max_length=5000, title="Novo texto")


class CommentRef(P):
    comment_id: Id = Field(title="Comentário")


def _task_fields(m: BaseModel, exclude: set[str]) -> dict:
    d = m.model_dump(exclude_unset=True, exclude=exclude | HIDDEN)
    _hours(d, "estimate_hours", "estimate_minutes")
    return d


def _task_create(r: Run, m: TaskCreate) -> dict:
    fields = {k: v for k, v in _task_fields(m, {"project_id"}).items() if v is not None}
    t = tasks.create_task(r.ctx, r.workspace_id, m.project_id, fields, via="assistant")
    return _done(f"Tarefa “{t['title']}” criada", _thref(t))


def _task_update(r: Run, m: TaskUpdate) -> dict:
    t = tasks.update_task(
        r.ctx, m.task_id, _task_fields(m, {"task_id"}), m.expected_version, via="assistant"
    )
    return _done(f"Tarefa “{t['title']}” atualizada", _thref(t))


def _task_delete(r: Run, m: TaskRef) -> dict:
    t = tasks.get_task(r.ctx, m.task_id)["task"]
    tasks.delete_task(r.ctx, m.task_id)
    href = _phref(t["project_id"], "lista") if t["project_id"] else "/minhas-tarefas"
    return _done(f"Tarefa “{t['title']}” excluída", href)


def _dep_add(r: Run, m: Dependency) -> dict:
    tasks.add_dependency(r.ctx, m.task_id, m.depends_on_id)
    t = tasks.get_task(r.ctx, m.task_id)["task"]
    return _done(f"Dependência criada em “{t['title']}”", _thref(t))


def _dep_remove(r: Run, m: Dependency) -> dict:
    tasks.remove_dependency(r.ctx, m.task_id, m.depends_on_id)
    t = tasks.get_task(r.ctx, m.task_id)["task"]
    return _done(f"Dependência removida de “{t['title']}”", _thref(t))


def _comment_task(r: Run, comment_id: str) -> dict:
    row = r.ctx.one("SELECT task_id::text AS t FROM task_comments WHERE id=%s", (comment_id,))
    if not row:
        raise ForbiddenError()
    return tasks.get_task(r.ctx, row["t"])["task"]


def _comment_add(r: Run, m: CommentAdd) -> dict:
    comments.add_comment(r.ctx, m.task_id, m.body)
    t = tasks.get_task(r.ctx, m.task_id)["task"]
    return _done(f"Comentário publicado em “{t['title']}”", _thref(t))


def _comment_edit(r: Run, m: CommentEdit) -> dict:
    t = _comment_task(r, m.comment_id)
    comments.edit_comment(r.ctx, m.comment_id, m.body)
    return _done(f"Comentário editado em “{t['title']}”", _thref(t))


def _comment_delete(r: Run, m: CommentRef) -> dict:
    t = _comment_task(r, m.comment_id)
    comments.delete_comment(r.ctx, m.comment_id)
    return _done(f"Comentário excluído de “{t['title']}”", _thref(t))


# ------------------------------------------------------------------ riscos


class RiskFields(P):
    kind: RiskKind | None = Field(default=None, title="Tipo")
    title: str | None = Field(default=None, min_length=1, max_length=160, title="Evento de risco")
    cause: str | None = Field(default=None, max_length=1000, title="Causa")
    effect: str | None = Field(default=None, max_length=1000, title="Efeito")
    category: RiskCategory | None = Field(default=None, title="Categoria")
    probability: int | None = Field(default=None, ge=1, le=5, title="Probabilidade (1–5)")
    impact: int | None = Field(default=None, ge=1, le=5, title="Impacto (1–5)")
    affects: list[RiskObjective] | None = Field(default=None, max_length=4, title="Afeta")
    strategy: RiskStrategy | None = Field(default=None, title="Estratégia")
    response: str | None = Field(default=None, max_length=2000, title="Plano de resposta")
    contingency: str | None = Field(default=None, max_length=2000, title="Contingência")
    trigger_signal: str | None = Field(default=None, max_length=500, title="Gatilho")
    owner_id: Id | None = Field(default=None, title="Dono do risco")
    response_due: Date | None = Field(default=None, title="Prazo da resposta")
    status: RiskStatus | None = Field(default=None, title="Situação")


class RiskCreate(RiskFields):
    project_id: Id = Field(title="Projeto")
    title: str = Field(min_length=1, max_length=160, title="Evento de risco")
    probability: int = Field(ge=1, le=5, title="Probabilidade (1–5)")
    impact: int = Field(ge=1, le=5, title="Impacto (1–5)")


class RiskUpdate(RiskFields):
    project_id: Id = Field(title="Projeto")
    risk_id: Id = Field(title="Risco")
    reviewed: bool = Field(default=False, title="Marcar como revisado agora")
    version: int | None = None


class RiskRef(P):
    project_id: Id = Field(title="Projeto")
    risk_id: Id = Field(title="Risco")


def _risk_create(r: Run, m: RiskCreate) -> dict:
    x = risks.create_risk(r.ctx, m.project_id, m.model_dump(exclude_unset=True, exclude={"project_id"}))
    return _done(f"Risco R{x['number']} registrado", _phref(m.project_id, "riscos"))


def _risk_update(r: Run, m: RiskUpdate) -> dict:
    fields = m.model_dump(exclude_unset=True, exclude={"project_id", "risk_id", "reviewed"} | HIDDEN)
    x = risks.update_risk(r.ctx, m.project_id, m.risk_id, fields, m.version, m.reviewed)
    return _done(f"Risco R{x['number']} atualizado", _phref(m.project_id, "riscos"))


def _risk_delete(r: Run, m: RiskRef) -> dict:
    risks.delete_risk(r.ctx, m.project_id, m.risk_id)
    return _done("Risco excluído", _phref(m.project_id, "riscos"))


# ------------------------------------------------------------------ sprints


class SprintFields(P):
    name: str | None = Field(default=None, min_length=1, max_length=80, title="Nome")
    goal: str | None = Field(default=None, max_length=500, title="Meta da sprint")
    start_date: Date | None = Field(default=None, title="Início")
    end_date: Date | None = Field(default=None, title="Fim")
    capacity_hours: float | None = Field(default=None, ge=0, le=16000, title="Capacidade (h)")


class SprintCreate(SprintFields):
    project_id: Id = Field(title="Projeto")


class SprintUpdate(SprintFields):
    sprint_id: Id = Field(title="Sprint")
    expected_version: int | None = None


class SprintRef(P):
    sprint_id: Id = Field(title="Sprint")


class SprintClose(SprintRef):
    carry_to: Literal["next", "backlog"] = Field(title="Tarefas não concluídas vão para")


def _sprint_fields(m: BaseModel, exclude: set[str], drop_none: bool) -> dict:
    d = m.model_dump(exclude_unset=True, exclude=exclude | HIDDEN)
    _hours(d, "capacity_hours", "capacity_minutes")
    return {k: v for k, v in d.items() if v is not None} if drop_none else d


def _sprint_project(r: Run, sprint_id: str) -> str:
    row = r.ctx.one("SELECT project_id::text AS p FROM sprints WHERE id=%s", (sprint_id,))
    if not row:
        raise ForbiddenError()
    return row["p"]


def _sprint_create(r: Run, m: SprintCreate) -> dict:
    s = sprints.create_sprint(r.ctx, m.project_id, _sprint_fields(m, {"project_id"}, True), r.today)
    return _done(f"Sprint “{s['name']}” criada", _phref(m.project_id, "sprints"))


def _sprint_update(r: Run, m: SprintUpdate) -> dict:
    pid = _sprint_project(r, m.sprint_id)
    s = sprints.update_sprint(
        r.ctx, m.sprint_id, _sprint_fields(m, {"sprint_id"}, False), m.expected_version
    )
    return _done(f"Sprint “{s['name']}” atualizada", _phref(pid, "sprints"))


def _sprint_delete(r: Run, m: SprintRef) -> dict:
    pid = _sprint_project(r, m.sprint_id)
    sprints.delete_sprint(r.ctx, m.sprint_id)
    return _done("Sprint excluída (as tarefas voltaram ao backlog)", _phref(pid, "sprints"))


def _sprint_start(r: Run, m: SprintRef) -> dict:
    pid = _sprint_project(r, m.sprint_id)
    s = sprints.start_sprint(r.ctx, m.sprint_id, r.today)
    return _done(f"Sprint “{s['name']}” iniciada", _phref(pid, "sprints"))


def _sprint_close(r: Run, m: SprintClose) -> dict:
    pid = _sprint_project(r, m.sprint_id)
    sprints.close_sprint(r.ctx, m.sprint_id, m.carry_to, r.today)
    return _done("Sprint encerrada", _phref(pid, "sprints"))


# ------------------------------------------------------------------ OKRs


class KrFields(P):
    title: str | None = Field(default=None, min_length=3, max_length=200, title="Resultado-chave")
    owner_id: Id | None = Field(default=None, title="Responsável")
    kind: Literal["number", "project"] | None = Field(default=None, title="Medido por")
    start_value: float | None = Field(default=None, title="Valor de partida")
    target_value: float | None = Field(default=None, title="Meta")
    unit: str | None = Field(default=None, max_length=20, title="Unidade")
    project_id: Id | None = Field(default=None, title="Projeto que mede o KR")
    cost: float | None = Field(default=None, ge=0, title="Custo (R$)")


class NewKr(KrFields):
    title: str = Field(min_length=3, max_length=200, title="Resultado-chave")


class ObjectiveCreate(P):
    title: str = Field(min_length=3, max_length=200, title="Objetivo")
    period: str = Field(pattern=r"^\d{4}-[Tt][1-4]$", title="Trimestre (AAAA-Tn)")
    description: str = Field(default="", max_length=2000, title="Descrição")
    owner_id: Id | None = Field(default=None, title="Responsável")
    key_results: list[NewKr] = Field(default_factory=list, max_length=10, title="Resultados-chave")


class ObjectiveUpdate(P):
    objective_id: Id = Field(title="Objetivo")
    title: str | None = Field(default=None, min_length=3, max_length=200, title="Título")
    period: str | None = Field(default=None, pattern=r"^\d{4}-[Tt][1-4]$", title="Trimestre")
    description: str | None = Field(default=None, max_length=2000, title="Descrição")
    owner_id: Id | None = Field(default=None, title="Responsável")


class ObjectiveRef(P):
    objective_id: Id = Field(title="Objetivo")


class KrCreate(KrFields):
    objective_id: Id = Field(title="Objetivo")
    title: str = Field(min_length=3, max_length=200, title="Resultado-chave")


class KrUpdate(KrFields):
    key_result_id: Id = Field(title="Resultado-chave")
    objective_id: Id | None = Field(default=None, title="Mover para o objetivo")


class KrRef(P):
    key_result_id: Id = Field(title="Resultado-chave")


class KrCheckIn(P):
    key_result_id: Id = Field(title="Resultado-chave")
    value: float | None = Field(default=None, title="Valor atual")
    confidence: Confidence = Field(title="Confiança")
    note: str = Field(default="", max_length=2000, title="Nota")


def _objective_create(r: Run, m: ObjectiveCreate) -> dict:
    o = okrs.create_objective(
        r.ctx, r.workspace_id, m.title, m.period, m.description, m.owner_id
    )
    for kr in m.key_results:
        okrs.create_key_result(r.ctx, o["id"], kr.model_dump(exclude_unset=True))
    n = len(m.key_results)
    extra = f" com {n} resultado(s)-chave" if n else ""
    return _done(f"Objetivo “{m.title}” criado{extra}", "/metas")


def _objective_update(r: Run, m: ObjectiveUpdate) -> dict:
    okrs.update_objective(r.ctx, m.objective_id, m.model_dump(exclude_unset=True, exclude={"objective_id"}))
    return _done("Objetivo atualizado", "/metas")


def _objective_delete(r: Run, m: ObjectiveRef) -> dict:
    okrs.delete_objective(r.ctx, m.objective_id)
    return _done("Objetivo excluído (com seus resultados-chave)", "/metas")


def _kr_create(r: Run, m: KrCreate) -> dict:
    okrs.create_key_result(r.ctx, m.objective_id, m.model_dump(exclude_unset=True, exclude={"objective_id"}))
    return _done(f"Resultado-chave “{m.title}” criado", "/metas")


def _kr_update(r: Run, m: KrUpdate) -> dict:
    okrs.update_key_result(r.ctx, m.key_result_id, m.model_dump(exclude_unset=True, exclude={"key_result_id"}))
    return _done("Resultado-chave atualizado", "/metas")


def _kr_delete(r: Run, m: KrRef) -> dict:
    okrs.delete_key_result(r.ctx, m.key_result_id)
    return _done("Resultado-chave excluído", "/metas")


def _kr_check_in(r: Run, m: KrCheckIn) -> dict:
    out = okrs.check_in(r.ctx, m.key_result_id, m.value, m.confidence, m.note, r.timezone)
    kr = out["key_result"]
    return _done(
        f"Check-in registrado: {out['previous_progress']}% → {kr['progress']}%", "/metas"
    )


def _objective_share(r: Run, m: ObjectiveRef) -> dict:
    org.share_objective_up(r.ctx, r.workspace_id, m.objective_id)
    return _done("Objetivo compartilhado com a unidade acima", "/metas")


def _objective_unshare(r: Run, m: ObjectiveRef) -> dict:
    org.unshare_objective_up(r.ctx, r.workspace_id, m.objective_id)
    return _done("Compartilhamento do objetivo desfeito", "/metas")


# ------------------------------------------------------------------ espaço e perfil


class WorkspaceUpdate(P):
    name: str | None = Field(default=None, min_length=1, max_length=120, title="Nome do espaço")
    timezone: str | None = Field(default=None, max_length=60, title="Fuso horário do espaço")

    @model_validator(mode="after")
    def _some(self) -> WorkspaceUpdate:
        if not self.model_fields_set:
            raise ValueError("diga o que mudar no espaço")
        return self


class WorkspaceCreate(P):
    name: str = Field(min_length=1, max_length=120, title="Nome do novo espaço")
    timezone: str = Field(default="America/Sao_Paulo", max_length=60, title="Fuso horário")


class MemberRole(P):
    user_id: Id = Field(title="Pessoa")
    role: WorkspaceRole = Field(title="Perfil")


class MemberRef(P):
    user_id: Id = Field(title="Pessoa")


class WorkspaceInvite(P):
    email: str = Field(min_length=3, max_length=200, title="E-mail")
    role: WorkspaceRole = Field(default="member", title="Perfil")


class InvitationRef(P):
    invitation_id: Id = Field(title="Convite")


class PermissionsChange(P):
    role: ConfigurableRole = Field(title="Perfil")
    grant: list[Permission] = Field(default_factory=list, title="Conceder")  # type: ignore[valid-type]
    revoke: list[Permission] = Field(default_factory=list, title="Retirar")  # type: ignore[valid-type]

    @model_validator(mode="after")
    def _some(self) -> PermissionsChange:
        if not self.grant and not self.revoke:
            raise ValueError("diga quais permissões conceder ou retirar")
        if set(self.grant) & set(self.revoke):
            raise ValueError("a mesma permissão não pode ser concedida e retirada")
        return self


class TimezoneChange(P):
    timezone: str = Field(min_length=1, max_length=60, title="Seu fuso horário")


class Notifications(P):
    notify_email: bool | None = Field(default=None, title="Avisos por e-mail")
    notify_inapp: bool | None = Field(default=None, title="Avisos na plataforma")


def _ws_update(r: Run, m: WorkspaceUpdate) -> dict:
    workspaces.update_workspace(r.ctx, r.workspace_id, m.name, m.timezone)
    return _done("Espaço atualizado", "/configuracoes")


def _ws_create(r: Run, m: WorkspaceCreate) -> dict:
    w = workspaces.create_team_workspace(r.ctx, m.name, m.timezone)
    return _done(f"Espaço “{w['name']}” criado (troque de espaço no menu para usá-lo)")


def _ws_role(r: Run, m: MemberRole) -> dict:
    workspaces.set_member_role(r.ctx, r.workspace_id, m.user_id, m.role)
    return _done(f"Perfil alterado para {OPTION_LABEL['role'][m.role]}", "/configuracoes")


def _ws_remove(r: Run, m: MemberRef) -> dict:
    workspaces.remove_member(r.ctx, r.workspace_id, m.user_id)
    return _done("Pessoa removida do espaço", "/configuracoes")


def _ws_invite(r: Run, m: WorkspaceInvite) -> dict:
    inv = workspaces.create_invitation(r.ctx, r.workspace_id, m.email, m.role)
    # O link carrega o token secreto: vai só na resposta da confirmação (`once`), nunca para o
    # histórico gravado nem para o modelo.
    return _done(
        f"Convite criado para {m.email.strip().lower()}",
        "/configuracoes",
        once={"label": f"Link de convite para {m.email.strip().lower()}", "href": f"/convite/{inv['token']}"},
    )


def _ws_revoke(r: Run, m: InvitationRef) -> dict:
    workspaces.revoke_invitation(r.ctx, r.workspace_id, m.invitation_id)
    return _done("Convite retirado", "/configuracoes")


def _ws_permissions(r: Run, m: PermissionsChange) -> dict:
    current = workspaces.get_permissions(r.ctx, r.workspace_id)["permissions"]
    role_perms = (set(current.get(m.role, [])) | set(m.grant)) - set(m.revoke)
    workspaces.set_permissions(r.ctx, r.workspace_id, {**current, m.role: sorted(role_perms)})
    return _done(f"Permissões do perfil {OPTION_LABEL['role'][m.role]} atualizadas", "/configuracoes")


def _my_timezone(r: Run, m: TimezoneChange) -> dict:
    workspaces.update_my_timezone(r.ctx, m.timezone)
    return _done(f"Seu fuso horário agora é {m.timezone}", "/perfil")


def _my_notifications(r: Run, m: Notifications) -> dict:
    workspaces.update_my_prefs(r.ctx, r.workspace_id, m.notify_email, m.notify_inapp)
    return _done("Preferências de aviso atualizadas", "/perfil")


def _my_photo_delete(r: Run, _: NoParams) -> dict:
    photos.delete_my_photo(r.ctx)
    return _done("Sua foto foi removida", "/perfil")


# ------------------------------------------------------------------ registro


@dataclass(frozen=True)
class Action:
    name: str
    label: str
    params: type[P]
    run: Callable[[Run, Any], dict]
    danger: bool = False  # irreversível ou mexe em acesso: a prévia destaca
    hint: str = ""


ACTIONS: list[Action] = [
    # projetos
    Action("project.create", "Criar projeto", ProjectCreate, _project_create),
    Action("project.update", "Editar dados do projeto", ProjectUpdate, _project_update,
           hint="phase = fase do ciclo de vida formal; clear_progress volta ao % calculado"),
    Action("project.archive", "Arquivar projeto", ProjectRef, _project_status("archived", "arquivado")),
    Action("project.restore", "Reativar projeto", ProjectRef, _project_status("active", "reativado")),
    Action("project.add_member", "Vincular pessoa ao projeto", ProjectPerson, _member_add),
    Action("project.remove_member", "Desvincular pessoa do projeto", ProjectPerson, _member_remove, danger=True),
    Action("project.set_roles", "Definir funções no projeto", ProjectRoles, _set_roles,
           hint="roles substitui as funções atuais da pessoa"),
    Action("project.invite", "Convidar matrícula para o projeto", ProjectMatricula, _invite_matricula),
    Action("project.revoke_invite", "Retirar convite de matrícula", ProjectMatricula, _revoke_matricula),
    Action("project.set_folder", "Mover projeto de pasta", ProjectFolder, _project_folder),
    Action("project.remove_cover", "Remover capa do projeto", ProjectRef, _remove_cover, danger=True),
    Action("project.share_up", "Compartilhar projeto com a unidade acima", ProjectRef, _share_up),
    Action("project.unshare_up", "Desfazer compartilhamento com a unidade acima", ProjectRef, _unshare_up),
    Action("project.share_direct", "Compartilhar projeto com uma unidade", DirectShare, _share_direct),
    Action("project.unshare_direct", "Desfazer compartilhamento com uma unidade", DirectShare, _unshare_direct),
    Action("org.share_all", "Compartilhar todos os projetos com a unidade acima", NoParams, _share_all, danger=True),
    # pastas, fases, linhas de base, termos
    Action("folder.create", "Criar pasta", FolderCreate, _folder_create),
    Action("folder.rename", "Renomear pasta", FolderRename, _folder_rename),
    Action("folder.delete", "Excluir pasta", FolderRef, _folder_delete, danger=True),
    Action("phase.create", "Criar fase do projeto", PhaseCreate, _phase_create),
    Action("phase.rename", "Renomear fase", PhaseRename, _phase_rename),
    Action("phase.delete", "Excluir fase", PhaseRef, _phase_delete, danger=True),
    Action("phase.reorder", "Reordenar fases", PhaseReorder, _phase_reorder,
           hint="names em ordem; as não citadas vão para o fim"),
    Action("baseline.create", "Registrar linha de base do cronograma", BaselineCreate, _baseline_create),
    Action("baseline.delete", "Excluir linha de base", BaselineRef, _baseline_delete, danger=True),
    Action("term.save", "Salvar Termo de Abertura/Encerramento", TermSave, _term_save,
           hint="content = {campo: texto}; só os campos citados mudam. Campos TAP: "
           + ", ".join(formal.TAP_FIELDS) + ". Campos TEP: " + ", ".join(formal.TEP_FIELDS)),
    # tarefas
    Action("task.create", "Criar tarefa", TaskCreate, _task_create,
           hint="sem project = tarefa pessoal; sprint/parent pelo nome"),
    Action("task.update", "Editar tarefa", TaskUpdate, _task_update,
           hint="null limpa o campo (ex.: due_date null, assignee 'ninguém', sprint null = backlog)"),
    Action("task.delete", "Excluir tarefa", TaskRef, _task_delete, danger=True),
    Action("task.add_dependency", "Criar dependência entre tarefas", Dependency, _dep_add),
    Action("task.remove_dependency", "Remover dependência", Dependency, _dep_remove),
    Action("comment.add", "Comentar tarefa", CommentAdd, _comment_add),
    Action("comment.edit", "Editar comentário", CommentEdit, _comment_edit,
           hint="comment_id vem de task_details; só o autor edita"),
    Action("comment.delete", "Excluir comentário", CommentRef, _comment_delete, danger=True),
    # riscos
    Action("risk.create", "Registrar risco", RiskCreate, _risk_create),
    Action("risk.update", "Editar risco", RiskUpdate, _risk_update,
           hint="risk = título ou código (R3); reviewed=true marca revisão"),
    Action("risk.delete", "Excluir risco", RiskRef, _risk_delete, danger=True),
    # sprints
    Action("sprint.create", "Criar sprint", SprintCreate, _sprint_create,
           hint="sem datas = mesma cadência da última"),
    Action("sprint.update", "Editar sprint", SprintUpdate, _sprint_update),
    Action("sprint.delete", "Excluir sprint", SprintRef, _sprint_delete, danger=True),
    Action("sprint.start", "Iniciar sprint", SprintRef, _sprint_start),
    Action("sprint.close", "Encerrar sprint", SprintClose, _sprint_close),
    # OKRs
    Action("objective.create", "Criar objetivo (OKR)", ObjectiveCreate, _objective_create,
           hint="key_results = lista de KRs a criar junto (title*, kind, start_value, target_value, unit, owner, project, cost)"),
    Action("objective.update", "Editar objetivo", ObjectiveUpdate, _objective_update),
    Action("objective.delete", "Excluir objetivo", ObjectiveRef, _objective_delete, danger=True),
    Action("objective.share_up", "Compartilhar objetivo com a unidade acima", ObjectiveRef, _objective_share),
    Action("objective.unshare_up", "Desfazer compartilhamento do objetivo", ObjectiveRef, _objective_unshare),
    Action("key_result.create", "Criar resultado-chave", KrCreate, _kr_create),
    Action("key_result.update", "Editar resultado-chave", KrUpdate, _kr_update),
    Action("key_result.delete", "Excluir resultado-chave", KrRef, _kr_delete, danger=True),
    Action("key_result.check_in", "Registrar check-in do resultado-chave", KrCheckIn, _kr_check_in,
           hint="KR de projeto lê o % do projeto; não precisa de value"),
    # espaço
    Action("workspace.update", "Editar o espaço", WorkspaceUpdate, _ws_update),
    Action("workspace.create", "Criar espaço de equipe", WorkspaceCreate, _ws_create),
    Action("workspace.set_role", "Mudar perfil de pessoa no espaço", MemberRole, _ws_role, danger=True),
    Action("workspace.remove_member", "Remover pessoa do espaço", MemberRef, _ws_remove, danger=True),
    Action("workspace.invite", "Convidar pessoa para o espaço por e-mail", WorkspaceInvite, _ws_invite),
    Action("workspace.revoke_invitation", "Retirar convite do espaço", InvitationRef, _ws_revoke),
    Action("workspace.set_permissions", "Mudar permissões de um perfil", PermissionsChange, _ws_permissions,
           danger=True),
    # perfil
    Action("profile.set_timezone", "Mudar seu fuso horário", TimezoneChange, _my_timezone),
    Action("profile.set_notifications", "Mudar suas preferências de aviso", Notifications, _my_notifications),
    Action("profile.remove_photo", "Remover sua foto", NoParams, _my_photo_delete, danger=True),
]  # fmt: skip
BY_NAME = {a.name: a for a in ACTIONS}
NAMES = tuple(BY_NAME)


# ------------------------------------------------------------------ validação


def _error_text(e: ValidationError) -> str:
    parts = []
    for x in e.errors()[:4]:
        loc = ".".join(str(p) for p in x["loc"])
        msg = str(x.get("msg", "")).removeprefix("Value error, ")
        parts.append(f"{loc}: {msg}" if loc else msg)
    return "; ".join(parts)


def parse(name: str, params: dict) -> P:
    action = BY_NAME.get(name)
    if not action:
        raise ValueError(f"ação desconhecida: {name}")
    try:
        return action.params.model_validate(params)
    except ValidationError as e:
        raise ValueError(f"{name}: {_error_text(e)}") from e


def normalize(name: str, params: dict) -> dict:
    """Parâmetros validados no formato gravado: só o que foi informado (ausente ≠ nulo)."""
    return parse(name, params).model_dump(mode="json", exclude_unset=True)


# ------------------------------------------------------------------ escopo

# id -> espaço dono do registro. Defesa extra além dos serviços: nada fora do espaço da conversa.
_SCOPE_SQL = {
    "project_id": "SELECT workspace_id::text AS ws FROM projects WHERE id=%s",
    "task_id": "SELECT workspace_id::text AS ws FROM tasks WHERE id=%s",
    "depends_on_id": "SELECT workspace_id::text AS ws FROM tasks WHERE id=%s",
    "parent_id": "SELECT workspace_id::text AS ws FROM tasks WHERE id=%s",
    "sprint_id": "SELECT p.workspace_id::text AS ws FROM sprints s JOIN projects p ON p.id=s.project_id WHERE s.id=%s",
    "risk_id": "SELECT p.workspace_id::text AS ws FROM project_risks r JOIN projects p ON p.id=r.project_id WHERE r.id=%s",
    "phase_id": "SELECT p.workspace_id::text AS ws FROM project_phases f JOIN projects p ON p.id=f.project_id WHERE f.id=%s",
    "baseline_id": "SELECT p.workspace_id::text AS ws FROM baselines b JOIN projects p ON p.id=b.project_id WHERE b.id=%s",
    "objective_id": "SELECT workspace_id::text AS ws FROM objectives WHERE id=%s",
    "key_result_id": "SELECT o.workspace_id::text AS ws FROM key_results k JOIN objectives o ON o.id=k.objective_id WHERE k.id=%s",
    "folder_id": "SELECT workspace_id::text AS ws FROM project_folders WHERE id=%s",
    "comment_id": "SELECT t.workspace_id::text AS ws FROM task_comments c JOIN tasks t ON t.id=c.task_id WHERE c.id=%s",
    "invitation_id": "SELECT workspace_id::text AS ws FROM invitations WHERE id=%s",
}  # fmt: skip
_PERSON_FIELDS = ("user_id", "owner_id", "assignee_id")


def _ids(params: dict) -> list[tuple[str, str]]:
    """(campo, id) de todos os IDs citados, inclusive em listas aninhadas (KRs do objetivo)."""
    out: list[tuple[str, str]] = []
    for k, v in params.items():
        if isinstance(v, str) and (k in _SCOPE_SQL or k in _PERSON_FIELDS):
            out.append((k, v))
        elif isinstance(v, list):
            for x in v:
                if isinstance(x, dict):
                    out += _ids(x)
    return out


def _check_scope(ctx: Ctx, workspace_id: str, params: dict) -> None:
    for k, v in _ids(params):
        if k in _PERSON_FIELDS:
            ok = ctx.one(
                "SELECT 1 AS x FROM workspace_members WHERE workspace_id=%s AND user_id=%s",
                (workspace_id, v),
            )
            if not ok:
                raise BadRequestError("A pessoa indicada não faz parte deste espaço.")
            continue
        row = ctx.one(_SCOPE_SQL[k], (v,))
        if not row or row["ws"] != workspace_id:
            raise ForbiddenError()


# ------------------------------------------------------------------ execução


def execute(ctx: Ctx, workspace_id: str, timezone: str, steps: list[dict]) -> list[dict]:
    """Executa os passos em ordem, na transação de quem chamou: falhou um, não grava nenhum."""
    r = Run(ctx, workspace_id, timezone)
    out = []
    for i, st in enumerate(steps, 1):
        action = BY_NAME[st["action"]]
        model = action.params.model_validate(st["params"])
        try:
            _check_scope(ctx, workspace_id, st["params"])
            out.append(action.run(r, model))
        except AppError as e:
            if len(steps) > 1:
                # Mesma exceção (mesmo status HTTP), com o passo que falhou na mensagem.
                e.message = f"Passo {i} ({action.label}): {e.message}"
                e.args = (e.message,)
            raise
    return out


def dry_run(ctx: Ctx, workspace_id: str, timezone: str, steps: list[dict]) -> None:
    """Simula o plano num SAVEPOINT desfeito: o erro real do serviço aparece já na proposta."""

    class _Undo(Exception):
        pass

    try:
        with ctx.conn.transaction():
            execute(ctx, workspace_id, timezone, steps)
            raise _Undo
    except _Undo:
        pass
    except psycopg.Error as e:
        # Restrição do banco que o serviço não traduziu: recusa a proposta sem quebrar a rodada.
        raise BadRequestError(
            "Os dados do plano não passaram na validação do banco. Revise os valores e tente de novo."
        ) from e


# ------------------------------------------------------------------ prévia

_NAME_SQL = {
    "project_id": "SELECT name AS n FROM projects WHERE id=%s",
    "task_id": "SELECT title AS n FROM tasks WHERE id=%s",
    "depends_on_id": "SELECT title AS n FROM tasks WHERE id=%s",
    "parent_id": "SELECT title AS n FROM tasks WHERE id=%s",
    "sprint_id": "SELECT name AS n FROM sprints WHERE id=%s",
    "risk_id": "SELECT 'R' || number || ' — ' || title AS n FROM project_risks WHERE id=%s",
    "phase_id": "SELECT name AS n FROM project_phases WHERE id=%s",
    "baseline_id": "SELECT COALESCE(NULLIF(name, ''), 'Linha de base ' || number) AS n FROM baselines WHERE id=%s",
    "objective_id": "SELECT title AS n FROM objectives WHERE id=%s",
    "key_result_id": "SELECT title AS n FROM key_results WHERE id=%s",
    "folder_id": "SELECT name AS n FROM project_folders WHERE id=%s",
    "comment_id": "SELECT left(body, 80) AS n FROM task_comments WHERE id=%s",
    "invitation_id": "SELECT email AS n FROM invitations WHERE id=%s",
    "user_id": "SELECT name AS n FROM users WHERE id=%s",
    "owner_id": "SELECT name AS n FROM users WHERE id=%s",
    "assignee_id": "SELECT name AS n FROM users WHERE id=%s",
}  # fmt: skip


def _name(ctx: Ctx, workspace_id: str, key: str, value: str) -> str:
    """Nome legível de um ID — só depois de conferir que ele é do espaço da proposta."""
    try:
        _check_scope(ctx, workspace_id, {key: value})
    except AppError:
        return "(indisponível)"
    row = ctx.one(_NAME_SQL[key], (value,))
    return row["n"] if row else "(removido)"


def _shape(annotation: Any, metadata: list | None = None) -> tuple[str, Any]:
    """Forma de um campo: (date|id|literal|list|dict|bool|number|str, detalhe).

    O pydantic move o `Annotated` de primeiro nível para `field.metadata`; dentro de `X | None`
    ele continua na anotação. Os dois casos chegam aqui.
    """
    if typing.get_origin(annotation) in (typing.Union, types.UnionType):
        rest = [a for a in typing.get_args(annotation) if a is not type(None)]
        if len(rest) == 1:
            annotation = rest[0]
    meta = list(metadata or [])
    if typing.get_origin(annotation) is Annotated:
        annotation, *more = typing.get_args(annotation)
        meta += more
    funcs = {getattr(m, "func", None) for m in meta}
    if _date in funcs:
        return "date", None
    if _uuid in funcs:
        return "id", None
    origin = typing.get_origin(annotation)
    if origin is Literal:
        return "literal", [str(x) for x in typing.get_args(annotation)]
    if origin is list:
        return "list", _shape(typing.get_args(annotation)[0])
    if origin is dict:
        return "dict", None
    if annotation is bool:
        return "bool", None
    if annotation in (int, float):
        return "number", None
    if isinstance(annotation, type) and issubclass(annotation, BaseModel):
        return "model", list(annotation.model_fields)
    if annotation is str:
        return "str", next((m.max_length for m in meta if getattr(m, "max_length", None)), None)
    return "other", None


def _input(field: Any) -> tuple[str | None, list[str] | None]:
    """(tipo de campo na prévia, opções). None = só leitura (IDs, listas de objetos)."""
    kind, extra = _shape(field.annotation, field.metadata)
    if kind == "literal":
        return "select", extra
    if kind == "list":
        inner, opts = extra
        if inner == "literal":
            return "multi", opts
        return ("tags", None) if inner == "str" else (None, None)
    if kind == "str":
        return ("textarea" if extra and extra > 300 else "text"), None
    return {"date": "date", "bool": "checkbox", "number": "number"}.get(kind), None


def _display(ctx: Ctx, ws: str, key: str, value: Any) -> str:
    if value is None or value == "" or value == []:
        return "—"
    if key in _NAME_SQL and isinstance(value, str):
        return _name(ctx, ws, key, value)
    labels = OPTION_LABEL.get(key, {})
    if isinstance(value, bool):
        return "sim" if value else "não"
    if isinstance(value, list):
        return ", ".join(
            labels.get(str(x), str(x)) if not isinstance(x, dict) else str(x.get("title") or x.get("name") or x)
            for x in value
        )
    if isinstance(value, str) and key.endswith(("date", "_due")) and len(value) == 10:
        y, m, d = value.split("-")
        return f"{d}/{m}/{y}"
    return labels.get(str(value), str(value))


def preview(ctx: Ctx, workspace_id: str, steps: list[dict]) -> dict:
    """Prévia legível e editável: cada passo com seus campos, nomes no lugar de IDs."""
    out = []
    for st in steps:
        action = BY_NAME[st["action"]]
        fields = []
        for key, value in st["params"].items():
            if key in HIDDEN:
                continue
            f = action.params.model_fields.get(key)
            if f is None:
                continue
            if key == "content" and isinstance(value, dict):  # termo: um campo por item
                for ck, cv in value.items():
                    fields.append(
                        {
                            "key": f"content.{ck}",
                            "label": ck.replace("_", " ").capitalize(),
                            "value": cv,
                            "display": cv,
                            "input": "textarea",
                        }
                    )
                continue
            kind, options = _input(f)
            item: dict[str, Any] = {
                "key": key,
                "label": f.title or key,
                "value": value,
                "display": _display(ctx, workspace_id, key, value),
                "input": kind,
            }
            if options is not None:
                labels = OPTION_LABEL.get(key, {})
                item["options"] = [{"value": o, "label": labels.get(o, o)} for o in options]
            fields.append(item)
        out.append(
            {"action": action.name, "label": action.label, "danger": action.danger, "fields": fields}
        )
    return {"steps": out, "danger": any(s["danger"] for s in out)}


def needs_project(name: str) -> bool:
    f = BY_NAME[name].params.model_fields.get("project_id")
    return bool(f and f.is_required())


def known_project(ctx: Ctx, project_id: str) -> dict:
    return project_access(ctx, project_id).project


# ------------------------------------------------------------------ catálogo para o modelo

# Campo de ID -> chave por nome que o modelo pode usar no lugar dele.
REF_OF = {
    "project_id": "project",
    "task_id": "task",
    "parent_id": "parent",
    "depends_on_id": "depends_on",
    "user_id": "person",
    "assignee_id": "assignee",
    "owner_id": "owner",
    "sprint_id": "sprint",
    "risk_id": "risk",
    "phase_id": "phase",
    "baseline_id": "baseline",
    "objective_id": "objective",
    "key_result_id": "key_result",
    "folder_id": "folder",
    "invitation_id": "invitation",
}


def _hint(field: Any) -> str:
    def text(shape: tuple[str, Any]) -> str:
        kind, extra = shape
        if kind == "literal":
            return "|".join(x for x in extra if x)
        if kind == "list":
            inner = text(extra)
            return f"lista[{inner}]" if inner else "lista"
        if kind == "model":
            return "{" + ", ".join(extra) + "}"
        return {"date": "AAAA-MM-DD", "bool": "bool", "number": "número", "dict": "objeto"}.get(
            kind, ""
        )

    return text(_shape(field.annotation, field.metadata))


def catalog() -> str:
    lines = []
    for a in ACTIONS:
        parts = []
        for name, f in a.params.model_fields.items():
            if name in HIDDEN:
                continue
            key = REF_OF.get(name, name)
            h = _hint(f)
            parts.append(key + ("*" if f.is_required() else "") + (f"({h})" if h else ""))
        line = f"- {a.name}: {a.label}" + (f" [{', '.join(parts)}]" if parts else "")
        if a.danger:
            line += " ⚠"
        if a.hint:
            line += f" — {a.hint}"
        lines.append(line)
    return "\n".join(lines)
