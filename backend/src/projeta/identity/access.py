"""Escopo e permissões de objeto. Falhas são uniformes (403): não revelam se o ID existe."""

from __future__ import annotations

import re
from dataclasses import dataclass

from ..db import Ctx
from ..errors import ForbiddenError
from .policy import can

_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)


def is_uuid(v: object) -> bool:
    return isinstance(v, str) and bool(_UUID.match(v))


# Fragmento SQL: o projeto p é visível a %(uid)s (admin do espaço ou vinculado ao projeto).
VISIBLE_PROJECT = """EXISTS (
  SELECT 1 FROM workspace_members wm
  WHERE wm.workspace_id = p.workspace_id AND wm.user_id = %(uid)s
    AND (wm.role = 'admin' OR EXISTS (
      SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = %(uid)s)))"""

TASK_SELECT = """SELECT t.id, t.workspace_id, t.project_id, t.owner_id, t.title, t.description, t.status,
  t.priority, t.assignee_id, t.due_date::text AS due_date, t.estimate_minutes, t.progress, t.phase,
  t.is_milestone, t.labels, t.position, t.version, t.created_at, t.updated_at, t.completed_at,
  t.parent_id, pt.title AS parent_title, p.name AS project_name, au.name AS assignee_name
  FROM tasks t LEFT JOIN projects p ON p.id = t.project_id LEFT JOIN users au ON au.id = t.assignee_id
  LEFT JOIN tasks pt ON pt.id = t.parent_id"""


def role_in(ctx: Ctx, workspace_id: str) -> str:
    if not is_uuid(workspace_id):
        raise ForbiddenError()
    row = ctx.one(
        "SELECT role FROM workspace_members WHERE workspace_id = %s AND user_id = %s",
        (workspace_id, ctx.user_id),
    )
    if not row:
        raise ForbiddenError()
    return row["role"]


@dataclass
class ProjectAccess:
    project: dict
    role: str
    can_write: bool  # criar/editar tarefas
    can_manage: bool  # arquivar, membros


def project_access(ctx: Ctx, project_id: str, lock: bool = False) -> ProjectAccess:
    if not is_uuid(project_id):
        raise ForbiddenError()
    project = ctx.one(
        f"SELECT p.* FROM projects p WHERE p.id = %(pid)s AND {VISIBLE_PROJECT}"
        + (" FOR UPDATE OF p" if lock else ""),
        {"pid": project_id, "uid": ctx.user_id},
    )
    if not project:
        raise ForbiddenError()
    role = role_in(ctx, project["workspace_id"])
    linked = role == "admin" or bool(
        ctx.one(
            "SELECT 1 AS x FROM project_members WHERE project_id=%s AND user_id=%s",
            (project_id, ctx.user_id),
        )
    )
    active = project["status"] == "active"
    return ProjectAccess(
        project,
        role,
        can_write=active and linked and can(role, "task.write"),
        can_manage=active and linked and can(role, "project.manage"),
    )


@dataclass
class TaskAccess:
    task: dict
    can_write: bool


def task_access(ctx: Ctx, task_id: str, lock: bool = False) -> TaskAccess:
    if not is_uuid(task_id):
        raise ForbiddenError()
    task = ctx.one(
        f"{TASK_SELECT} WHERE t.id = %s" + (" FOR UPDATE OF t" if lock else ""), (task_id,)
    )
    if not task:
        raise ForbiddenError()
    if not task["project_id"]:
        # tarefa pessoal: só o dono (nem o admin do espaço enxerga)
        if task["owner_id"] != ctx.user_id:
            raise ForbiddenError()
        role_in(ctx, task["workspace_id"])
        return TaskAccess(task, True)
    pa = project_access(ctx, task["project_id"])
    return TaskAccess(task, pa.can_write)
