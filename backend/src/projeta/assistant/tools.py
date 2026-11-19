"""Ferramentas do assistente. Identidade, espaço e permissões vêm do Ctx da sessão, nunca dos argumentos.

O assistente enxerga exatamente o que a pessoa enxerga: toda consulta passa pelos mesmos filtros de
visibilidade (`VISIBLE_PROJECT`, `project_access`, `task_access`) usados pela interface.

Saídas são enxutas (limites de itens e de texto) e conteúdo escrito por pessoas (títulos,
descrições, comentários, campos livres) é devolvido dentro de campos de dados — nunca como instrução.
"""

from __future__ import annotations

import unicodedata
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from pydantic import BaseModel, Field, ValidationError

from ..db import Ctx
from ..errors import AppError
from ..identity.access import VISIBLE_PROJECT, is_uuid, project_access, role_in
from ..settings import get_settings
from ..work import comments, formal, projects, tasks
from ..work.today import add_days, get_today, today_in
from . import proposals
from .payloads import MAX_WBS_TASKS

MAX_ITEMS = 20
CLIP = 120

ACTIVITY_LABEL = {
    "project.created": "criou o projeto",
    "project.archived": "arquivou o projeto",
    "project.restored": "reativou o projeto",
    "project.member_added": "adicionou uma pessoa ao projeto",
    "project.invited": "convidou uma pessoa pela matrícula",
    "project.roles_set": "definiu funções no projeto",
    "project.phase_changed": "mudou a fase do projeto",
    "project.status_note": "publicou nota de acompanhamento",
    "project.progress_set": "atualizou o % concluído do projeto",
    "project.tap_saved": "salvou o Termo de Abertura",
    "project.tep_saved": "salvou o Termo de Encerramento",
    "task.created": "criou a tarefa",
    "task.updated": "editou a tarefa",
    "task.status_changed": "mudou o estado da tarefa",
    "task.deleted": "removeu a tarefa",
    "task.commented": "comentou na tarefa",
}
WEEKDAY = ("segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado", "domingo")  # fmt: skip
_ME = {"eu", "mim", "me", "comigo"}
_NOBODY = {"ninguem", "nenhum", "sem responsavel", "sem dono", "none"}


def _clip(s: str | None, n: int = CLIP) -> str:
    s = (s or "").replace("\n", " ").strip()
    return s if len(s) <= n else s[: n - 1] + "…"


def _norm(s: str) -> str:
    return unicodedata.normalize("NFD", s.casefold()).encode("ascii", "ignore").decode().strip()


def _like(q: str) -> str:
    return "%" + q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


@dataclass
class Session:
    """Estado de uma rodada do assistente: contexto autorizado + o que as ferramentas produziram."""

    ctx: Ctx
    workspace_id: str
    conversation_id: str
    timezone: str
    project_id: str | None = None
    links: list[dict] = field(default_factory=list)
    proposal: dict | None = None
    candidates: list[dict] = field(default_factory=list)
    pending_action: dict | None = None

    def link(self, label: str, href: str) -> None:
        if not any(link["href"] == href for link in self.links) and len(self.links) < 15:
            self.links.append({"label": _clip(label, 80), "href": href})


def _task_item(s: Session, t: dict) -> dict:
    href = proposals.task_href(t)
    s.link(t["title"], href)
    item = {
        "id": t["id"],
        "titulo": _clip(t["title"]),
        "estado": t["status"],
        "prioridade": t["priority"],
        "prazo": t["due_date"],
        "projeto": _clip(t["project_name"], 60) if t["project_name"] else "pessoal",
        "responsavel": t["assignee_name"],
        "link": href,
    }
    if t.get("progress"):
        item["progresso"] = t["progress"]
    if t.get("parent_title"):
        item["subtarefa_de"] = _clip(t["parent_title"], 60)
    return item


# ------------------------------------------------------------------ resolução de nomes


def _find_project(s: Session, name: str) -> str:
    """Nome (ou parte) -> id, só entre projetos que a pessoa vê. Ambiguidade volta para o modelo."""
    q = name.strip()
    if not q:
        raise AppError("Informe o nome do projeto.")
    rows = s.ctx.all(
        f"""SELECT p.id, p.name, p.status FROM projects p
        WHERE p.workspace_id = %(ws)s AND {VISIBLE_PROJECT} AND p.name ILIKE %(q)s
        ORDER BY p.status, p.name LIMIT 10""",
        {"ws": s.workspace_id, "uid": s.ctx.user_id, "q": _like(q)},
    )
    if not rows:
        raise AppError(
            f"Não encontrei projeto visível com “{_clip(q, 60)}”. Use portfolio para ver os nomes."
        )
    exact = [r for r in rows if _norm(r["name"]) == _norm(q)]
    if len(exact) == 1:
        return exact[0]["id"]
    if len(rows) == 1:
        return rows[0]["id"]
    names = "; ".join(_clip(r["name"], 60) for r in rows)
    raise AppError(
        f"Mais de um projeto corresponde a “{_clip(q, 60)}”: {names}. Pergunte qual é o certo."
    )


def _pid(s: Session, project_id: str | None, project_name: str | None = None) -> str:
    if project_id:
        if not is_uuid(project_id):
            raise AppError("project_id inválido. Use project_name com o nome do projeto.")
        return project_id
    if project_name:
        return _find_project(s, project_name)
    if s.project_id:
        return s.project_id
    raise AppError("Informe de qual projeto você está falando (abra o projeto ou diga o nome).")


