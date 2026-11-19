"""Comentários na tarefa: quem lê a tarefa lê os comentários; quem edita a tarefa comenta.

Autor edita e remove o próprio comentário; quem gerencia o projeto também pode remover
(moderação). O texto é dado do usuário: não vai para o histórico nem para logs.
"""

from __future__ import annotations

from ..db import Ctx
from ..errors import BadRequestError, ForbiddenError
from ..identity.access import TaskAccess, is_uuid, project_access, task_access
from .activity import log_activity

MAX_CHARS = 5000

_SELECT = """SELECT c.id, c.task_id, c.author_id, u.name AS author_name, c.body, c.created_at,
  c.edited_at FROM task_comments c JOIN users u ON u.id = c.author_id"""


def _clean(body: str) -> str:
    body = (body or "").strip()
    if not body:
        raise BadRequestError("Escreva o comentário antes de enviar.")
    if len(body) > MAX_CHARS:
        raise BadRequestError(f"O comentário passa de {MAX_CHARS} caracteres. Divida em partes.")
    return body


def _can_moderate(ctx: Ctx, task: dict) -> bool:
    return bool(task["project_id"]) and project_access(ctx, task["project_id"]).can_manage


def list_comments(ctx: Ctx, task_id: str) -> list[dict]:
    task = task_access(ctx, task_id).task
    moderate = _can_moderate(ctx, task)
    rows = ctx.all(f"{_SELECT} WHERE c.task_id = %s ORDER BY c.created_at, c.id", (task_id,))
    for r in rows:
        mine = r["author_id"] == ctx.user_id
        r["can_edit"] = mine
        r["can_delete"] = mine or moderate
    return rows


def add_comment(ctx: Ctx, task_id: str, body: str) -> dict:
    a = task_access(ctx, task_id)
    if not a.can_comment:
        raise ForbiddenError()
    row = ctx.one(
        "INSERT INTO task_comments(task_id, author_id, body) VALUES (%s,%s,%s) RETURNING id",
        (task_id, ctx.user_id, _clean(body)),
    )
    assert row
    if a.task["project_id"]:
        log_activity(
            ctx,
            a.task["workspace_id"],
            "task.commented",
            a.task["project_id"],
            task_id,
            {"title": a.task["title"]},
        )
    c = ctx.one(f"{_SELECT} WHERE c.id = %s", (row["id"],))
    assert c
    return {**c, "can_edit": True, "can_delete": True}


def _comment_and_task(ctx: Ctx, comment_id: str) -> tuple[dict, TaskAccess]:
    """Trava o comentário e devolve o acesso à tarefa dele; a regra de autoria fica com quem chama."""
    if not is_uuid(comment_id):
        raise ForbiddenError()
    c = ctx.one("SELECT * FROM task_comments WHERE id = %s FOR UPDATE", (comment_id,))
    if not c:
        raise ForbiddenError()
    # Primeiro a tarefa: quem perdeu o acesso a ela perde o acesso ao comentário, mesmo sendo autor.
    return c, task_access(ctx, str(c["task_id"]))


def _is_author_who_can_comment(ctx: Ctx, c: dict, a: TaskAccess) -> bool:
    return c["author_id"] == ctx.user_id and a.can_comment


def edit_comment(ctx: Ctx, comment_id: str, body: str) -> dict:
    c, a = _comment_and_task(ctx, comment_id)
    if not _is_author_who_can_comment(ctx, c, a):
        raise ForbiddenError()
    ctx.run(
        "UPDATE task_comments SET body = %s, edited_at = now() WHERE id = %s",
        (_clean(body), comment_id),
    )
    row = ctx.one(f"{_SELECT} WHERE c.id = %s", (comment_id,))
    assert row
    return {**row, "can_edit": True, "can_delete": True}


def delete_comment(ctx: Ctx, comment_id: str) -> None:
    c, a = _comment_and_task(ctx, comment_id)
    if not (_is_author_who_can_comment(ctx, c, a) or _can_moderate(ctx, a.task)):
        raise ForbiddenError()
    ctx.run("DELETE FROM task_comments WHERE id = %s", (comment_id,))
