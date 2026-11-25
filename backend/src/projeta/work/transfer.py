"""Exportar um espaço para arquivo JSON e importá-lo em outra instalação (ex.: local -> produção).

O arquivo é dado não confiável: nenhum ID dele vai para o banco (tudo ganha UUID novo), e
referências, enumerações e tamanhos são validados antes de gravar. A importação roda numa
transação só: ou entra tudo, ou nada.

Pessoas viajam pela matrícula do GIA (ou pelo e-mail, para contas sem matrícula). Quem existe no
destino é reencontrado; quem não existe vira convite pendente ao projeto (vínculo no primeiro
login, como em `invites.invite_by_matricula`). Autoria que não se resolve passa para quem importa.
"""

from __future__ import annotations

import base64
import binascii
import json
from collections.abc import Iterable
from datetime import UTC, date, datetime
from typing import Any, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field, ValidationError, field_validator

from ..db import Ctx
from ..errors import BadRequestError
from ..identity.access import is_uuid, membership
from ..identity.policy import CONFIGURABLE_ROLES, PERMISSIONS, ROLES, assert_can
from ..identity.workspaces import create_team_workspace
from . import comments as comments_svc
from . import covers
from .activity import log_activity
from .formal import PHASES, TAP_FIELDS, TEP_FIELDS
from .projects import clean_attributes
from .tasks import validate as validate_task

FORMAT = "projeta.workspace"
VERSION = 1
MAX_FILE_BYTES = 64 * 1024 * 1024
_MAX_ITEMS = 20_000

Ref = str  # identificador local ao arquivo, só para ligar registros entre si


# --- formato do arquivo --------------------------------------------------------------------


class _M(BaseModel):
    model_config = {"extra": "ignore"}


class PersonX(_M):
    ref: Ref = Field(max_length=64)
    matricula: str | None = Field(default=None, max_length=40)
    email: str | None = Field(default=None, max_length=200)
    name: str = Field(default="", max_length=200)
    role: Literal["admin", "manager", "member", "viewer"] | None = None  # papel no espaço


class MemberX(_M):
    person: Ref
    roles: list[Literal["gp", "po", "an", "as", "ex", "se", "qa", "ei"]] = Field(
        default_factory=list, max_length=8
    )


class CoverX(_M):
    data_base64: str = Field(max_length=covers.MAX_BYTES * 2)


class NoteX(_M):
    author: Ref | None = None
    state: Literal["on_track", "at_risk", "late"]
    delay_reason: str = Field(default="", max_length=4000)
    done: str = Field(default="", max_length=8000)
    pending: str = Field(default="", max_length=8000)
    blockers: str = Field(default="", max_length=4000)
    created_at: datetime | None = None


class TermX(_M):
    kind: Literal["tap", "tep"]
    content: dict[str, str]
    version: int = Field(default=1, ge=1)
    updated_by: Ref | None = None
    updated_at: datetime | None = None

    @field_validator("content")
    @classmethod
    def _small(cls, v: dict[str, str]) -> dict[str, str]:
        if any(len(x) > 20_000 for x in v.values()):
            raise ValueError("campo de termo grande demais")
        return v


class ProjectX(_M):
    ref: Ref = Field(max_length=64)
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=50_000)
    summary: str = Field(default="", max_length=280)
    responsible: str = Field(default="", max_length=200)
    requester: str = Field(default="", max_length=200)
    external_ref: str = Field(default="", max_length=200)
    status: Literal["active", "archived"] = "active"
    phase: Literal["initiation", "planning", "execution", "monitoring", "closing"] | None = None
    approach: Literal["agile", "waterfall"] | None = None
    sei_process: str | None = Field(default=None, max_length=200)
    attributes: list[dict[str, Any]] = Field(default_factory=list, max_length=50)
    progress: int | None = Field(default=None, ge=0, le=100)
    created_by: Ref | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    members: list[MemberX] = Field(default_factory=list, max_length=1000)
    pending_invites: list[str] = Field(default_factory=list, max_length=1000)
    cover: CoverX | None = None
    status_notes: list[NoteX] = Field(default_factory=list, max_length=_MAX_ITEMS)
    terms: list[TermX] = Field(default_factory=list, max_length=2)
    sprints: list[SprintX] = Field(default_factory=list, max_length=5000)