def _optional_pid(s: Session, project_id: str | None, project_name: str | None) -> str | None:
    if not project_id and not project_name:
        return None
    pid = _pid(s, project_id, project_name)
    project_access(s.ctx, pid)
    return pid


def _people(s: Session, who: str) -> list[dict]:
    """Membros do espaço cujo nome ou e-mail contém o texto."""
    return s.ctx.all(
        "SELECT u.id, u.name FROM workspace_members wm JOIN users u ON u.id = wm.user_id "
        "WHERE wm.workspace_id = %s AND (u.name ILIKE %s OR u.email ILIKE %s) ORDER BY u.name LIMIT 10",
        (s.workspace_id, _like(who), _like(who)),
    )


def _one_person(s: Session, who: str) -> str | None:
    """'eu' -> a própria pessoa; 'ninguém' -> None; nome -> id único (senão erro para o modelo)."""
    n = _norm(who)
    if n in _ME:
        return s.ctx.user_id
    if n in _NOBODY:
        return None
    rows = _people(s, who)
    exact = [r for r in rows if _norm(r["name"]) == n]
    if len(exact) == 1 or len(rows) == 1:
        return (exact or rows)[0]["id"]
    if not rows:
        raise AppError(f"Ninguém no espaço corresponde a “{_clip(who, 60)}”.")
    names = "; ".join(r["name"] for r in rows)
    raise AppError(f"Mais de uma pessoa corresponde a “{_clip(who, 60)}”: {names}. Pergunte qual.")


def _resolve_task(
    s: Session, task_id: str | None, task_query: str | None, pending: dict
) -> str | dict:
    """id da tarefa, ou um resultado pronto para o modelo (não encontrada / ambígua).

    Na ambiguidade a interface mostra as opções e o servidor guarda `pending` para concluir a ação
    com a tarefa escolhida — o modelo não adivinha.
    """
    if task_id:
        return task_id
    if not task_query:
        raise AppError("Informe a tarefa (id ou parte do título).")
    rows = tasks.search_visible(
        s.ctx, s.workspace_id, query=task_query, include_done=True, project_id=s.project_id, limit=8
    )
    if not rows and s.project_id:
        rows = tasks.search_visible(
            s.ctx, s.workspace_id, query=task_query, include_done=True, limit=8
        )
    if not rows:
        return {
            "erro": f"Nenhuma tarefa encontrada para “{_clip(task_query, 60)}”. Peça ao usuário o nome exato."
        }
    exact = [r for r in rows if _norm(r["title"]) == _norm(task_query)]
    if len(exact) == 1:
        return exact[0]["id"]
    if len(rows) > 1:
        s.candidates = [
            {
                "task_id": r["id"],
                "label": r["title"],
                "project": r["project_name"],
                "due_date": r["due_date"],
                "status": r["status"],
            }
            for r in rows
        ]
        s.pending_action = pending
        return {
            "ambiguo": True,
            "instrucao": "Há mais de uma tarefa com esse nome. A interface mostrará as opções ao usuário; peça que escolha uma.",
        }
    return rows[0]["id"]


def _activity_item(r: dict) -> dict:
    data = r["data"] or {}
    item: dict[str, Any] = {
        "quando": r["created_at"].isoformat(timespec="minutes"),
        "quem": r["actor_name"],
        "acao": ACTIVITY_LABEL.get(r["kind"], r["kind"]),
    }
    if r.get("project_name"):
        item["projeto"] = _clip(r["project_name"], 60)
    if data.get("title"):
        item["tarefa"] = _clip(data["title"], 80)
    changes = data.get("changes") or {}
    if "status" in changes:
        item["estado"] = f"{changes['status']['from']} → {changes['status']['to']}"
    other = [k for k in changes if k != "status"]
    if other:
        item["campos_alterados"] = other
    if r["kind"] == "project.phase_changed" and data.get("phase"):
        item["fase"] = formal.PHASE_LABEL.get(data["phase"], data["phase"])
    if r["kind"] == "project.status_note" and data.get("state"):
        item["situacao"] = data["state"]
    if r.get("via") == "assistant":
        item["via"] = "assistente"
    return item


# ------------------------------------------------------------------ argumentos validados


class NoArgs(BaseModel):
    pass


class TasksDueArgs(BaseModel):
    date_from: str | None = Field(default=None, description="AAAA-MM-DD; padrão: hoje")
    date_to: str | None = Field(default=None, description="AAAA-MM-DD; padrão: igual a date_from")
    include_overdue: bool = False


class FindTasksArgs(BaseModel):
    query: str | None = Field(
        default=None,
        max_length=120,
        description="parte do título; omita para filtrar só por campos",
    )
    project_id: str | None = None
    project_name: str | None = Field(default=None, max_length=120, description="nome ou parte")
    status: Literal["todo", "doing", "blocked", "done"] | None = None
    priority: Literal["low", "medium", "high"] | None = None
    assignee: str | None = Field(
        default=None, max_length=80, description="'eu', 'ninguém' ou parte do nome da pessoa"
    )
    due: Literal["atrasadas", "hoje", "semana", "sem_prazo"] | None = None
    include_done: bool | None = Field(
        default=None, description="padrão: sim quando há query, não quando só há filtros"
    )
    limit: int = Field(default=MAX_ITEMS, ge=1, le=50)


