"""Organização: espaços das unidades no organograma e compartilhamento de projetos para cima.

Regras (ADR 0004):
- O espaço oficial de uma unidade é o da lotação (vínculo vindo do GIA, `workspaces.org_unit`).
- O Gestor do espaço dono compartilha um projeto com a unidade imediatamente acima.
- Quem recebeu decide se repassa ao nível seguinte: o Gestor da unidade que recebeu repassa
  à unidade acima dela. Assim a COTIN decide o que a COINT e a PRESIDÊNCIA veem de DISID.
- Desfazer num nível desfaz também tudo o que foi repassado daquele nível para cima.
- Quem vê na unidade que recebeu: Gestor e perfis com `org.view_shared`. Sempre só leitura.
"""

from __future__ import annotations

from ..db import Ctx
from ..errors import BadRequestError, ForbiddenError
from ..identity.access import VISIBLE_PROJECT, is_uuid, membership
from ..identity.policy import assert_can
from .activity import log_activity


def _unit_of(ctx: Ctx, workspace_id: str) -> str | None:
    row = ctx.one("SELECT org_unit FROM workspaces WHERE id=%s", (workspace_id,))
    return row["org_unit"] if row else None


def _chain(ctx: Ctx, unit: str) -> list[dict]:
    """A unidade e suas superiores, de baixo para cima."""
    return ctx.all(
        """WITH RECURSIVE up AS (
             SELECT sigla, label, parent, 0 AS depth FROM org_units WHERE sigla = %s
             UNION ALL
             SELECT u.sigla, u.label, u.parent, up.depth + 1 FROM org_units u
             JOIN up ON u.sigla = up.parent)
           SELECT up.sigla, up.label, w.name AS workspace_name, (w.id IS NOT NULL) AS has_space
           FROM up LEFT JOIN workspaces w ON w.org_unit = up.sigla ORDER BY depth""",
        (unit,),
    )


def _parent(ctx: Ctx, unit: str) -> str | None:
    row = ctx.one("SELECT parent FROM org_units WHERE sigla=%s", (unit,))
    return row["parent"] if row else None


def org_view(ctx: Ctx, workspace_id: str) -> dict:
    """O que este espaço é no organograma, o que ele compartilha para cima e o que recebeu."""
    me = membership(ctx, workspace_id)
    unit = _unit_of(ctx, workspace_id)
    if not unit:
        return {
            "unit": None,
            "chain": [],
            "parent": None,
            "own": [],
            "received": [],
            "children": [],
            "can_share": False,
        }
    parent = _parent(ctx, unit)
    can_share = me.can("workspace.manage") and parent is not None
    params = {"ws": workspace_id, "uid": ctx.user_id, "unit": unit, "parent": parent}
    own = ctx.all(
        f"""SELECT p.id, p.name, p.status,
              EXISTS (SELECT 1 FROM project_shares s WHERE s.project_id = p.id
                      AND s.unit = %(parent)s) AS shared_up
            FROM projects p WHERE p.workspace_id = %(ws)s AND p.status = 'active'
              AND {VISIBLE_PROJECT}
            ORDER BY p.name""",
        params,
    )
    received = []
    if me.can("org.view_shared"):
        received = ctx.all(
            """SELECT p.id, p.name, s.from_unit, ow.name AS origin_workspace, ow.org_unit AS origin_unit,
                 EXISTS (SELECT 1 FROM project_shares s2 WHERE s2.project_id = p.id
                         AND s2.unit = %(parent)s) AS shared_up
               FROM project_shares s JOIN projects p ON p.id = s.project_id
               JOIN workspaces ow ON ow.id = p.workspace_id
               WHERE s.unit = %(unit)s AND p.status = 'active'
               ORDER BY ow.org_unit, p.name""",
            params,
        )
    children = ctx.all(
        """SELECT u.sigla, u.label, w.name AS workspace_name, (w.id IS NOT NULL) AS has_space
           FROM org_units u LEFT JOIN workspaces w ON w.org_unit = u.sigla
           WHERE u.parent = %(unit)s ORDER BY u.sigla""",
        params,
    )
    return {
        "unit": unit,
        "chain": _chain(ctx, unit),
        "parent": parent,
        "own": own,
        "received": received,
        "children": children,
        "can_share": can_share,
    }