class SprintX(_M):
    ref: Ref = Field(max_length=64)
    number: int = Field(ge=1)
    name: str = Field(min_length=1, max_length=200)
    goal: str = Field(default="", max_length=2000)
    start_date: date
    end_date: date
    status: Literal["planned", "active", "closed"] = "planned"
    capacity_minutes: int | None = Field(default=None, ge=0)
    summary: dict[str, Any] | None = None
    started_at: datetime | None = None
    closed_at: datetime | None = None


class CommentX(_M):
    author: Ref | None = None
    body: str = Field(min_length=1, max_length=comments_svc.MAX_CHARS)
    created_at: datetime | None = None
    edited_at: datetime | None = None


class TaskX(_M):
    ref: Ref = Field(max_length=64)
    project: Ref | None = None  # nulo = tarefa pessoal de quem exportou
    parent: Ref | None = None
    sprint: Ref | None = None
    depends_on: list[Ref] = Field(default_factory=list, max_length=500)
    title: str = Field(max_length=200)
    description: str = Field(default="", max_length=50_000)
    status: str = "todo"
    priority: str = "medium"
    assignee: Ref | None = None
    created_by: Ref | None = None
    start_date: str | None = None
    due_date: str | None = None
    estimate_minutes: int | None = None
    progress: int = 0
    phase: str | None = Field(default=None, max_length=200)
    is_milestone: bool = False
    labels: list[str] = Field(default_factory=list, max_length=50)
    position: float = 0
    created_at: datetime | None = None
    updated_at: datetime | None = None
    completed_at: datetime | None = None
    comments: list[CommentX] = Field(default_factory=list, max_length=_MAX_ITEMS)


class ActivityX(_M):
    project: Ref | None = None
    task: Ref | None = None
    actor: Ref | None = None
    kind: str = Field(min_length=1, max_length=100)
    data: dict[str, Any] = Field(default_factory=dict)
    via: Literal["manual", "assistant"] = "manual"
    created_at: datetime | None = None


class WorkspaceX(_M):
    name: str = Field(min_length=1, max_length=200)
    timezone: str = "America/Sao_Paulo"
    permissions: dict[str, list[str]] = Field(default_factory=dict)


class ExportFile(_M):
    format: Literal["projeta.workspace"]
    version: int
    exporter: Ref | None = None
    workspace: WorkspaceX
    people: list[PersonX] = Field(default_factory=list, max_length=5000)
    projects: list[ProjectX] = Field(default_factory=list, max_length=5000)
    tasks: list[TaskX] = Field(default_factory=list, max_length=_MAX_ITEMS)
    activity: list[ActivityX] = Field(default_factory=list, max_length=200_000)


# --- exportar ------------------------------------------------------------------------------


def _iso(v: Any) -> str | None:
    if v is None:
        return None
    return v.isoformat() if isinstance(v, (datetime, date)) else str(v)


