"""Propostas: rascunho -> prévia editável -> confirmação -> execução transacional -> histórico.

Garantias (todas aplicadas no servidor, no momento da confirmação):
- só o autor da proposta a vê/edita/confirma;
- permissões e escopo são revalidados pelos mesmos serviços usados pela interface;
- validade (TTL) e versão dos registros afetados são conferidas;
- a confirmação é idempotente: a linha é travada (FOR UPDATE) e só uma execução grava.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from psycopg.types.json import Jsonb

from ..db import Ctx
from ..errors import BadRequestError, ForbiddenError, GoneError
from ..identity.access import is_uuid, membership, project_access, role_in, task_access
from ..identity.policy import assert_can
from ..settings import get_settings
from ..work import comments, formal, projects, tasks
from ..work.today import today_in
from .payloads import (
    CommentPayload,
    CreateTasksPayload,
    StatusNotePayload,
    UpdatePayload,
    WbsPayload,
    parse_payload,
)

FIELD_LABEL = {
    "status": "Estado",
    "due_date": "Prazo",
    "progress": "Progresso",
    "priority": "Prioridade",
    "assignee": "Responsável",
}
PRIORITY_LABEL = {"low": "Baixa", "medium": "Média", "high": "Alta"}
STATUS_LABEL = {
    "todo": "A fazer",
    "doing": "Em andamento",
    "blocked": "Bloqueada",
    "done": "Concluída",
}


def task_href(t: dict) -> str:
    if t.get("project_id"):
        return f"/projetos/{t['project_id']}?view=lista&task={t['id']}"
    return f"/minhas-tarefas?task={t['id']}"


def _fmt(field: str, v: Any) -> str:
    if v in (None, ""):
        return "—"
    if field == "status":
        return STATUS_LABEL.get(v, str(v))
    if field == "progress":
        return f"{v}%"
    if field == "priority":
        return PRIORITY_LABEL.get(v, str(v))
    if field == "due_date":
        y, m, d = str(v).split("-")
        return f"{d}/{m}/{y}"
    return str(v)


def _update_preview(ctx: Ctx, p: UpdatePayload) -> tuple[dict, dict]:
    a = task_access(ctx, p.task_id)
    t = a.task
    c = p.changes
    items = []
    if c.status is not None:
        items.append(("status", t["status"], c.status))
    if c.due_date is not None:
        items.append(("due_date", t["due_date"], c.due_date))
    if c.clear_due_date:
        items.append(("due_date", t["due_date"], None))
    if c.progress is not None:
        items.append(("progress", t["progress"], c.progress))
    if c.priority is not None:
        items.append(("priority", t["priority"], c.priority))
    if c.assignee_id is not None:
        items.append(("assignee", t["assignee_name"], _assignee_name(ctx, t, c.assignee_id)))
    if c.clear_assignee:
        items.append(("assignee", t["assignee_name"], None))
    preview = {
        "tasks": [
            {
                "task_id": t["id"],
                "title": t["title"],
                "project": t["project_name"],
                "href": task_href(t),
                "changes": [
                    {"field": f, "label": FIELD_LABEL[f], "before": _fmt(f, b), "after": _fmt(f, n)}
                    for f, b, n in items
                ],
            }
        ],
        "can_write": a.can_write,
    }
    return preview, {t["id"]: t["version"]}


def _assignee_name(ctx: Ctx, task: dict, user_id: str) -> str:
    """Falha já na proposta se a pessoa não pode ser responsável (a execução revalida)."""
    if not task["project_id"]:
        raise BadRequestError(
            "Tarefas pessoais não têm responsável. Escolha uma tarefa de projeto."
        )
    row = (
        ctx.one(
            "SELECT u.name FROM project_members pm JOIN users u ON u.id = pm.user_id "
            "WHERE pm.project_id = %s AND pm.user_id = %s",
            (task["project_id"], user_id),
        )
        if is_uuid(user_id)
        else None
    )
    if not row:
        raise BadRequestError(
            "O responsável precisa ser membro do projeto. Vincule a pessoa ao projeto antes."
        )
    return row["name"]


def _comment_preview(ctx: Ctx, p: CommentPayload) -> tuple[dict, dict]:
    a = task_access(ctx, p.task_id)
    t = a.task
    return {
        "tasks": [
            {
                "task_id": t["id"],
                "title": t["title"],
                "project": t["project_name"],
                "href": task_href(t),
                "changes": [],
            }
        ],
        # Para comentário, "pode confirmar" é poder comentar (a matriz separa de editar).
        "can_write": a.can_comment,
    }, {}


# Tipos cuja prévia depende do estado atual de uma tarefa (recalculada enquanto pendente).
LIVE_PREVIEW = ("update_task", "add_comment")


def _preview(ctx: Ctx, kind: str, model: Any) -> tuple[dict, dict]:
    """(prévia legível, versões-base dos registros afetados)."""
    if kind == "update_task":
        return _update_preview(ctx, model)
    if kind == "add_comment":
        return _comment_preview(ctx, model)
    if kind == "create_tasks":
        return {"count": len(model.tasks), "titles": [t.title for t in model.tasks]}, {}
    if kind == "status_note":
        return {"state": model.state}, {}
    n = sum(len(ph.tasks) for ph in model.phases)
    return {
        "count": n,
        "phases": len(model.phases),
        "milestones": sum(t.is_milestone for ph in model.phases for t in ph.tasks),
    }, {}


def _authorize_target(ctx: Ctx, kind: str, model: Any, workspace_id: str) -> None:
    """Falha cedo (na proposta) se o usuário não poderia executar — a confirmação revalida de novo."""
    if kind == "create_tasks":
        if model.project_id:
            if not project_access(ctx, model.project_id).can_write:
                raise ForbiddenError()
        else:
            role_in(ctx, workspace_id)
    elif kind == "apply_wbs":
        if model.project_id:
            if not project_access(ctx, model.project_id).can_write:
                raise ForbiddenError()
        else:
            assert_can(membership(ctx, workspace_id), "project.create")
    elif kind == "status_note":
        if not project_access(ctx, model.project_id).can_manage:
            raise ForbiddenError()
    elif kind == "add_comment":
        if not task_access(ctx, model.task_id).can_comment:
            raise ForbiddenError()
    else:  # update_task: quem edita a tarefa
        if not task_access(ctx, model.task_id).can_write:
            raise ForbiddenError()


def view(ctx: Ctx, row: dict) -> dict:
    model = parse_payload(row["kind"], row["payload"])
    preview: dict
    if row["kind"] in LIVE_PREVIEW and row["status"] == "pending":
        try:
            preview, _ = _preview(ctx, row["kind"], model)
        except ForbiddenError:
            preview = {"tasks": [], "can_write": False}
    else:
        preview = _preview_static(row["kind"], model)
    return {
        "id": row["id"],
        "kind": row["kind"],
        "status": row["status"],
        "expires_at": row["expires_at"],
        "payload": row["payload"],
        "preview": preview,
        "result": row["result"],
    }


def _preview_static(kind: str, model: Any) -> dict:
    if kind in LIVE_PREVIEW:
        return {"tasks": [], "can_write": True}
    return _preview(None, kind, model)[0]  # type: ignore[arg-type]


def _row(ctx: Ctx, proposal_id: str, lock: bool = False) -> dict:
    if not is_uuid(proposal_id):
        raise ForbiddenError()
    row = ctx.one(
        "SELECT * FROM assistant_proposals WHERE id=%s AND user_id=%s"
        + (" FOR UPDATE" if lock else ""),
        (proposal_id, ctx.user_id),
    )
    if not row:
        raise ForbiddenError()
    return row


def get_proposal(ctx: Ctx, proposal_id: str) -> dict:
    return view(ctx, _row(ctx, proposal_id))


def create_proposal(
    ctx: Ctx, conversation_id: str, workspace_id: str, kind: str, payload: dict
) -> dict:
    model = parse_payload(kind, payload)
    _authorize_target(ctx, kind, model, workspace_id)
    _, base = _preview(ctx, kind, model)
    ttl = timedelta(minutes=get_settings().assistant_proposal_ttl_min)
    row = ctx.one(
        "INSERT INTO assistant_proposals(conversation_id, user_id, workspace_id, kind, payload, "
        "base_versions, idempotency_key, expires_at) "
        "VALUES (%s,%s,%s,%s,%s,%s, gen_random_uuid()::text, %s) RETURNING *",
        (
            conversation_id,
            ctx.user_id,
            workspace_id,
            kind,
            Jsonb(model.model_dump(mode="json")),
            Jsonb(base),
            datetime.now(UTC) + ttl,
        ),
    )
    assert row
    return view(ctx, row)


def edit_proposal(ctx: Ctx, proposal_id: str, payload: dict) -> dict:
    row = _row(ctx, proposal_id, lock=True)
    if row["status"] != "pending":
        raise BadRequestError("Esta proposta já foi decidida e não pode mais ser editada.")
    if row["expires_at"] < datetime.now(UTC):
        raise GoneError("Esta proposta expirou. Peça ao assistente para refazê-la.")
    model = parse_payload(row["kind"], payload)
    _authorize_target(ctx, row["kind"], model, row["workspace_id"])
    _, base = _preview(ctx, row["kind"], model)
    if row["kind"] == "update_task" and model.task_id == row["payload"]["task_id"]:
        # Editar a intenção não significa que a pessoa revisou alterações concorrentes.
        # A confirmação deve continuar exigindo uma nova revisão quando a tarefa mudou.
        base = row["base_versions"]
    updated = ctx.one(
        "UPDATE assistant_proposals SET payload=%s, base_versions=%s WHERE id=%s RETURNING *",
        (Jsonb(model.model_dump(mode="json")), Jsonb(base), proposal_id),
    )
    assert updated
    return view(ctx, updated)


def cancel_proposal(ctx: Ctx, proposal_id: str) -> dict:
    row = _row(ctx, proposal_id, lock=True)
    if row["status"] == "pending":
        row = (
            ctx.one(
                "UPDATE assistant_proposals SET status='cancelled', decided_at=now() WHERE id=%s RETURNING *",
                (proposal_id,),
            )
            or row
        )
    return view(ctx, row)


# ---------------------------------------------------------------- execução


def _exec_create_tasks(ctx: Ctx, ws: str, m: CreateTasksPayload) -> dict:
    created = []
    for nt in m.tasks:
        fields = nt.model_dump(exclude_none=True)
        t = tasks.create_task(ctx, ws, m.project_id, fields, via="assistant")
        created.append({"id": t["id"], "title": t["title"], "href": task_href(t)})
    return {"created": created}


def _exec_wbs(ctx: Ctx, ws: str, m: WbsPayload) -> dict:
    if m.project_id:
        pid = m.project_id
        project = project_access(ctx, pid).project
    else:
        project = projects.create_project(ctx, ws, m.project_name or "Novo projeto", m.summary)
        pid = project["id"]
    ids: dict[str, str] = {}
    created = []
    for ph in m.phases:
        for wt in ph.tasks:
            fields = wt.model_dump(exclude={"ref", "depends_on"}, exclude_none=True)
            fields["phase"] = ph.name
            t = tasks.create_task(ctx, project["workspace_id"], pid, fields, via="assistant")
            ids[wt.ref] = t["id"]
            created.append({"id": t["id"], "title": t["title"], "href": task_href(t)})
    for ph in m.phases:  # dependências só depois de todas as tarefas existirem
        for wt in ph.tasks:
            for dep in wt.depends_on:
                tasks.add_dependency(ctx, ids[wt.ref], ids[dep])
    return {
        "created": created,
        "project": {"id": pid, "name": project["name"], "href": f"/projetos/{pid}"},
    }


def _exec_update(ctx: Ctx, m: UpdatePayload, base: dict) -> dict:
    c = m.changes
    fields: dict[str, Any] = {}
    if c.status is not None:
        fields["status"] = c.status
    if c.due_date is not None:
        fields["due_date"] = c.due_date
    if c.clear_due_date:
        fields["due_date"] = None
    if c.progress is not None:
        fields["progress"] = c.progress
    if c.priority is not None:
        fields["priority"] = c.priority
    if c.assignee_id is not None:
        fields["assignee_id"] = c.assignee_id
    if c.clear_assignee:
        fields["assignee_id"] = None
    t = tasks.update_task(
        ctx, m.task_id, fields, expected_version=base.get(m.task_id), via="assistant"
    )
    return {"updated": [{"id": t["id"], "title": t["title"], "href": task_href(t)}]}


def _exec_comment(ctx: Ctx, m: CommentPayload) -> dict:
    c = comments.add_comment(ctx, m.task_id, m.body)
    t = task_access(ctx, m.task_id).task
    return {
        "comment": {"id": c["id"]},
        "updated": [{"id": t["id"], "title": t["title"], "href": task_href(t)}],
    }


def _exec_status_note(ctx: Ctx, m: StatusNotePayload) -> dict:
    note = formal.add_status_note(
        ctx, m.project_id, m.state, m.delay_reason, m.done, m.pending, m.blockers
    )
    name = project_access(ctx, m.project_id).project["name"]
    return {
        "note": {"id": note["id"], "state": note["state"]},
        "project": {
            "id": m.project_id,
            "name": name,
            "href": f"/projetos/{m.project_id}?view=formal",
        },
    }


def _message(kind: str, result: dict) -> str:
    if kind == "status_note":
        return (
            f"Pronto: publiquei a nota de acompanhamento do projeto “{result['project']['name']}”."
        )
    if kind == "add_comment":
        return f"Pronto: comentei na tarefa “{result['updated'][0]['title']}”."
    if kind == "update_task":
        return f"Pronto: atualizei a tarefa “{result['updated'][0]['title']}”. O histórico do projeto registra a mudança."
    n = len(result["created"])
    if kind == "apply_wbs":
        return f"Pronto: criei {n} tarefas no projeto “{result['project']['name']}”."
    return f"Pronto: criei {n} tarefa{'s' if n != 1 else ''}."


def confirm_proposal(ctx: Ctx, proposal_id: str) -> dict:
    """Retorna {status, proposal, message?}. status: confirmed | stale | already_confirmed."""
    row = _row(ctx, proposal_id, lock=True)  # serializa cliques duplos e retentativas
    if row["status"] == "confirmed":
        return {
            "status": "already_confirmed",
            "proposal": view(ctx, row),
            "message": _message(row["kind"], row["result"]),
        }
    if row["status"] != "pending":
        raise BadRequestError("Esta proposta foi cancelada e não pode ser confirmada.")
    if row["expires_at"] < datetime.now(UTC):
        ctx.run(
            "UPDATE assistant_proposals SET status='expired', decided_at=now() WHERE id=%s",
            (proposal_id,),
        )
        raise GoneError("Esta proposta expirou. Peça ao assistente para refazê-la.")

    model = parse_payload(row["kind"], row["payload"])
    base: dict = row["base_versions"] or {}
    if row["kind"] == "update_task":
        # Concorrência: se a tarefa mudou depois da proposta, devolve prévia atualizada sem gravar.
        _, current = _preview(ctx, row["kind"], model)
        if current != base:
            fresh = ctx.one(
                "UPDATE assistant_proposals SET base_versions=%s WHERE id=%s RETURNING *",
                (Jsonb(current), proposal_id),
            )
            assert fresh
            return {"status": "stale", "proposal": view(ctx, fresh)}

    ws = row["workspace_id"]
    if row["kind"] == "create_tasks":
        result = _exec_create_tasks(ctx, ws, model)  # type: ignore[arg-type]
    elif row["kind"] == "apply_wbs":
        result = _exec_wbs(ctx, ws, model)  # type: ignore[arg-type]
    elif row["kind"] == "status_note":
        result = _exec_status_note(ctx, model)  # type: ignore[arg-type]
    elif row["kind"] == "add_comment":
        result = _exec_comment(ctx, model)  # type: ignore[arg-type]
    else:
        result = _exec_update(ctx, model, base)  # type: ignore[arg-type]

    msg = _message(row["kind"], result)
    done = ctx.one(
        "UPDATE assistant_proposals SET status='confirmed', result=%s, decided_at=now() WHERE id=%s RETURNING *",
        (Jsonb(result), proposal_id),
    )
    assert done
    ctx.run(
        "INSERT INTO assistant_messages(conversation_id, role, content, links) VALUES (%s,'assistant',%s,%s)",
        (row["conversation_id"], msg, Jsonb(_links_from(result))),
    )
    return {"status": "confirmed", "proposal": view(ctx, done), "message": msg}


def _links_from(result: dict) -> list[dict]:
    if "project" in result:
        return [{"label": result["project"]["name"], "href": result["project"]["href"]}]
    return [
        {"label": x["title"], "href": x["href"]}
        for x in (result.get("created") or result.get("updated") or [])[:10]
    ]


def default_start(ctx: Ctx) -> str:
    row = ctx.one("SELECT timezone FROM users WHERE id=%s", (ctx.user_id,))
    return today_in(row["timezone"] if row else "America/Sao_Paulo")
