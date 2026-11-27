"""Espaços, equipe, convites, matriz de permissões e preferências."""

import json
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from ..db import Ctx
from ..errors import BadRequestError, ConflictError, ForbiddenError, GoneError
from .access import is_uuid, membership, role_in
from .auth import hash_token, new_token
from .policy import (
    CONFIGURABLE_ROLES,
    PERMISSIONS,
    ROLE_LABEL,
    ROLES,
    assert_can,
    granted_list,
    member,
)


def _check_tz(tz: str) -> None:
    try:
        ZoneInfo(tz)
    except (ZoneInfoNotFoundError, ValueError, KeyError) as e:
        raise BadRequestError("Fuso horário inválido") from e


def list_my_workspaces(ctx: Ctx) -> list[dict]:
    rows = ctx.all(
        "SELECT w.id, w.name, w.kind, w.timezone, wm.role, wm.notify_email, wm.notify_inapp, "
        "w.permissions FROM workspaces w "
        "JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.user_id = %s "
        "ORDER BY (w.kind = 'personal') DESC, w.name",
        (ctx.user_id,),
    )
    for r in rows:
        # A interface usa a lista para esconder opções; o servidor confere de novo em cada ação.
        r["permissions"] = granted_list(member(r["role"], r.pop("permissions")))
    return rows


def create_team_workspace(ctx: Ctx, name: str, timezone: str = "America/Sao_Paulo") -> dict:
    name = name.strip()
    if len(name) < 2:
        raise BadRequestError("Dê um nome ao espaço")
    _check_tz(timezone)
    ws = ctx.one(
        "INSERT INTO workspaces(name, kind, timezone, created_by) VALUES (%s,'team',%s,%s) "
        "RETURNING id, name, kind, timezone",
        (name, timezone, ctx.user_id),
    )
    assert ws
    ctx.run(
        "INSERT INTO workspace_members(workspace_id, user_id, role) VALUES (%s,%s,'admin')",
        (ws["id"], ctx.user_id),
    )
    return {**ws, "role": "admin"}


def update_workspace(
    ctx: Ctx, workspace_id: str, name: str | None = None, timezone: str | None = None
) -> None:
    assert_can(membership(ctx, workspace_id), "workspace.manage")
    if timezone:
        _check_tz(timezone)
    ctx.run(
        "UPDATE workspaces SET name = COALESCE(%s, name), timezone = COALESCE(%s, timezone) "
        "WHERE id = %s",
        ((name or "").strip() or None, timezone, workspace_id),
    )


def get_permissions(ctx: Ctx, workspace_id: str) -> dict:
    """Qualquer membro vê a matriz: saber o que cada perfil pode fazer não é segredo."""
    role_in(ctx, workspace_id)
    row = ctx.one("SELECT permissions FROM workspaces WHERE id=%s", (workspace_id,))
    assert row
    matrix = row["permissions"] or {}
    return {
        "catalog": [{"id": k, "label": v} for k, v in PERMISSIONS.items()],
        "roles": [{"id": r, "label": ROLE_LABEL[r]} for r in CONFIGURABLE_ROLES],
        "permissions": {
            r: [p for p in PERMISSIONS if p in matrix.get(r, [])] for r in CONFIGURABLE_ROLES
        },
    }


def set_permissions(ctx: Ctx, workspace_id: str, permissions: dict[str, list[str]]) -> dict:
    """Substitui a matriz inteira. Só o Gestor; o próprio perfil de Gestor não é configurável."""
    assert_can(membership(ctx, workspace_id), "workspace.manage")
    ws = ctx.one("SELECT kind FROM workspaces WHERE id=%s FOR UPDATE", (workspace_id,))
    if ws and ws["kind"] == "personal":
        raise BadRequestError("Espaços pessoais não têm perfis. Crie um espaço de equipe.")
    unknown_roles = set(permissions) - set(CONFIGURABLE_ROLES)
    if unknown_roles:
        raise BadRequestError(
            "Perfil inválido na matriz. Use manager, member ou viewer; o Gestor sempre pode tudo."
        )
    clean: dict[str, list[str]] = {}
    for r in CONFIGURABLE_ROLES:
        given = permissions.get(r, [])
        if any(p not in PERMISSIONS for p in given):
            raise BadRequestError("Permissão desconhecida. Atualize a página e tente de novo.")
        clean[r] = [p for p in PERMISSIONS if p in given]
    ctx.run(
        "UPDATE workspaces SET permissions=%s::jsonb WHERE id=%s",
        (json.dumps(clean), workspace_id),
    )
    return get_permissions(ctx, workspace_id)