def export_workspace(ctx: Ctx, workspace_id: str) -> dict:
    """Só o Gestor exporta: o arquivo leva todos os projetos do espaço, inclusive os que outros
    perfis não enxergam. Tarefas pessoais de outras pessoas nunca saem (são privadas do dono)."""
    me = membership(ctx, workspace_id)
    assert_can(me, "workspace.manage")
    ws = ctx.one("SELECT name, timezone, permissions FROM workspaces WHERE id=%s", (workspace_id,))
    assert ws

    people: dict[str, dict] = {}

    def person(uid: Any) -> Ref | None:
        if uid is None:
            return None
        key = str(uid)
        if key not in people:
            u = ctx.one("SELECT matricula, email, name FROM users WHERE id=%s", (key,))
            if not u:
                return None
            people[key] = {"ref": f"u{len(people) + 1}", **u, "role": None}
        return people[key]["ref"]

    for m in ctx.all(
        "SELECT user_id, role FROM workspace_members WHERE workspace_id=%s ORDER BY created_at",
        (workspace_id,),
    ):
        person(m["user_id"])
        people[str(m["user_id"])]["role"] = m["role"]

    projects_out: list[dict] = []
    pref: dict[str, Ref] = {}
    sref: dict[str, Ref] = {}
    for p in ctx.all(
        "SELECT * FROM projects WHERE workspace_id=%s ORDER BY created_at, id", (workspace_id,)
    ):
        pid = str(p["id"])
        pref[pid] = f"p{len(pref) + 1}"
        cover = ctx.one("SELECT data FROM project_covers WHERE project_id=%s", (pid,))
        projects_out.append(
            {
                "ref": pref[pid],
                **{
                    k: p[k]
                    for k in (
                        "name",
                        "description",
                        "summary",
                        "responsible",
                        "requester",
                        "external_ref",
                        "status",
                        "phase",
                        "approach",
                        "sei_process",
                        "attributes",
                        "progress",
                    )
                },
                "created_by": person(p["created_by"]),
                "created_at": _iso(p["created_at"]),
                "updated_at": _iso(p["updated_at"]),
                "members": [
                    {"person": person(m["user_id"]), "roles": m["roles"] or []}
                    for m in ctx.all(
                        "SELECT user_id, roles FROM project_members WHERE project_id=%s "
                        "ORDER BY created_at",
                        (pid,),
                    )
                ],
                "pending_invites": [
                    r["matricula"]
                    for r in ctx.all(
                        "SELECT matricula FROM project_invites WHERE project_id=%s ORDER BY 1",
                        (pid,),
                    )
                ],
                "cover": {"data_base64": base64.b64encode(bytes(cover["data"])).decode()}
                if cover
                else None,
                "status_notes": [
                    {
                        "author": person(n["author_id"]),
                        **{
                            k: n[k]
                            for k in ("state", "delay_reason", "done", "pending", "blockers")
                        },
                        "created_at": _iso(n["created_at"]),
                    }
                    for n in ctx.all(
                        "SELECT * FROM project_status_notes WHERE project_id=%s ORDER BY created_at",
                        (pid,),
                    )
                ],
                "terms": [
                    {
                        "kind": t["kind"],
                        "content": t["content"],
                        "version": t["version"],
                        "updated_by": person(t["updated_by"]),
                        "updated_at": _iso(t["updated_at"]),
                    }
                    for t in ctx.all(
                        "SELECT * FROM project_terms WHERE project_id=%s ORDER BY kind", (pid,)
                    )
                ],
                "sprints": [
                    {
                        "ref": sref.setdefault(str(sp["id"]), f"s{len(sref) + 1}"),
                        **{
                            k: sp[k]
                            for k in (
                                "number",
                                "name",
                                "goal",
                                "status",
                                "capacity_minutes",
                                "summary",
                            )
                        },
                        "start_date": _iso(sp["start_date"]),
                        "end_date": _iso(sp["end_date"]),
                        "started_at": _iso(sp["started_at"]),
                        "closed_at": _iso(sp["closed_at"]),
                    }
                    for sp in ctx.all(
                        "SELECT * FROM sprints WHERE project_id=%s ORDER BY number", (pid,)
                    )
                ],
            }
        )

    rows = ctx.all(
        "SELECT * FROM tasks WHERE workspace_id=%s AND (project_id IS NOT NULL OR owner_id=%s) "
        "ORDER BY created_at, id",
        (workspace_id, ctx.user_id),
    )
    tref = {str(t["id"]): f"t{i + 1}" for i, t in enumerate(rows)}
    deps: dict[str, list[Ref]] = {}
    for d in ctx.all(
        "SELECT d.task_id, d.depends_on_id FROM task_dependencies d "
        "JOIN tasks t ON t.id = d.task_id WHERE t.workspace_id=%s",
        (workspace_id,),
    ):
        a, b = str(d["task_id"]), str(d["depends_on_id"])
        if a in tref and b in tref:
            deps.setdefault(a, []).append(tref[b])

    tasks_out: list[dict] = []
    for t in rows:
        tid = str(t["id"])
        tasks_out.append(
            {
                "ref": tref[tid],
                "project": pref.get(str(t["project_id"])) if t["project_id"] else None,
                "parent": tref.get(str(t["parent_id"])) if t["parent_id"] else None,
                "sprint": sref.get(str(t["sprint_id"])) if t["sprint_id"] else None,
                "depends_on": deps.get(tid, []),
                **{
                    k: t[k]
                    for k in (
                        "title",
                        "description",
                        "status",
                        "priority",
                        "estimate_minutes",
                        "progress",
                        "phase",
                        "is_milestone",
                        "labels",
                        "position",
                    )
                },
                "start_date": _iso(t["start_date"]),
                "due_date": _iso(t["due_date"]),
                "assignee": person(t["assignee_id"]),
                "created_by": person(t["created_by"]),
                "created_at": _iso(t["created_at"]),
                "updated_at": _iso(t["updated_at"]),
                "completed_at": _iso(t["completed_at"]),
                "comments": [
                    {
                        "author": person(c["author_id"]),
                        "body": c["body"],
                        "created_at": _iso(c["created_at"]),
                        "edited_at": _iso(c["edited_at"]),
                    }
                    for c in ctx.all(
                        "SELECT * FROM task_comments WHERE task_id=%s ORDER BY created_at, id",
                        (tid,),
                    )
                ],
            }
        )

    # Histórico de tarefas pessoais de outras pessoas fica de fora junto com as tarefas.
    activity_out = []
    for a in ctx.all(
        "SELECT * FROM activity WHERE workspace_id=%s ORDER BY created_at, id", (workspace_id,)
    ):
        task = str(a["task_id"]) if a["task_id"] else None
        if task and task not in tref:
            continue
        activity_out.append(
            {
                "project": pref.get(str(a["project_id"])) if a["project_id"] else None,
                "task": tref.get(task) if task else None,
                "actor": person(a["actor_id"]),
                "kind": a["kind"],
                "data": a["data"],
                "via": a["via"],
                "created_at": _iso(a["created_at"]),
            }
        )

    log_activity(ctx, workspace_id, "workspace.exported")
    return {
        "format": FORMAT,
        "version": VERSION,
        "exported_at": datetime.now(UTC).isoformat(),
        "exporter": person(ctx.user_id),
        "workspace": {
            "name": ws["name"],
            "timezone": ws["timezone"],
            "permissions": ws["permissions"],
        },
        "people": list(people.values()),
        "projects": projects_out,
        "tasks": tasks_out,
        "activity": activity_out,
    }


