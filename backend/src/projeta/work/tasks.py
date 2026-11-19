"""Tarefas: criação, edição com controle de versão, filtros e dependências sem ciclo."""

from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Any

from ..db import Ctx
from ..errors import BadRequestError, ConflictError, ForbiddenError
from ..identity.access import (
    TASK_SELECT,
    VISIBLE_PROJECT,
    is_uuid,
    project_access,
    role_in,
    task_access,
)
from .activity import log_activity

STATUSES = ("todo", "doing", "blocked", "done")
PRIORITIES = ("low", "medium", "high")
EDITABLE = (
    "title", "description", "status", "priority", "assignee_id", "due_date", "estimate_minutes",
    "progress", "phase", "is_milestone", "labels", "position", "parent_id",
)  # fmt: skip


def _title_contains(q: str) -> str:
    """Padrão ILIKE para "título contém q": %, _ e \\ digitados pela pessoa valem literalmente."""
    escaped = q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _valid_date(v: str) -> bool:
    try:
        return date.fromisoformat(v).isoformat() == v
    except ValueError:
        return False


def validate(fields: dict[str, Any], creating: bool) -> None:
    if creating or "title" in fields:
        title = (fields.get("title") or "").strip()
        if not title:
            raise BadRequestError("Informe o título da tarefa")
        if len(title) > 200:
            raise BadRequestError("Título muito longo (máx. 200 caracteres)")
    if fields.get("status") is not None and fields["status"] not in STATUSES:
        raise BadRequestError("Status inválido")
    if fields.get("priority") is not None and fields["priority"] not in PRIORITIES:
        raise BadRequestError("Prioridade inválida")
    if fields.get("due_date") and not _valid_date(fields["due_date"]):
        raise BadRequestError("Prazo inválido (use AAAA-MM-DD)")
    p = fields.get("progress")
    if p is not None and not (isinstance(p, int) and 0 <= p <= 100):
        raise BadRequestError("O progresso deve ficar entre 0 e 100")
    e = fields.get("estimate_minutes")
    if e is not None and not (isinstance(e, int) and e >= 0):
        raise BadRequestError("Estimativa inválida")


def _assert_assignable(ctx: Ctx, project_id: str, assignee_id: str) -> None:
    if not is_uuid(assignee_id) or not ctx.one(
        "SELECT 1 AS x FROM project_members WHERE project_id=%s AND user_id=%s",
        (project_id, assignee_id),
    ):
        raise BadRequestError("O responsável precisa ser membro do projeto")


def _assert_parent(ctx: Ctx, task: dict, parent_id: str) -> None:
    """Subtarefa: mesmo projeto (ou mesma lista pessoal) e um nível só.

    `task` precisa de project_id, owner_id, workspace_id e, se já existir, id.
    """
    if not is_uuid(parent_id):
        raise ForbiddenError()
    parent = task_access(ctx, parent_id).task  # 403 se a pessoa não enxerga a tarefa-mãe
    if task["project_id"]:
        same_place = parent["project_id"] == task["project_id"]
    else:
        # Tarefa pessoal: a mãe também é pessoal, da mesma pessoa e no mesmo espaço.
        same_place = (
            not parent["project_id"]
            and parent["owner_id"] == task["owner_id"]
            and parent["workspace_id"] == task["workspace_id"]
        )
    if not same_place:
        raise BadRequestError(
            "A subtarefa precisa ficar no mesmo projeto da tarefa-mãe. Escolha outra tarefa-mãe."
        )
    if task.get("id") == parent_id:
        raise BadRequestError("Uma tarefa não pode ser subtarefa dela mesma.")
    if parent["parent_id"]:
        raise BadRequestError(
            "Essa tarefa já é uma subtarefa. Escolha a tarefa principal como tarefa-mãe."
        )
    if task.get("id") and ctx.one(
        "SELECT 1 AS x FROM tasks WHERE parent_id=%s LIMIT 1", (task["id"],)
    ):
        raise BadRequestError(
            "Esta tarefa tem subtarefas e não pode virar subtarefa. Mova as subtarefas antes."
        )