def _gestor_unit(ctx: Ctx, workspace_id: str) -> tuple[str, str]:
    """(unidade do espaço, unidade acima). Só o Gestor de um espaço de unidade compartilha."""
    assert_can(membership(ctx, workspace_id), "workspace.manage")
    unit = _unit_of(ctx, workspace_id)
    if not unit:
        raise BadRequestError(
            "Este espaço não é o espaço de uma unidade do organograma. "
            "Compartilhe a partir do espaço da sua lotação."
        )
    parent = _parent(ctx, unit)
    if not parent:
        raise BadRequestError("Esta unidade é o topo do organograma: não há a quem compartilhar.")
    return unit, parent


def _holds(ctx: Ctx, workspace_id: str, unit: str, project_id: str) -> bool:
    """O espaço é dono do projeto ou a unidade dele recebeu o projeto."""
    return bool(
        ctx.one(
            "SELECT 1 AS x FROM projects p WHERE p.id = %s AND (p.workspace_id = %s OR EXISTS "
            "(SELECT 1 FROM project_shares s WHERE s.project_id = p.id AND s.unit = %s))",
            (project_id, workspace_id, unit),
        )
    )


def share_up(ctx: Ctx, workspace_id: str, project_id: str) -> None:
    unit, parent = _gestor_unit(ctx, workspace_id)
    if not is_uuid(project_id) or not _holds(ctx, workspace_id, unit, project_id):
        raise ForbiddenError()
    ctx.run(
        "INSERT INTO project_shares(project_id, unit, from_unit, shared_by) VALUES (%s,%s,%s,%s) "
        "ON CONFLICT DO NOTHING",
        (project_id, parent, unit, ctx.user_id),
    )
    log_activity(ctx, _owner(ctx, project_id), "project.shared", project_id, data={"unit": parent})


def unshare_up(ctx: Ctx, workspace_id: str, project_id: str) -> None:
    """Desfaz o compartilhamento deste nível e tudo o que foi repassado acima dele."""
    unit, _parent_unit = _gestor_unit(ctx, workspace_id)
    if not is_uuid(project_id) or not _holds(ctx, workspace_id, unit, project_id):
        raise ForbiddenError()
    above = [u["sigla"] for u in _chain(ctx, unit)[1:]]
    ctx.run(
        "DELETE FROM project_shares WHERE project_id = %s AND unit = ANY(%s)", (project_id, above)
    )
    log_activity(ctx, _owner(ctx, project_id), "project.unshared", project_id, data={"unit": unit})


def share_all_up(ctx: Ctx, workspace_id: str) -> int:
    """Compartilha com a unidade acima todos os projetos ativos do espaço (não os recebidos)."""
    unit, parent = _gestor_unit(ctx, workspace_id)
    rows = ctx.all(
        "INSERT INTO project_shares(project_id, unit, from_unit, shared_by) "
        "SELECT id, %s, %s, %s FROM projects WHERE workspace_id = %s AND status = 'active' "
        "ON CONFLICT DO NOTHING RETURNING project_id",
        (parent, unit, ctx.user_id, workspace_id),
    )
    for r in rows:
        log_activity(
            ctx, workspace_id, "project.shared", str(r["project_id"]), data={"unit": parent}
        )
    return len(rows)


def _owner(ctx: Ctx, project_id: str) -> str:
    row = ctx.one("SELECT workspace_id FROM projects WHERE id=%s", (project_id,))
    assert row
    return str(row["workspace_id"])