# --- importar ------------------------------------------------------------------------------


def parse_file(raw: bytes) -> ExportFile:
    if len(raw) > MAX_FILE_BYTES:
        raise BadRequestError("O arquivo passa de 64 MB. Exporte o espaço sem capas grandes.")
    try:
        doc = json.loads(raw)
    except (ValueError, UnicodeDecodeError) as e:
        raise BadRequestError(
            "O arquivo não é um JSON válido. Use o arquivo gerado em “Exportar espaço”."
        ) from e
    if not isinstance(doc, dict) or doc.get("format") != FORMAT:
        raise BadRequestError("Este arquivo não é uma exportação de espaço do PROJETA.")
    if doc.get("version") != VERSION:
        raise BadRequestError(
            "Versão de exportação não suportada. Atualize o PROJETA de destino e tente de novo."
        )
    try:
        return ExportFile.model_validate(doc)
    except ValidationError as e:
        where = ".".join(str(x) for x in e.errors()[0]["loc"])
        raise BadRequestError(
            f"Arquivo de exportação inválido em “{where}”. Gere a exportação de novo."
        ) from e


def _check_refs(f: ExportFile) -> None:
    """Toda referência aponta para algo do próprio arquivo; subtarefa só tem um nível e fica no
    mesmo projeto da mãe; dependências não formam ciclo."""
    people = {p.ref for p in f.people}
    projs = {p.ref for p in f.projects}
    tasks = {t.ref: t for t in f.tasks}
    if len(people) != len(f.people) or len(projs) != len(f.projects) or len(tasks) != len(f.tasks):
        raise BadRequestError(
            "Arquivo inválido: identificadores repetidos. Gere a exportação de novo."
        )

    def need(ref: str | None, pool: Iterable[str], what: str) -> None:
        if ref is not None and ref not in pool:
            raise BadRequestError(f"Arquivo inválido: {what} “{ref[:20]}” não existe no arquivo.")

    need(f.exporter, people, "pessoa")
    sprint_of: dict[Ref, Ref] = {}  # sprint -> projeto
    if len({sp.ref for p in f.projects for sp in p.sprints}) != sum(
        len(p.sprints) for p in f.projects
    ):
        raise BadRequestError(
            "Arquivo inválido: identificadores repetidos. Gere a exportação de novo."
        )
    for p in f.projects:
        need(p.created_by, people, "pessoa")
        for m in p.members:
            need(m.person, people, "pessoa")
        for n in p.status_notes:
            need(n.author, people, "pessoa")
        for t in p.terms:
            need(t.updated_by, people, "pessoa")
            fields = TAP_FIELDS if t.kind == "tap" else TEP_FIELDS
            if set(t.content) - set(fields):
                raise BadRequestError("Arquivo inválido: campo desconhecido em TAP/TEP.")
        if p.phase is not None and p.phase not in PHASES:
            raise BadRequestError("Arquivo inválido: fase de projeto desconhecida.")
        if sum(1 for sp in p.sprints if sp.status == "active") > 1:
            raise BadRequestError("Arquivo inválido: mais de uma sprint em andamento no projeto.")
        if len({sp.number for sp in p.sprints}) != len(p.sprints):
            raise BadRequestError("Arquivo inválido: sprints com o mesmo número no projeto.")
        for sp in p.sprints:
            if sp.end_date < sp.start_date:
                raise BadRequestError("Arquivo inválido: sprint que termina antes de começar.")
            sprint_of[sp.ref] = p.ref
    for t in f.tasks:
        need(t.project, projs, "projeto")
        need(t.parent, tasks, "tarefa")
        need(t.assignee, people, "pessoa")
        need(t.created_by, people, "pessoa")
        for d in t.depends_on:
            need(d, tasks, "tarefa")
        for c in t.comments:
            need(c.author, people, "pessoa")
        if t.parent:
            mother = tasks[t.parent]
            if mother.parent or mother.project != t.project or t.parent == t.ref:
                raise BadRequestError("Arquivo inválido: subtarefa fora da regra de um nível.")
        if t.sprint is not None and (t.project is None or sprint_of.get(t.sprint) != t.project):
            raise BadRequestError("Arquivo inválido: tarefa em sprint de outro projeto.")
    for a in f.activity:
        need(a.project, projs, "projeto")
        need(a.task, tasks, "tarefa")
        need(a.actor, people, "pessoa")

    # Ciclo de dependências (DFS iterativo): o arquivo pode ter sido editado à mão.
    state: dict[str, int] = {}
    for start in tasks:
        if state.get(start):
            continue
        stack = [(start, iter(tasks[start].depends_on))]
        state[start] = 1
        while stack:
            node, it = stack[-1]
            nxt = next(it, None)
            if nxt is None:
                state[node] = 2
                stack.pop()
            elif state.get(nxt) == 1 or nxt == node:
                raise BadRequestError(
                    "Arquivo inválido: as dependências entre tarefas formam um ciclo."
                )
            elif not state.get(nxt):
                state[nxt] = 1
                stack.append((nxt, iter(tasks[nxt].depends_on)))


