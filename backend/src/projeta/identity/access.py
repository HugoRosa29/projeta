"""Escopo e permissões de objeto. Falhas são uniformes (403): não revelam se o ID existe."""

from __future__ import annotations

import re
from dataclasses import dataclass

from ..db import Ctx
from ..errors import ForbiddenError
from .policy import Member, member

_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)


def is_uuid(v: object) -> bool:
    return isinstance(v, str) and bool(_UUID.match(v))


# Fragmento SQL: o projeto p é visível a %(uid)s quando
#  - no espaço dono: Gestor, perfil com `project.view_all`, ou vinculado ao projeto; ou
#  - compartilhado (project_shares) com a unidade do organograma de um espaço onde %(uid)s é
#    Gestor ou tem `org.view_shared`. Essa via é só leitura (ver `project_access`).
# Espelha `policy.Member.can`.
_HAS = "COALESCE({ws}.permissions -> {wm}.role, '[]'::jsonb) @> '\"{perm}\"'::jsonb"
SHARED_TO_ME = f"""EXISTS (
  SELECT 1 FROM project_shares sh
  JOIN workspaces shw ON shw.org_unit = sh.unit
  JOIN workspace_members shm ON shm.workspace_id = shw.id AND shm.user_id = %(uid)s
  WHERE sh.project_id = p.id
    AND (shm.role = 'admin' OR {_HAS.format(ws="shw", wm="shm", perm="org.view_shared")}))"""
VISIBLE_PROJECT = f"""(EXISTS (
  SELECT 1 FROM workspace_members wm JOIN workspaces wsp ON wsp.id = wm.workspace_id
  WHERE wm.workspace_id = p.workspace_id AND wm.user_id = %(uid)s
    AND (wm.role = 'admin'
      OR {_HAS.format(ws="wsp", wm="wm", perm="project.view_all")}
      OR EXISTS (
      SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = %(uid)s)))
  OR {SHARED_TO_ME})"""

# Listas do espaço %(ws)s: os projetos dele e os recebidos pela unidade dele no organograma.
# Sempre combinado com VISIBLE_PROJECT, que exige `org.view_shared` para os recebidos.
IN_WORKSPACE_OR_RECEIVED = """(p.workspace_id = %(ws)s OR p.id IN (
  SELECT sh.project_id FROM project_shares sh JOIN workspaces rw ON rw.org_unit = sh.unit
  WHERE rw.id = %(ws)s))"""
# Coluna: nome do espaço de origem quando o projeto foi recebido (nulo quando é do espaço).
SHARED_FROM = """CASE WHEN p.workspace_id <> %(ws)s THEN
  (SELECT ow.name FROM workspaces ow WHERE ow.id = p.workspace_id) END AS shared_from"""

TASK_SELECT = """SELECT t.id, t.workspace_id, t.project_id, t.owner_id, t.title, t.description, t.status,
  t.priority, t.assignee_id, t.start_date::text AS start_date, t.due_date::text AS due_date,
  t.estimate_minutes, t.progress, t.phase,
  t.is_milestone, t.labels, t.position, t.version, t.created_at, t.updated_at, t.completed_at,
  t.parent_id, pt.title AS parent_title, p.name AS project_name, au.name AS assignee_name,
  t.sprint_id, spr.name AS sprint_name, spr.status AS sprint_status,
  ARRAY(SELECT dep.depends_on_id::text FROM task_dependencies dep WHERE dep.task_id = t.id
        ORDER BY dep.depends_on_id) AS depends_on_ids
  FROM tasks t LEFT JOIN projects p ON p.id = t.project_id LEFT JOIN users au ON au.id = t.assignee_id
  LEFT JOIN tasks pt ON pt.id = t.parent_id LEFT JOIN sprints spr ON spr.id = t.sprint_id"""


def membership(ctx: Ctx, workspace_id: str) -> Member:
    """Perfil e permissões de quem age no espaço; 403 se não for membro."""
    if not is_uuid(workspace_id):
        raise ForbiddenError()
    row = ctx.one(
        "SELECT wm.role, w.permissions FROM workspace_members wm "
        "JOIN workspaces w ON w.id = wm.workspace_id WHERE wm.workspace_id = %s AND wm.user_id = %s",
        (workspace_id, ctx.user_id),
    )
    if not row:
        raise ForbiddenError()
    return member(row["role"], row["permissions"])


def role_in(ctx: Ctx, workspace_id: str) -> str:
    return membership(ctx, workspace_id).role


@dataclass
class ProjectAccess:
    project: dict
    role: str
    member: Member
    linked: bool  # Gestor ou membro do projeto (ver todos não conta: é só leitura)
    can_write: bool  # criar/editar tarefas
    can_manage: bool  # arquivar, membros
    can_comment: bool


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
    try:
        m = membership(ctx, project["workspace_id"])
    except ForbiddenError:
        # Visível só pelo compartilhamento no organograma: leitura, nunca escrita nem gestão.
        return ProjectAccess(project, "viewer", Member("viewer"), False, False, False, False)
    role = m.role
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
        m,
        linked,
        can_write=active and linked and m.can("task.write"),
        can_manage=active and linked and m.can("project.manage"),
        can_comment=active and linked and m.can("comment.write"),
    )


@dataclass
class TaskAccess:
    task: dict
    can_write: bool
    can_comment: bool


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
        return TaskAccess(task, True, True)
    pa = project_access(ctx, task["project_id"])
    return TaskAccess(task, pa.can_write, pa.can_comment)