def list_members(ctx: Ctx, workspace_id: str) -> list[dict]:
    role_in(ctx, workspace_id)
    return ctx.all(
        "SELECT u.id, u.name, u.email, wm.role, "
        "(SELECT f.updated_at FROM user_photos f WHERE f.user_id = u.id) AS photo_version "
        "FROM workspace_members wm "
        "JOIN users u ON u.id = wm.user_id WHERE wm.workspace_id = %s ORDER BY u.name",
        (workspace_id,),
    )


def _admin_count(ctx: Ctx, workspace_id: str) -> int:
    row = ctx.one(
        "SELECT count(*)::int AS n FROM workspace_members WHERE workspace_id=%s AND role='admin'",
        (workspace_id,),
    )
    return row["n"] if row else 0


def _member_role(ctx: Ctx, workspace_id: str, user_id: str) -> str:
    row = (
        ctx.one(
            "SELECT role FROM workspace_members WHERE workspace_id=%s AND user_id=%s FOR UPDATE",
            (workspace_id, user_id),
        )
        if is_uuid(user_id)
        else None
    )
    if not row:
        raise BadRequestError("A pessoa não pertence ao espaço")
    return row["role"]


def set_member_role(ctx: Ctx, workspace_id: str, user_id: str, role: str) -> None:
    assert_can(membership(ctx, workspace_id), "workspace.manage")
    if role not in ROLES:
        raise BadRequestError("Papel inválido")
    current = _member_role(ctx, workspace_id, user_id)
    if current == "admin" and role != "admin" and _admin_count(ctx, workspace_id) <= 1:
        raise ConflictError("O espaço precisa de ao menos um administrador")
    ctx.run(
        "UPDATE workspace_members SET role=%s WHERE workspace_id=%s AND user_id=%s",
        (role, workspace_id, user_id),
    )


def remove_member(ctx: Ctx, workspace_id: str, user_id: str) -> None:
    me = membership(ctx, workspace_id)
    if user_id != ctx.user_id:
        assert_can(me, "workspace.manage")
    current = _member_role(ctx, workspace_id, user_id)
    if current == "admin" and _admin_count(ctx, workspace_id) <= 1:
        raise ConflictError("O espaço precisa de ao menos um administrador")
    ctx.run(
        "DELETE FROM project_members WHERE user_id=%s AND project_id IN "
        "(SELECT id FROM projects WHERE workspace_id=%s)",
        (user_id, workspace_id),
    )
    ctx.run(
        "UPDATE tasks SET assignee_id=NULL, version=version+1 WHERE workspace_id=%s AND assignee_id=%s",
        (workspace_id, user_id),
    )
    ctx.run(
        "DELETE FROM workspace_members WHERE workspace_id=%s AND user_id=%s",
        (workspace_id, user_id),
    )


def _assert_may_invite_as(me, role: str) -> None:
    """Quem convida sem ser Gestor só concede perfil igual ou abaixo do seu, nunca o de Gestor."""
    if role not in ROLES:
        raise BadRequestError("Papel inválido")
    if me.role != "admin" and (role == "admin" or not me.outranks_or_equals(role)):
        raise ForbiddenError("Você só pode convidar com um perfil igual ou abaixo do seu.")


def create_invitation(ctx: Ctx, workspace_id: str, email: str, role: str) -> dict:
    me = membership(ctx, workspace_id)
    assert_can(me, "workspace.invite")
    ws = ctx.one("SELECT kind FROM workspaces WHERE id=%s", (workspace_id,))
    if ws and ws["kind"] == "personal":
        raise BadRequestError("Espaços pessoais não recebem convites. Crie um espaço de equipe.")
    email = email.strip().lower()
    if "@" not in email or "." not in email.split("@")[-1]:
        raise BadRequestError("E-mail inválido")
    _assert_may_invite_as(me, role)
    token = new_token()
    expires = datetime.now(UTC) + timedelta(days=7)
    row = ctx.one(
        "INSERT INTO invitations(workspace_id, email, role, token_hash, invited_by, expires_at) "
        "VALUES (%s,%s,%s,%s,%s,%s) RETURNING id",
        (workspace_id, email, role, hash_token(token), ctx.user_id, expires),
    )
    assert row
    # O token só existe aqui: o envio por e-mail é pendente; o administrador copia o link.
    return {"id": row["id"], "token": token, "expires_at": expires}