def _target(ctx: Ctx, f: ExportFile, workspace_id: str | None, name: str | None) -> tuple[str, str]:
    """(id do espaço, tipo). Sem `workspace_id`, cria um espaço de equipe novo, com quem importa
    como Gestor e a matriz de permissões do arquivo."""
    if workspace_id:
        assert_can(membership(ctx, workspace_id), "workspace.manage")
        ws = ctx.one("SELECT kind FROM workspaces WHERE id=%s FOR UPDATE", (workspace_id,))
        assert ws
        return workspace_id, ws["kind"]
    try:
        tz = f.workspace.timezone
        ZoneInfo(tz)
    except (ZoneInfoNotFoundError, ValueError):
        tz = "America/Sao_Paulo"  # fuso inválido no arquivo: fica o padrão
    ws = create_team_workspace(ctx, (name or f.workspace.name).strip(), tz)
    matrix = {
        r: [p for p in PERMISSIONS if p in f.workspace.permissions.get(r, [])]
        for r in CONFIGURABLE_ROLES
    }
    if f.workspace.permissions:
        ctx.run("UPDATE workspaces SET permissions=%s WHERE id=%s", (Jsonb(matrix), ws["id"]))
    return ws["id"], "team"


def import_workspace(
    ctx: Ctx, raw: bytes, workspace_id: str | None = None, name: str | None = None
) -> dict:
    """Acrescenta o conteúdo do arquivo a um espaço onde quem importa é Gestor, ou cria um novo.
    Nada do destino é sobrescrito: projetos e tarefas entram como registros novos."""
    if workspace_id is not None and not is_uuid(workspace_id):
        raise BadRequestError("Espaço de destino inválido.")
    f = parse_file(raw)
    _check_refs(f)
    ws, kind = _target(ctx, f, workspace_id, name)
    team = kind == "team"
    summary = {
        "workspace_id": ws,
        "projects": 0,
        "sprints": 0,
        "tasks": 0,
        "comments": 0,
        "activity": 0,
        "people_linked": 0,
        "people_invited": 0,
        "people_missing": [],
    }

    # Pessoas: quem exportou é sempre quem importa; as demais, pela matrícula ou pelo e-mail.
    uid: dict[Ref, str | None] = {}
    names: dict[Ref, str] = {}
    matriculas: dict[Ref, str] = {}
    for p in f.people:
        names[p.ref] = p.name or (p.matricula or p.email or "")
        if p.matricula:
            matriculas[p.ref] = p.matricula.strip().upper()
        if p.ref == f.exporter:
            uid[p.ref] = ctx.user_id
            continue
        row = None
        if p.matricula:
            row = ctx.one("SELECT id FROM users WHERE matricula=%s", (p.matricula.strip().upper(),))
        if not row and p.email and not p.matricula:
            row = ctx.one("SELECT id FROM users WHERE email=%s", (p.email.strip().lower(),))
        uid[p.ref] = str(row["id"]) if row else None
        if row and team:
            role = p.role if p.role in ROLES else "member"
            ctx.run(
                "INSERT INTO workspace_members(workspace_id, user_id, role) VALUES (%s,%s,%s) "
                "ON CONFLICT DO NOTHING",  # quem já está no destino mantém o perfil de lá
                (ws, row["id"], role),
            )
            summary["people_linked"] += 1
        elif not row:
            summary["people_missing"].append(names[p.ref])

    def who(ref: Ref | None) -> str | None:
        return uid.get(ref) if ref else None

    def author(ref: Ref | None) -> str:
        return who(ref) or ctx.user_id

    def when(v: datetime | None) -> datetime:
        return v or datetime.now(UTC)

    # Projetos
    pid: dict[Ref, str] = {}
    sid: dict[Ref, tuple[str, SprintX]] = {}
    invited: set[str] = set()
    for p in f.projects:
        attrs = clean_attributes(p.attributes) or []
        row = ctx.one(
            "INSERT INTO projects(workspace_id, name, description, summary, responsible, requester, "
            "external_ref, status, phase, approach, sei_process, attributes, progress, created_by, "
            "created_at, updated_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) "
            "RETURNING id",
            (
                ws,
                p.name.strip(),
                p.description,
                p.summary,
                p.responsible,
                p.requester,
                p.external_ref,
                p.status,
                p.phase,
                p.approach,
                p.sei_process,
                Jsonb(attrs),
                p.progress,
                author(p.created_by),
                when(p.created_at),
                when(p.updated_at or p.created_at),
            ),
        )
        assert row
        pid[p.ref] = str(row["id"])
        summary["projects"] += 1
        if team:
            members = [(who(m.person), m) for m in p.members]
            for user_id, m in members:
                if user_id:
                    ctx.run(
                        "INSERT INTO project_members(project_id, user_id, roles) VALUES (%s,%s,%s) "
                        "ON CONFLICT DO NOTHING",
                        (pid[p.ref], user_id, m.roles),
                    )
                elif m.person in matriculas:
                    invited.add(matriculas[m.person])
                    _invite(ctx, pid[p.ref], matriculas[m.person])
            for mat in p.pending_invites:
                m = mat.strip().upper()
                if m:
                    invited.add(m)
                    _invite(ctx, pid[p.ref], m)
        if p.cover:
            try:
                data = base64.b64decode(p.cover.data_base64, validate=True)
            except (binascii.Error, ValueError) as e:
                raise BadRequestError(f"Capa inválida no projeto “{p.name[:40]}”.") from e
            ctype = covers.sniff_type(data)
            if not ctype or len(data) > covers.MAX_BYTES:
                raise BadRequestError(f"Capa inválida no projeto “{p.name[:40]}”.")
            ctx.run(
                "INSERT INTO project_covers(project_id, content_type, data) VALUES (%s,%s,%s)",
                (pid[p.ref], ctype, data),
            )
        for n in p.status_notes:
            ctx.run(
                "INSERT INTO project_status_notes(project_id, author_id, state, delay_reason, done, "
                "pending, blockers, created_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
                (
                    pid[p.ref],
                    author(n.author),
                    n.state,
                    n.delay_reason,
                    n.done,
                    n.pending,
                    n.blockers,
                    when(n.created_at),
                ),
            )
        for t in p.terms:
            ctx.run(
                "INSERT INTO project_terms(project_id, kind, content, version, updated_by, updated_at) "
                "VALUES (%s,%s,%s,%s,%s,%s)",
                (
                    pid[p.ref],
                    t.kind,
                    Jsonb(t.content),
                    t.version,
                    author(t.updated_by),
                    when(t.updated_at),
                ),
            )
        for sp in p.sprints:
            row = ctx.one(
                "INSERT INTO sprints(project_id, number, name, goal, start_date, end_date, status, "
                "capacity_minutes, summary, started_at, closed_at, created_by) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id",
                (
                    pid[p.ref],
                    sp.number,
                    sp.name.strip(),
                    sp.goal,
                    sp.start_date,
                    sp.end_date,
                    sp.status,
                    sp.capacity_minutes,
                    Jsonb(sp.summary) if sp.summary is not None else None,
                    sp.started_at or (when(None) if sp.status != "planned" else None),
                    sp.closed_at or (when(None) if sp.status == "closed" else None),
                    ctx.user_id,
                ),
            )
            assert row
            sid[sp.ref] = (str(row["id"]), sp)
            summary["sprints"] += 1
    summary["people_invited"] = len(invited)

    # Tarefas: mães antes das filhas (o arquivo garante um nível só).
    tid: dict[Ref, str] = {}
    f_tasks = {t.ref: t for t in f.tasks}
    for t in sorted(f.tasks, key=lambda x: x.parent is not None):
        fields = t.model_dump(
            include={
                "title", "status", "priority", "start_date", "due_date", "progress",
                "estimate_minutes",
            }
        )  # fmt: skip
        validate_task(fields, creating=True)
        if t.start_date and t.due_date and t.start_date > t.due_date:
            raise BadRequestError(
                f"A tarefa “{t.title[:60]}” começa depois do prazo. Corrija as datas no arquivo."
            )
        project = pid[t.project] if t.project else None
        assignee = who(t.assignee)
        if (
            assignee
            and project
            and not ctx.one(
                "SELECT 1 AS x FROM project_members WHERE project_id=%s AND user_id=%s "
                "UNION SELECT 1 FROM workspace_members WHERE workspace_id=%s AND user_id=%s "
                "AND role='admin'",
                (project, assignee, ws, assignee),
            )
        ):
            assignee = None  # responsável precisa estar no projeto, como na criação normal
        if not project:
            assignee = None if assignee != ctx.user_id else assignee
        row = ctx.one(
            "INSERT INTO tasks(workspace_id, project_id, owner_id, title, description, status, "
            "priority, assignee_id, due_date, estimate_minutes, progress, phase, is_milestone, "
            "labels, position, created_by, created_at, updated_at, completed_at, parent_id, "
            "start_date) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id",
            (
                ws,
                project,
                None if project else ctx.user_id,
                t.title.strip(),
                t.description,
                t.status,
                t.priority,
                assignee,
                t.due_date or None,
                t.estimate_minutes,
                t.progress,
                t.phase,
                t.is_milestone,
                [str(x)[:60] for x in t.labels],
                t.position,
                author(t.created_by),
                when(t.created_at),
                when(t.updated_at or t.created_at),
                t.completed_at,
                tid.get(t.parent) if t.parent else None,
                t.start_date or None,
            ),
        )
        assert row
        tid[t.ref] = str(row["id"])
        summary["tasks"] += 1
        # Subtarefa acompanha a sprint da mãe, como na edição normal.
        mother = f_tasks[t.parent] if t.parent else t
        if mother.sprint:
            sprint_id, sp = sid[mother.sprint]
            ctx.run("UPDATE tasks SET sprint_id=%s WHERE id=%s", (sprint_id, tid[t.ref]))
            # O histórico de entrada/saída não viaja: a tarefa conta como comprometida.
            ctx.run(
                "INSERT INTO sprint_task_log(sprint_id, task_id, added_at) VALUES (%s,%s,%s)",
                (sprint_id, tid[t.ref], sp.started_at or when(None)),
            )
        for c in t.comments:
            body = c.body
            if not who(c.author) and c.author:
                # Autor sem conta no destino: o texto guarda quem escreveu.
                body = f"[Comentário original de {names.get(c.author) or 'pessoa sem conta'}]\n\n{body}"
                body = body[: comments_svc.MAX_CHARS]
            ctx.run(
                "INSERT INTO task_comments(task_id, author_id, body, created_at, edited_at) "
                "VALUES (%s,%s,%s,%s,%s)",
                (tid[t.ref], author(c.author), body, when(c.created_at), c.edited_at),
            )
            summary["comments"] += 1
    for t in f.tasks:
        for d in t.depends_on:
            ctx.run(
                "INSERT INTO task_dependencies(task_id, depends_on_id) VALUES (%s,%s) "
                "ON CONFLICT DO NOTHING",
                (tid[t.ref], tid[d]),
            )

    for a in f.activity:
        if a.kind.startswith("workspace."):
            continue  # exportações/importações anteriores são da instalação de origem
        ctx.run(
            "INSERT INTO activity(workspace_id, project_id, task_id, actor_id, kind, data, via, "
            "created_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
            (
                ws,
                pid.get(a.project) if a.project else None,
                tid.get(a.task) if a.task else None,
                who(a.actor),
                a.kind,
                Jsonb(a.data),
                a.via,
                when(a.created_at),
            ),
        )
        summary["activity"] += 1

    log_activity(
        ctx,
        ws,
        "workspace.imported",
        data={"projects": summary["projects"], "tasks": summary["tasks"]},
    )
    return summary


def _invite(ctx: Ctx, project_id: str, matricula: str) -> None:
    ctx.run(
        "INSERT INTO project_invites(project_id, matricula, invited_by) VALUES (%s,%s,%s) "
        "ON CONFLICT DO NOTHING",
        (project_id, matricula, ctx.user_id),
    )