class StalledArgs(BaseModel):
    days: int | None = Field(
        default=None, ge=1, le=365, description="dias sem atividade; padrão do sistema"
    )


class ProjectArg(BaseModel):
    project_id: str | None = Field(default=None, description="padrão: projeto em tela")
    project_name: str | None = Field(
        default=None, max_length=120, description="nome ou parte do nome, se não houver id"
    )


class OptionalProjectArg(BaseModel):
    project_id: str | None = Field(default=None, description="omita para todos os projetos")
    project_name: str | None = Field(default=None, max_length=120)


class ActivityArgs(OptionalProjectArg):
    days: int = Field(default=7, ge=1, le=90)


class PortfolioArgs(BaseModel):
    query: str | None = Field(
        default=None, max_length=80, description="filtra por nome, resumo ou campo livre"
    )
    health: Literal["on_track", "at_risk", "late"] | None = None


class TaskRef(BaseModel):
    task_id: str | None = None
    task_query: str | None = Field(
        default=None, max_length=120, description="título aproximado, se o id for desconhecido"
    )


class ProposeTask(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    due_date: str | None = None
    priority: Literal["low", "medium", "high"] | None = None
    description: str | None = Field(default=None, max_length=2000)


class ProposeCreateArgs(BaseModel):
    tasks: list[ProposeTask] = Field(min_length=1, max_length=30)
    project_id: str | None = Field(
        default=None, description="omitir = tarefas pessoais (ou projeto em tela)"
    )
    project_name: str | None = Field(default=None, max_length=120)


class ProposeUpdateArgs(TaskRef):
    status: Literal["todo", "doing", "blocked", "done"] | None = None
    due_date: str | None = None
    clear_due_date: bool = False
    progress: int | None = Field(default=None, ge=0, le=100)
    priority: Literal["low", "medium", "high"] | None = None
    assignee: str | None = Field(
        default=None, max_length=80, description="novo responsável: nome, 'eu' ou 'ninguém'"
    )


class ProposeCommentArgs(TaskRef):
    body: str = Field(min_length=1, max_length=5000, description="texto do comentário")


class WbsTaskArg(BaseModel):
    ref: str
    title: str
    due_in_days: int | None = Field(
        default=None, ge=0, le=1500, description="dias a partir do início"
    )
    estimate_hours: float | None = Field(default=None, ge=0, le=2000)
    is_milestone: bool = False
    depends_on: list[str] = Field(default_factory=list)


class WbsPhaseArg(BaseModel):
    name: str
    tasks: list[WbsTaskArg]


class ProposeWbsArgs(BaseModel):
    project_name: str | None = Field(
        default=None, description="nome do novo projeto, se não houver projeto em tela"
    )
    project_id: str | None = None
    summary: str = ""
    assumptions: list[str] = Field(default_factory=list)
    phases: list[WbsPhaseArg] = Field(min_length=1)


class ProposeStatusNoteArgs(BaseModel):
    project_id: str | None = Field(default=None, description="padrão: projeto em tela")
    project_name: str | None = Field(default=None, max_length=120)
    delay_reason: str = Field(
        default="",
        max_length=2000,
        description="justificativa do atraso, SOMENTE se o usuário a informou; nunca invente",
    )


# ------------------------------------------------------------------ consultas


def tool_my_day(s: Session, _: NoArgs) -> dict:
    d = get_today(s.ctx, s.workspace_id, s.timezone)

    def items(xs: list[dict]) -> list[dict]:
        return [_task_item(s, t) for t in xs[:MAX_ITEMS]]

    return {
        "hoje": d["today"],
        "atrasadas": items(d["overdue"]),
        "vencem_hoje": items(d["due_today"]),
        "proximos_7_dias": items(d["upcoming"]),
        "prioridade_alta": items(d["priorities"]),
        "sem_prazo_recentes": items(d["inbox"]),
        "totais": {
            "atrasadas": len(d["overdue"]),
            "vencem_hoje": len(d["due_today"]),
            "proximos_7_dias": len(d["upcoming"]),
        },
        "nota": "Tarefas da pessoa: atribuídas a ela em projetos e as pessoais.",
    }


def tool_tasks_due(s: Session, a: TasksDueArgs) -> dict:
    today = today_in(s.timezone)
    start = a.date_from or today
    end = a.date_to or start
    rows = tasks.search_visible(
        s.ctx,
        s.workspace_id,
        due_from=None if a.include_overdue else start,
        due_to=end,
        limit=MAX_ITEMS,
    )
    if a.include_overdue:
        rows = [r for r in rows if r["due_date"]]
    items = [_task_item(s, r) for r in rows]
    items.sort(
        key=lambda x: ({"high": 0, "medium": 1, "low": 2}[x["prioridade"]], x["prazo"] or "")
    )
    return {
        "hoje": today,
        "periodo": [start, end],
        "total": len(items),
        "tarefas": items,
        "nota": "Tarefas em aberto que você pode ver (suas e dos projetos de que participa).",
    }


def tool_find_tasks(s: Session, a: FindTasksArgs) -> dict:
    today = today_in(s.timezone)
    pid = _optional_pid(s, a.project_id, a.project_name)
    include_done = a.include_done if a.include_done is not None else bool(a.query)
    due_from = due_to = None
    if a.due == "atrasadas":
        due_to, include_done = add_days(today, -1), False
    elif a.due == "hoje":
        due_from = due_to = today
    elif a.due == "semana":
        due_from, due_to = today, add_days(today, 7)
    assignee_ids, unassigned = None, False
    if a.assignee:
        n = _norm(a.assignee)
        if n in _ME:
            assignee_ids = [s.ctx.user_id]
        elif n in _NOBODY:
            unassigned = True
        else:
            people = _people(s, a.assignee)
            if not people:
                return {"erro": f"Ninguém no espaço corresponde a “{_clip(a.assignee, 60)}”."}
            assignee_ids = [p["id"] for p in people]
    rows = tasks.search_visible(
        s.ctx,
        s.workspace_id,
        due_from=due_from,
        due_to=due_to,
        query=a.query,
        project_id=pid,
        status=a.status,
        include_done=include_done,
        limit=a.limit,
        priority=a.priority,
        assignee_ids=assignee_ids,
        unassigned=unassigned,
        no_due=a.due == "sem_prazo",
    )
    out: dict[str, Any] = {"total": len(rows), "tarefas": [_task_item(s, r) for r in rows]}
    if len(rows) >= a.limit:
        out["nota"] = f"Mostrando as primeiras {a.limit}; refine os filtros para ver o restante."
    return out


def tool_task_details(s: Session, a: TaskRef) -> dict:
    if a.task_id:
        tid = a.task_id
    elif a.task_query:
        rows = tasks.search_visible(
            s.ctx, s.workspace_id, query=a.task_query, include_done=True, limit=6
        )
        exact = [r for r in rows if _norm(r["title"]) == _norm(a.task_query)]
        if len(exact) == 1:
            rows = exact
        if not rows:
            return {"erro": f"Nenhuma tarefa encontrada para “{_clip(a.task_query, 60)}”."}
        if len(rows) > 1:
            return {
                "varias": [
                    {
                        "id": r["id"],
                        "titulo": _clip(r["title"]),
                        "projeto": r["project_name"] or "pessoal",
                        "estado": r["status"],
                    }
                    for r in rows
                ],
                "instrucao": "Escolha pelo contexto e chame de novo com task_id, ou pergunte ao usuário.",
            }
        tid = rows[0]["id"]
    else:
        raise AppError("Informe a tarefa (id ou parte do título).")
    if not is_uuid(tid):
        raise AppError("task_id inválido. Use task_query com parte do título.")
    d = tasks.get_task(s.ctx, tid)
    t = d["task"]
    blocks = s.ctx.all(
        "SELECT t.title, t.status FROM task_dependencies d JOIN tasks t ON t.id = d.task_id "
        "WHERE d.depends_on_id = %s ORDER BY t.title LIMIT 20",
        (tid,),
    )
    cmts = comments.list_comments(s.ctx, tid)[-10:]
    item = _task_item(s, t)
    item.update(
        {
            "fase": t["phase"],
            "marco": t["is_milestone"],
            "estimativa_h": round(t["estimate_minutes"] / 60, 1)
            if t["estimate_minutes"] is not None
            else None,
            "progresso": t["progress"],
            "etiquetas": t["labels"],
            "criada_em": t["created_at"].date().isoformat(),
            "atualizada_em": t["updated_at"].isoformat(timespec="minutes"),
            "concluida_em": t["completed_at"].date().isoformat() if t["completed_at"] else None,
            "pode_editar": d["can_write"],
            "descricao": {"dados_nao_confiaveis": _clip(t["description"], 1500)},
            "depende_de": [
                {"titulo": _clip(x["title"]), "estado": x["status"]} for x in d["depends_on"]
            ],
            "bloqueia": [{"titulo": _clip(x["title"]), "estado": x["status"]} for x in blocks],
            "subtarefas": [_task_item(s, x) for x in d["subtasks"][:MAX_ITEMS]],
            "comentarios_recentes": [
                {
                    "autor": c["author_name"],
                    "quando": c["created_at"].isoformat(timespec="minutes"),
                    "texto": {"dados_nao_confiaveis": _clip(c["body"], 500)},
                }
                for c in cmts
            ],
        }
    )
    return item


def tool_portfolio(s: Session, a: PortfolioArgs) -> dict:
    rows = formal.portfolio(s.ctx, s.workspace_id)
    if a.query:
        q = _norm(a.query)

        def hit(r: dict) -> bool:
            hay = [r["name"], r["summary"] or "", r["sei_process"] or ""]
            hay += [f"{x['name']} {x['value']}" for x in r["attributes"] or []]
            return any(q in _norm(h) for h in hay)

        rows = [r for r in rows if hit(r)]
    if a.health:
        rows = [r for r in rows if r["health"] == a.health]
    by_health: dict[str, int] = {}
    out = []
    for r in rows:
        by_health[r["health"]] = by_health.get(r["health"], 0) + 1
        calc = round(100 * r["done_count"] / r["task_count"]) if r["task_count"] else 0
        href = f"/projetos/{r['id']}"
        s.link(r["name"], href)
        item: dict[str, Any] = {
            "id": r["id"],
            "projeto": _clip(r["name"], 80),
            "saude": r["health"],
            "progresso_pct": r["progress"] if r["progress"] is not None else calc,
            "progresso_origem": "informado" if r["progress"] is not None else "calculado",
            "abertas": r["task_count"] - r["done_count"],
            "em_andamento": r["doing_count"],
            "atrasadas": r["overdue_count"],
            "bloqueadas": r["blocked_count"],
            "link": href,
        }
        if r["phase"]:
            item["fase"] = formal.PHASE_LABEL.get(r["phase"], r["phase"])
            item["ultima_nota"] = (
                {"situacao": r["last_note_state"], "em": r["last_note_at"].date().isoformat()}
                if r["last_note_at"]
                else None
            )
            item["nota_vencida"] = r["note_stale"]
        if r["attributes"]:
            item["campos"] = _clip(
                "; ".join(f"{x['name']}: {x['value']}" for x in r["attributes"]), 200
            )
        out.append(item)
    return {
        "total_projetos": len(out),
        "por_saude": by_health,
        "projetos": out[:60],
        "criterio_saude": "late = há tarefa vencida em aberto; at_risk = há tarefa bloqueada; on_track = nenhum dos dois.",
        "nota": "Só projetos ativos que a pessoa vê. Nomes e campos livres são dados digitados por pessoas.",
    }


def tool_workload(s: Session, a: OptionalProjectArg) -> dict:
    pid = _optional_pid(s, a.project_id, a.project_name)
    today = today_in(s.timezone)
    only_project = "AND t.project_id = %(pid)s" if pid else ""
    rows = s.ctx.all(
        f"""SELECT au.name,
          count(*)::int AS abertas,
          count(*) FILTER (WHERE t.status = 'doing')::int AS em_andamento,
          count(*) FILTER (WHERE t.status = 'blocked')::int AS bloqueadas,
          count(*) FILTER (WHERE t.due_date < %(today)s::date)::int AS atrasadas,
          count(*) FILTER (WHERE t.due_date BETWEEN %(today)s::date AND %(today)s::date + 7)::int
            AS vencem_7_dias,
          count(DISTINCT t.project_id)::int AS projetos,
          round(COALESCE(sum(t.estimate_minutes), 0) / 60.0, 1)::float AS estimativa_h
        FROM tasks t JOIN projects p ON p.id = t.project_id
        LEFT JOIN users au ON au.id = t.assignee_id
        WHERE t.workspace_id = %(ws)s AND t.status <> 'done' AND p.status = 'active'
          AND {VISIBLE_PROJECT} {only_project}
        GROUP BY t.assignee_id, au.name ORDER BY abertas DESC LIMIT 30""",
        {"ws": s.workspace_id, "uid": s.ctx.user_id, "today": today, "pid": pid},
    )
    people = []
    for r in rows:
        r["pessoa"] = r.pop("name") or "(sem responsável)"
        people.append(r)
    return {
        "hoje": today,
        "escopo": "projeto" if pid else "todos os projetos ativos visíveis",
        "por_pessoa": people,
        "nota": "Só tarefas de projeto em aberto; tarefas pessoais são privadas e não entram.",
    }


def tool_recent_activity(s: Session, a: ActivityArgs) -> dict:
    pid = _optional_pid(s, a.project_id, a.project_name)
    cutoff = datetime.now(UTC) - timedelta(days=a.days)
    only_project = "AND a.project_id = %(pid)s" if pid else ""
    rows = s.ctx.all(
        f"""SELECT a.kind, a.data, a.via, a.created_at, p.name AS project_name, u.name AS actor_name
        FROM activity a JOIN projects p ON p.id = a.project_id
        LEFT JOIN users u ON u.id = a.actor_id
        WHERE a.workspace_id = %(ws)s AND a.created_at >= %(cut)s AND {VISIBLE_PROJECT}
          {only_project}
        ORDER BY a.created_at DESC LIMIT 40""",
        {"ws": s.workspace_id, "uid": s.ctx.user_id, "cut": cutoff, "pid": pid},
    )
    counts: dict[str, int] = {}
    for r in rows:
        label = ACTIVITY_LABEL.get(r["kind"], r["kind"])
        counts[label] = counts.get(label, 0) + 1
    return {
        "periodo_dias": a.days,
        "total": len(rows),
        "por_acao": counts,
        "eventos": [_activity_item(r) for r in rows],
        "nota": "Mostra no máximo os 40 eventos mais recentes.",
    }


def tool_stalled_projects(s: Session, a: StalledArgs) -> dict:
    days = a.days or get_settings().inactivity_days
    cutoff = datetime.now(UTC) - timedelta(days=days)
    rows = s.ctx.all(
        f"""SELECT p.id, p.name, COALESCE(max(a.created_at), p.created_at) AS last_activity
        FROM projects p LEFT JOIN activity a ON a.project_id = p.id
        WHERE p.workspace_id = %(ws)s AND p.status = 'active' AND {VISIBLE_PROJECT}
        GROUP BY p.id HAVING COALESCE(max(a.created_at), p.created_at) < %(cut)s
        ORDER BY 3 LIMIT {MAX_ITEMS}""",
        {"ws": s.workspace_id, "uid": s.ctx.user_id, "cut": cutoff},
    )
    out = []
    for r in rows:
        href = f"/projetos/{r['id']}"
        s.link(r["name"], href)
        out.append(
            {
                "projeto": _clip(r["name"], 80),
                "ultima_atividade": r["last_activity"].isoformat(),
                "link": href,
            }
        )
    return {
        "criterio": f"projeto ativo sem nenhuma atividade registrada há mais de {days} dias",
        "limite_dias": days,
        "total": len(out),
        "projetos": out,
    }


def tool_blockers(s: Session, a: ProjectArg) -> dict:
    pid = _pid(s, a.project_id, a.project_name)
    project_access(s.ctx, pid)
    blocked = s.ctx.all(
        f"{tasks.TASK_SELECT} WHERE t.project_id=%s AND t.status='blocked' ORDER BY t.due_date NULLS LAST LIMIT {MAX_ITEMS}",
        (pid,),
    )
    waiting = s.ctx.all(
        f"""{tasks.TASK_SELECT} WHERE t.project_id=%s AND t.status <> 'done' AND EXISTS (
            SELECT 1 FROM task_dependencies d JOIN tasks b ON b.id = d.depends_on_id
            WHERE d.task_id = t.id AND b.status <> 'done') AND t.status <> 'blocked' LIMIT {MAX_ITEMS}""",
        (pid,),
    )
    deps = s.ctx.all(
        "SELECT d.task_id, b.id AS bid, b.title, b.status FROM task_dependencies d JOIN tasks b ON b.id = d.depends_on_id "
        "WHERE d.task_id = ANY(%s::uuid[]) AND b.status <> 'done'",
        ([t["id"] for t in blocked + waiting],),
    )
    by_task: dict[str, list[dict]] = {}
    for d in deps:
        by_task.setdefault(d["task_id"], []).append(
            {"titulo": _clip(d["title"]), "estado": d["status"]}
        )

    def with_deps(t: dict) -> dict:
        item = _task_item(s, t)
        item["depende_de_pendentes"] = by_task.get(t["id"], [])
        return item

    return {
        "bloqueadas": [with_deps(t) for t in blocked],
        "aguardando_dependencias": [with_deps(t) for t in waiting],
        "nota": "Só aparecem dependências cadastradas na plataforma; bloqueios combinados fora dela não são conhecidos.",
    }


def tool_project_summary(s: Session, a: ProjectArg) -> dict:
    pid = _pid(s, a.project_id, a.project_name)
    detail = projects.get_project(s.ctx, pid)
    p = detail["project"]
    today = today_in(s.timezone)
    rows = s.ctx.all(
        f"{tasks.TASK_SELECT} WHERE t.project_id=%s ORDER BY t.due_date NULLS LAST", (pid,)
    )
    open_rows = [r for r in rows if r["status"] != "done"]
    overdue = [r for r in open_rows if r["due_date"] and r["due_date"] < today]
    nxt = [r for r in open_rows if r["due_date"] and r["due_date"] >= today][:5]
    milestones = [r for r in open_rows if r["is_milestone"]][:5]
    s.link(p["name"], f"/projetos/{pid}")
    counts: dict[str, int] = {}
    for r in rows:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    open_by_person: dict[str, int] = {}
    for r in open_rows:
        if r["assignee_id"]:
            open_by_person[r["assignee_id"]] = open_by_person.get(r["assignee_id"], 0) + 1
    gaps = []
    if open_rows and (n := sum(1 for r in open_rows if not r["assignee_id"])):
        gaps.append(f"{n} tarefa(s) em aberto sem responsável")
    if open_rows and (n := sum(1 for r in open_rows if not r["due_date"])):
        gaps.append(f"{n} tarefa(s) em aberto sem prazo")
    if open_rows and (n := sum(1 for r in open_rows if r["estimate_minutes"] is None)):
        gaps.append(f"{n} tarefa(s) em aberto sem estimativa")
    if not rows:
        gaps.append("o projeto ainda não tem tarefas")
    notes = formal.list_status_notes(s.ctx, pid, 1)
    last_note = notes[0] if notes else None
    if p["phase"] and (last_note is None or (datetime.now(UTC) - last_note["created_at"]).days > 7):
        gaps.append("nota semanal de acompanhamento vencida (mais de 7 dias)")
    last = detail["activity"][0]["created_at"] if detail["activity"] else None
    return {
        "projeto": _clip(p["name"], 80),
        "id": pid,
        "link": f"/projetos/{pid}",
        "situacao_cadastro": p["status"],
        "hoje": today,
        "pode_editar_tarefas": detail["can_write"],
        "pode_gerenciar": detail["can_manage"],
        "total_tarefas": len(rows),
        "por_estado": counts,
        "progresso_pct": round(100 * counts.get("done", 0) / len(rows)) if rows else 0,
        "progresso_informado_pct": p["progress"],
        "atrasadas": [_task_item(s, r) for r in overdue[:MAX_ITEMS]],
        "bloqueadas": [_task_item(s, r) for r in open_rows if r["status"] == "blocked"][:MAX_ITEMS],
        "proximos_prazos": [_task_item(s, r) for r in nxt],
        "marcos_em_aberto": [_task_item(s, r) for r in milestones],
        "ultima_atividade": last.isoformat() if last else None,
        "atividade_recente": [
            _activity_item({**r, "project_name": None}) for r in detail["activity"][:5]
        ],
        "lacunas": gaps,
        "ficha": {
            "fase": formal.PHASE_LABEL.get(p["phase"]) if p["phase"] else None,
            "abordagem": p["approach"],
            "processo_sei": p["sei_process"],
            "responsavel": p["responsible"] or None,
            "demandante": p["requester"] or None,
            "origem": p["external_ref"] or None,
            "resumo": {"dados_nao_confiaveis": _clip(p["summary"], 280)},
            "campos_livres": {
                "dados_nao_confiaveis": [
                    {"nome": x["name"], "valor": x["value"]} for x in p["attributes"] or []
                ]
            },
        },
        "equipe": [
            {
                "nome": m["name"],
                "funcoes": [formal.ROLE_LABEL.get(r, r) for r in m["project_roles"] or []],
                "tarefas_abertas": open_by_person.get(m["id"], 0),
            }
            for m in detail["members"][:20]
        ],
        "ultima_nota": {
            "situacao": last_note["state"],
            "em": last_note["created_at"].date().isoformat(),
            "autor": last_note["author_name"],
        }
        if last_note
        else None,
        "descricao_do_projeto": {"dados_nao_confiaveis": _clip(p["description"], 300)},
    }


# ------------------------------------------------------------------ propostas


def _store_proposal(s: Session, kind: str, payload: dict) -> dict:
    if s.proposal:
        # A resposta carrega uma única prévia; a segunda proposta ficaria invisível para a pessoa.
        raise AppError(
            "Já preparei uma proposta nesta resposta. Peça para a pessoa confirmá-la antes de preparar outra."
        )
    view = proposals.create_proposal(s.ctx, s.conversation_id, s.workspace_id, kind, payload)
    s.proposal = view
    return view


def _proposed(view: dict, instrucao: str) -> dict:
    return {
        "proposta_criada": True,
        "id": view["id"],
        "aguardando_confirmacao_do_usuario": True,
        "instrucao": instrucao,
    }


def tool_propose_create_tasks(s: Session, a: ProposeCreateArgs) -> dict:
    pid = (
        _pid(s, a.project_id, a.project_name) if (a.project_id or a.project_name) else s.project_id
    )
    if pid:
        role_in(s.ctx, s.workspace_id)
    view = _store_proposal(
        s,
        "create_tasks",
        {"project_id": pid, "tasks": [t.model_dump(exclude_none=True) for t in a.tasks]},
    )
    return _proposed(
        view, "Diga ao usuário para revisar a prévia e confirmar. Não afirme que algo foi criado."
    )


def tool_propose_update_task(s: Session, a: ProposeUpdateArgs) -> dict:
    changes: dict[str, Any] = {
        k: v
        for k, v in {
            "status": a.status,
            "due_date": a.due_date,
            "progress": a.progress,
            "priority": a.priority,
        }.items()
        if v is not None
    }
    if a.clear_due_date:
        changes["clear_due_date"] = True
    if a.assignee:
        who = _one_person(s, a.assignee)
        if who:
            changes["assignee_id"] = who
        else:
            changes["clear_assignee"] = True
    if not changes:
        raise AppError("Diga o que mudar: estado, prazo, progresso, prioridade ou responsável.")
    task = _resolve_task(s, a.task_id, a.task_query, {"kind": "update_task", "changes": changes})
    if isinstance(task, dict):
        return task
    view = _store_proposal(s, "update_task", {"task_id": task, "changes": changes})
    return _proposed(
        view,
        "Diga ao usuário para revisar o antes/depois e confirmar. Não afirme que já foi alterado.",
    )


def tool_propose_add_comment(s: Session, a: ProposeCommentArgs) -> dict:
    task = _resolve_task(s, a.task_id, a.task_query, {"kind": "add_comment", "body": a.body})
    if isinstance(task, dict):
        return task
    view = _store_proposal(s, "add_comment", {"task_id": task, "body": a.body})
    return _proposed(
        view, "Diga ao usuário para revisar o comentário e confirmar. Nada foi publicado ainda."
    )


def tool_propose_status_note(s: Session, a: ProposeStatusNoteArgs) -> dict:
    """Rascunho calculado das tarefas; a justificativa de atraso vem só do usuário."""
    pid = _pid(s, a.project_id, a.project_name)
    d = formal.draft_status_note(s.ctx, pid)
    if d["state"] == "late" and not a.delay_reason.strip():
        return {
            "erro": "O projeto tem tarefas atrasadas e a nota exige justificativa. "
            "Pergunte ao usuário o motivo do atraso e chame a ferramenta de novo com delay_reason.",
            "tarefas_atrasadas": [_clip(t["title"], 80) for t in d["overdue"][:5]],
        }
    view = _store_proposal(
        s,
        "status_note",
        {
            "project_id": pid,
            "state": d["state"],
            "delay_reason": a.delay_reason,
            "done": d["done"],
            "pending": d["pending"],
            "blockers": d["blockers"],
        },
    )
    return _proposed(
        view, "Diga ao usuário para revisar a nota e confirmar. Não afirme que foi publicada."
    )


def tool_propose_wbs(s: Session, a: ProposeWbsArgs) -> dict:
    start = proposals.default_start(s.ctx)
    pid = a.project_id or s.project_id
    total = sum(len(p.tasks) for p in a.phases)
    if total > MAX_WBS_TASKS:
        raise AppError(f"A EAP pode ter no máximo {MAX_WBS_TASKS} tarefas; reduza o escopo.")
    phases = []
    for p in a.phases:
        phases.append(
            {
                "name": p.name,
                "tasks": [
                    {
                        "ref": t.ref,
                        "title": t.title,
                        "is_milestone": t.is_milestone,
                        "depends_on": t.depends_on,
                        "due_date": add_days(start, t.due_in_days)
                        if t.due_in_days is not None
                        else None,
                        "estimate_minutes": round(t.estimate_hours * 60)
                        if t.estimate_hours is not None
                        else None,
                    }
                    for t in p.tasks
                ],
            }
        )
    view = _store_proposal(
        s,
        "apply_wbs",
        {
            "project_id": pid,
            "project_name": None if pid else (a.project_name or "Novo projeto"),
            "summary": a.summary,
            "assumptions": a.assumptions,
            "phases": phases,
        },
    )
    return _proposed(
        view, "Resuma a EAP e as premissas e peça revisão/confirmação. Nada foi criado ainda."
    )


@dataclass
class Tool:
    name: str
    description: str
    args: type[BaseModel]
    run: Any


TOOLS: list[Tool] = [
    Tool(
        "my_day",
        "Agenda da pessoa: atrasadas, vencem hoje, próximos 7 dias, prioridade alta e itens sem prazo. Use para 'meu dia', 'o que faço agora', 'como estou'.",
        NoArgs,
        tool_my_day,
    ),
    Tool(
        "tasks_due",
        "Lista tarefas em aberto com prazo no período (padrão: hoje), com links. Use para 'o que vence hoje/nesta semana'.",
        TasksDueArgs,
        tool_tasks_due,
    ),
    Tool(
        "find_tasks",
        "Busca tarefas visíveis por título e/ou filtros: projeto (id ou nome), estado, prioridade, responsável ('eu', 'ninguém' ou nome) e prazo (atrasadas, hoje, semana, sem_prazo).",
        FindTasksArgs,
        tool_find_tasks,
    ),
    Tool(
        "task_details",
        "Tudo sobre uma tarefa: descrição, fase, estimativa, subtarefas, dependências (depende de / bloqueia) e comentários recentes.",
        TaskRef,
        tool_task_details,
    ),
    Tool(
        "portfolio",
        "Panorama de todos os projetos ativos visíveis: saúde, % concluído, abertas, atrasadas, bloqueadas, fase, nota semanal e campos livres. Filtra por texto ou saúde.",
        PortfolioArgs,
        tool_portfolio,
    ),
    Tool(
        "project_summary",
        "Raio-x de um projeto (id, nome ou o projeto em tela): progresso, atrasos, bloqueios, marcos, prazos, equipe com funções e carga, ficha, última nota, atividade recente e lacunas.",
        ProjectArg,
        tool_project_summary,
    ),
    Tool(
        "workload",
        "Carga por pessoa nas tarefas de projeto em aberto (abertas, atrasadas, bloqueadas, vencem em 7 dias, horas estimadas). Todos os projetos ou um projeto.",
        OptionalProjectArg,
        tool_workload,
    ),
    Tool(
        "recent_activity",
        "O que mudou nos últimos N dias (padrão 7): quem fez o quê, em quais projetos e tarefas. Todos os projetos ou um projeto.",
        ActivityArgs,
        tool_recent_activity,
    ),
    Tool(
        "stalled_projects",
        "Projetos ativos sem atividade acima do limite de dias; devolve o critério e a última atividade.",
        StalledArgs,
        tool_stalled_projects,
    ),
    Tool(
        "blockers",
        "Tarefas bloqueadas e tarefas aguardando dependências pendentes de um projeto (id, nome ou em tela).",
        ProjectArg,
        tool_blockers,
    ),
    Tool(
        "propose_create_tasks",
        "Prepara (não grava) a criação de tarefas pessoais ou num projeto (id ou nome); o usuário confirma na prévia.",
        ProposeCreateArgs,
        tool_propose_create_tasks,
    ),
    Tool(
        "propose_update_task",
        "Prepara (não grava) mudança de estado, prazo, progresso, prioridade ou responsável de uma tarefa.",
        ProposeUpdateArgs,
        tool_propose_update_task,
    ),
    Tool(
        "propose_add_comment",
        "Prepara (não grava) um comentário em uma tarefa, em nome do usuário. Use para registrar decisões, combinados ou cobranças.",
        ProposeCommentArgs,
        tool_propose_add_comment,
    ),
    Tool(
        "propose_status_note",
        "Prepara (não grava) a nota semanal de acompanhamento do projeto, calculada das tarefas. Atraso exige justificativa dada pelo usuário.",
        ProposeStatusNoteArgs,
        tool_propose_status_note,
    ),
    Tool(
        "propose_wbs",
        "Prepara (não grava) uma EAP: fases, tarefas, marcos e dependências por 'ref'. due_in_days conta a partir de hoje.",
        ProposeWbsArgs,
        tool_propose_wbs,
    ),
]
BY_NAME = {t.name: t for t in TOOLS}


def tool_specs() -> list[dict]:
    return [
        {
            "type": "function",
            "name": t.name,
            "description": t.description,
            "parameters": t.args.model_json_schema(),
            "strict": False,
        }
        for t in TOOLS
    ]


def execute(s: Session, name: str, raw_args: dict) -> dict:
    """Valida argumentos e executa. Erros viram resultado recuperável para o modelo, nunca exceção crua."""
    tool = BY_NAME.get(name)
    if not tool:
        return {"erro": f"ferramenta desconhecida: {name}"}
    try:
        args = tool.args.model_validate(raw_args)
        return tool.run(s, args)
    except ValidationError as e:
        return {
            "erro": "argumentos inválidos: "
            + "; ".join(f"{'.'.join(map(str, x['loc']))}: {x['msg']}" for x in e.errors()[:4])
        }
    except AppError as e:
        return {"erro": e.message}


def weekday_pt(iso: str) -> str:
    return WEEKDAY[datetime.fromisoformat(iso).weekday()]