def list_invitations(ctx: Ctx, workspace_id: str) -> list[dict]:
    """O Gestor vê todos os convites pendentes; quem só pode convidar vê os próprios."""
    me = membership(ctx, workspace_id)
    assert_can(me, "workspace.invite")
    return ctx.all(
        "SELECT id, email, role, expires_at FROM invitations WHERE workspace_id=%s "
        "AND accepted_at IS NULL AND expires_at > now() AND (%s OR invited_by=%s) "
        "ORDER BY created_at DESC",
        (workspace_id, me.role == "admin", ctx.user_id),
    )


def revoke_invitation(ctx: Ctx, workspace_id: str, invitation_id: str) -> None:
    me = membership(ctx, workspace_id)
    assert_can(me, "workspace.invite")
    if is_uuid(invitation_id):
        ctx.run(
            "DELETE FROM invitations WHERE id=%s AND workspace_id=%s AND (%s OR invited_by=%s)",
            (invitation_id, workspace_id, me.role == "admin", ctx.user_id),
        )


def accept_invitation(ctx: Ctx, user: dict, token: str) -> dict:
    """O convite vale só para o e-mail convidado, uma única vez e dentro da validade."""
    inv = ctx.one("SELECT * FROM invitations WHERE token_hash=%s FOR UPDATE", (hash_token(token),))
    if not inv or inv["accepted_at"] or inv["expires_at"] < datetime.now(UTC):
        raise GoneError("Convite inválido ou expirado. Peça um novo ao administrador.")
    if inv["email"] != user["email"].lower():
        raise ForbiddenError("Este convite foi enviado para outro e-mail")
    ctx.run(
        "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES (%s,%s,%s) "
        "ON CONFLICT (workspace_id,user_id) DO NOTHING",
        (inv["workspace_id"], ctx.user_id, inv["role"]),
    )
    ctx.run("UPDATE invitations SET accepted_at=now() WHERE id=%s", (inv["id"],))
    return {"workspace_id": inv["workspace_id"]}


def update_my_prefs(
    ctx: Ctx, workspace_id: str, notify_email: bool | None, notify_inapp: bool | None
) -> None:
    role_in(ctx, workspace_id)
    ctx.run(
        "UPDATE workspace_members SET notify_email=COALESCE(%s,notify_email), "
        "notify_inapp=COALESCE(%s,notify_inapp) WHERE workspace_id=%s AND user_id=%s",
        (notify_email, notify_inapp, workspace_id, ctx.user_id),
    )


def update_my_timezone(ctx: Ctx, timezone: str) -> None:
    _check_tz(timezone)
    ctx.run("UPDATE users SET timezone=%s WHERE id=%s", (timezone, ctx.user_id))


def my_profile(ctx: Ctx) -> dict:
    """Dados da própria pessoa da sessão: identidade, lotação, unidade e espaços.

    Só lê a linha de `ctx.user_id`; não há como pedir o perfil de outra pessoa. O código
    interno do GIA e o hash da senha ficam de fora.
    """
    user = ctx.one(
        "SELECT u.id, u.name, u.email, u.matricula, u.allotment, u.timezone, u.created_at, "
        "u.matricula IS NOT NULL AS via_gia, ou.sigla AS unit, ou.label AS unit_label, "
        "(SELECT f.updated_at FROM user_photos f WHERE f.user_id = u.id) AS photo_version "
        "FROM users u LEFT JOIN org_units ou ON ou.sigla = projeta_unit_for_allotment(u.allotment) "
        "WHERE u.id = %s",
        (ctx.user_id,),
    )
    assert user
    origin = "gia" if user.pop("via_gia") else "local"
    heads_of = ctx.all(
        "SELECT ou.sigla, ou.label FROM org_unit_heads h JOIN org_units ou ON ou.sigla = h.sigla "
        "WHERE %s::text IS NOT NULL AND projeta_name_key(h.name) = projeta_name_key(%s) "
        "ORDER BY ou.sigla",
        (user["matricula"], user["name"]),
    )
    spaces = ctx.all(
        "SELECT w.id, w.name, w.kind, w.org_unit, wm.role FROM workspaces w "
        "JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.user_id = %s "
        "ORDER BY (w.kind = 'personal') DESC, w.org_unit IS NULL, w.name",
        (ctx.user_id,),
    )
    unit = {"sigla": user.pop("unit"), "label": user.pop("unit_label")}
    return {
        **user,
        "origin": origin,
        "unit": unit if unit["sigla"] else None,
        "heads_of": heads_of,
        "workspaces": spaces,
    }