def create_task(
    ctx: Ctx,
    workspace_id: str,
    project_id: str | None,
    fields: dict[str, Any],
    via: str = "manual",
) -> dict:
    """project_id nulo = tarefa pessoal do usuário no espaço (privada)."""
    validate(fields, creating=True)
    ws_id = workspace_id
    if project_id:
        a = project_access(ctx, project_id)
        if not a.can_write:
            raise ForbiddenError()
        ws_id = a.project["workspace_id"]  # o espaço vem do projeto, nunca do cliente
        if fields.get("assignee_id"):
            _assert_assignable(ctx, project_id, fields["assignee_id"])
        pos = ctx.one(
            "SELECT COALESCE(max(position),0)+1 AS p FROM tasks WHERE project_id=%s", (project_id,)
        )
    else:
        role_in(ctx, workspace_id)
        pos = ctx.one(
            "SELECT COALESCE(max(position),0)+1 AS p FROM tasks "
            "WHERE project_id IS NULL AND owner_id=%s AND workspace_id=%s",
            (ctx.user_id, workspace_id),
        )
    assert pos
    parent_id = fields.get("parent_id")
    if parent_id:
        _assert_parent(
            ctx,
            {
                "project_id": project_id or None,
                "owner_id": None if project_id else ctx.user_id,
                "workspace_id": ws_id,
            },
            parent_id,
        )
    status = fields.get("status") or "todo"
    row = ctx.one(
        """INSERT INTO tasks(workspace_id, project_id, owner_id, title, description, status, priority,
             assignee_id, due_date, estimate_minutes, progress, phase, is_milestone, labels, position,
             created_by, completed_at, parent_id)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
        (
            ws_id,
            project_id,
            None if project_id else ctx.user_id,
            fields["title"].strip(),
            fields.get("description") or "",
            status,
            fields.get("priority") or "medium",
            fields.get("assignee_id") if project_id else None,
            fields.get("due_date"),
            fields.get("estimate_minutes"),
            100 if status == "done" else (fields.get("progress") or 0),
            fields.get("phase"),
            bool(fields.get("is_milestone")),
            fields.get("labels") or [],
            pos["p"],
            ctx.user_id,
            datetime.now(UTC) if status == "done" else None,
            parent_id or None,
        ),
    )
    assert row
    task = ctx.one(f"{TASK_SELECT} WHERE t.id=%s", (row["id"],))
    assert task
    if project_id:
        log_activity(
            ctx, ws_id, "task.created", project_id, task["id"], {"title": task["title"]}, via
        )
    return task


def list_project_tasks(
    ctx: Ctx,
    project_id: str,
    status: str | None = None,
    priority: str | None = None,
    assignee_id: str | None = None,
    q: str | None = None,
) -> list[dict]:
    project_access(ctx, project_id)
    where, params = ["t.project_id = %(pid)s"], {"pid": project_id}
    if status:
        where.append("t.status = %(status)s")
        params["status"] = status
    if priority:
        where.append("t.priority = %(priority)s")
        params["priority"] = priority
    if assignee_id == "none":
        where.append("t.assignee_id IS NULL")
    elif assignee_id and is_uuid(assignee_id):
        where.append("t.assignee_id = %(assignee)s")
        params["assignee"] = assignee_id
    if q and q.strip():
        where.append("t.title ILIKE %(q)s")
        params["q"] = _title_contains(q)
    return ctx.all(
        f"{TASK_SELECT} WHERE {' AND '.join(where)} ORDER BY t.position, t.created_at", params
    )


def list_my_tasks(
    ctx: Ctx,
    workspace_id: str,
    today: str,
    status: str | None = None,
    priority: str | None = None,
    due: str | None = None,
    include_done: bool = False,
) -> list[dict]:
    """Tarefas atribuídas a mim em projetos visíveis + minhas tarefas pessoais (privadas)."""
    role_in(ctx, workspace_id)
    params: dict[str, Any] = {"uid": ctx.user_id, "ws": workspace_id, "today": today}
    where = [
        "t.workspace_id = %(ws)s",
        f"((t.project_id IS NULL AND t.owner_id = %(uid)s) OR "
        f"(t.assignee_id = %(uid)s AND {VISIBLE_PROJECT}))",
    ]
    if status:
        where.append("t.status = %(status)s")
        params["status"] = status
    elif not include_done:
        where.append("t.status <> 'done'")
    if priority:
        where.append("t.priority = %(priority)s")
        params["priority"] = priority
    if due == "overdue":
        where.append("t.due_date < %(today)s::date AND t.status <> 'done'")
    elif due == "today":
        where.append("t.due_date = %(today)s::date")
    elif due == "week":
        where.append("t.due_date BETWEEN %(today)s::date AND %(today)s::date + 7")
    elif due == "none":
        where.append("t.due_date IS NULL")
    # VISIBLE_PROJECT referencia o alias p, que TASK_SELECT já traz (LEFT JOIN projects p).
    return ctx.all(
        f"{TASK_SELECT} WHERE {' AND '.join(where)} ORDER BY t.due_date NULLS LAST, "
        "CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, t.created_at",
        params,
    )


def get_task(ctx: Ctx, task_id: str) -> dict:
    a = task_access(ctx, task_id)
    deps = ctx.all(
        "SELECT d.depends_on_id AS id, t.title, t.status FROM task_dependencies d "
        "JOIN tasks t ON t.id = d.depends_on_id WHERE d.task_id = %s",
        (task_id,),
    )
    subtasks = ctx.all(
        f"{TASK_SELECT} WHERE t.parent_id = %s ORDER BY t.position, t.created_at", (task_id,)
    )
    return {"task": a.task, "can_write": a.can_write, "depends_on": deps, "subtasks": subtasks}


def update_task(
    ctx: Ctx,
    task_id: str,
    fields: dict[str, Any],
    expected_version: int | None = None,
    via: str = "manual",
) -> dict:
    """Edição com controle otimista: versão divergente => 409 com o registro atual."""
    fields = {k: v for k, v in fields.items() if k in EDITABLE}
    if "parent_id" in fields and not fields["parent_id"]:
        fields["parent_id"] = None  # "" = "nenhuma tarefa-mãe", como nulo
    validate(fields, creating=False)
    a = task_access(ctx, task_id, lock=True)
    task = a.task
    if not a.can_write:
        raise ForbiddenError()
    if expected_version is not None and expected_version != task["version"]:
        raise ConflictError(
            "A tarefa foi alterada por outra pessoa. Recarregue para ver a versão atual.",
            {"current": task},
        )
    if fields.get("assignee_id"):
        if not task["project_id"]:
            raise BadRequestError("Tarefas pessoais não têm responsável")
        _assert_assignable(ctx, task["project_id"], fields["assignee_id"])
    if fields.get("parent_id"):
        _assert_parent(ctx, task, fields["parent_id"])

    sets: dict[str, Any] = {k: v for k, v in fields.items() if k != "status"}
    if "title" in sets:
        sets["title"] = sets["title"].strip()
    status = fields.get("status")
    if status is not None:
        sets["status"] = status
        if status == "done":
            sets["progress"] = 100
            sets["completed_at"] = datetime.now(UTC)
        elif task["status"] == "done":
            sets["completed_at"] = None
            sets.setdefault("progress", min(task["progress"], 90))
    if not sets:
        return task
    cols = ", ".join(f"{c} = %({c})s" for c in sets)
    ctx.run(
        f"UPDATE tasks SET {cols}, version = version + 1, updated_at = now() WHERE id = %(_id)s",
        {**sets, "_id": task_id},
    )
    after = ctx.one(f"{TASK_SELECT} WHERE t.id=%s", (task_id,))
    assert after
    if task["project_id"]:
        changes = {
            k: {"from": str(task[k]), "to": str(after[k])}
            for k in (
                "title",
                "status",
                "priority",
                "assignee_id",
                "due_date",
                "progress",
                "parent_id",
            )
            if task[k] != after[k]
        }
        if changes:
            log_activity(
                ctx,
                task["workspace_id"],
                "task.status_changed" if "status" in changes else "task.updated",
                task["project_id"],
                task_id,
                {"title": after["title"], "changes": changes},
                via,
            )
    return after


def delete_task(ctx: Ctx, task_id: str) -> None:
    a = task_access(ctx, task_id, lock=True)
    if not a.can_write:
        raise ForbiddenError()
    ctx.run("DELETE FROM tasks WHERE id=%s", (task_id,))
    if a.task["project_id"]:
        log_activity(
            ctx,
            a.task["workspace_id"],
            "task.deleted",
            a.task["project_id"],
            data={"title": a.task["title"]},
        )


def add_dependency(ctx: Ctx, task_id: str, depends_on_id: str) -> None:
    """Bloqueia ciclos: a aresta task -> depends_on é recusada se depends_on já alcança task."""
    a = task_access(ctx, task_id, lock=True)
    b = task_access(ctx, depends_on_id)
    if not a.can_write:
        raise ForbiddenError()
    if not a.task["project_id"] or a.task["project_id"] != b.task["project_id"]:
        raise BadRequestError("Dependências só existem entre tarefas do mesmo projeto")
    if task_id == depends_on_id:
        raise BadRequestError("Uma tarefa não pode depender dela mesma")
    cycle = ctx.one(
        """WITH RECURSIVE reach(id) AS (
             SELECT depends_on_id FROM task_dependencies WHERE task_id = %(dep)s
             UNION SELECT d.depends_on_id FROM task_dependencies d JOIN reach r ON d.task_id = r.id)
           SELECT 1 AS x FROM reach WHERE id = %(task)s LIMIT 1""",
        {"task": task_id, "dep": depends_on_id},
    )
    if cycle:
        raise ConflictError("Essa dependência criaria um ciclo entre as tarefas")
    ctx.run(
        "INSERT INTO task_dependencies(task_id, depends_on_id) VALUES (%s,%s) ON CONFLICT DO NOTHING",
        (task_id, depends_on_id),
    )
    ctx.run("UPDATE tasks SET version = version + 1 WHERE id=%s", (task_id,))


def remove_dependency(ctx: Ctx, task_id: str, depends_on_id: str) -> None:
    a = task_access(ctx, task_id, lock=True)
    if not a.can_write:
        raise ForbiddenError()
    ctx.run(
        "DELETE FROM task_dependencies WHERE task_id=%s AND depends_on_id=%s",
        (task_id, depends_on_id),
    )
    ctx.run("UPDATE tasks SET version = version + 1 WHERE id=%s", (task_id,))


def list_agenda(ctx: Ctx, workspace_id: str, start: str, end: str) -> list[dict]:
    """Itens datados no intervalo: minhas tarefas, tarefas pessoais e marcos dos projetos visíveis."""
    role_in(ctx, workspace_id)
    if not (_valid_date(start) and _valid_date(end)):
        raise BadRequestError("Período inválido")
    return ctx.all(
        f"{TASK_SELECT} WHERE t.workspace_id = %(ws)s AND t.due_date BETWEEN %(a)s::date AND %(b)s::date "
        f"AND ((t.project_id IS NULL AND t.owner_id = %(uid)s) OR "
        f"(t.project_id IS NOT NULL AND {VISIBLE_PROJECT} AND (t.assignee_id = %(uid)s OR t.is_milestone))) "
        "ORDER BY t.due_date, t.created_at",
        {"ws": workspace_id, "a": start, "b": end, "uid": ctx.user_id},
    )


def search_visible(
    ctx: Ctx,
    workspace_id: str,
    due_from: str | None = None,
    due_to: str | None = None,
    query: str | None = None,
    project_id: str | None = None,
    status: str | None = None,
    include_done: bool = False,
    limit: int = 20,
    priority: str | None = None,
    assignee_ids: list[str] | None = None,
    unassigned: bool = False,
    no_due: bool = False,
) -> list[dict]:
    """Tarefas que o usuário pode ver (pessoais dele + projetos visíveis). Usada por busca e assistente.

    `assignee_ids` e `unassigned` só alcançam tarefas de projeto: tarefas pessoais não têm
    responsável.
    """
    role_in(ctx, workspace_id)
    where = [
        "t.workspace_id = %(ws)s",
        f"((t.project_id IS NULL AND t.owner_id = %(uid)s) OR "
        f"(t.project_id IS NOT NULL AND {VISIBLE_PROJECT}))",
    ]
    params: dict[str, Any] = {"ws": workspace_id, "uid": ctx.user_id, "lim": min(limit, 50)}
    if due_from:
        where.append("t.due_date >= %(df)s::date")
        params["df"] = due_from
    if due_to:
        where.append("t.due_date <= %(dt)s::date")
        params["dt"] = due_to
    if project_id:
        where.append("t.project_id = %(pid)s")
        params["pid"] = project_id
    if status:
        where.append("t.status = %(status)s")
        params["status"] = status
    elif not include_done:
        where.append("t.status <> 'done'")
    if priority:
        where.append("t.priority = %(priority)s")
        params["priority"] = priority
    if assignee_ids is not None:
        where.append("t.assignee_id = ANY(%(assignees)s::uuid[])")
        params["assignees"] = [a for a in assignee_ids if is_uuid(a)]
    if unassigned:
        where.append("t.project_id IS NOT NULL AND t.assignee_id IS NULL")
    if no_due:
        where.append("t.due_date IS NULL")
    if query and query.strip():
        where.append("t.title ILIKE %(q)s")
        params["q"] = _title_contains(query)
    return ctx.all(
        f"{TASK_SELECT} WHERE {' AND '.join(where)} ORDER BY t.due_date NULLS LAST, "
        "CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, t.created_at LIMIT %(lim)s",
        params,
    )
