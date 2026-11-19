"""Convite para projeto por matrícula, tendo o GIA como referência de identidade.

O GIA só confirma quem a pessoa é no login; não há consulta de diretório. Logo o convite
guarda a matrícula: se a pessoa já tem conta, entra no projeto na hora; senão, o vínculo é
feito no primeiro login (ver `identity.auth`). A resposta é a mesma nos dois casos para não
revelar quem já usou o sistema.
"""

from __future__ import annotations

import re

from ..db import Ctx
from ..errors import BadRequestError, ForbiddenError
from ..identity.access import project_access
from .activity import log_activity

_MATRICULA = re.compile(r"^[A-Z0-9._-]{1,40}$")


def _normalize(matricula: str) -> str:
    m = matricula.strip().upper()
    if not _MATRICULA.match(m):
        raise BadRequestError("Matrícula inválida. Use só letras, números, ponto, hífen ou _.")
    return m


def invite_by_matricula(ctx: Ctx, project_id: str, matricula: str) -> dict:
    a = project_access(ctx, project_id, lock=True)
    if not a.can_manage:
        raise ForbiddenError()
    m = _normalize(matricula)
    ws = a.project["workspace_id"]
    user = ctx.one("SELECT id FROM users WHERE matricula = %s", (m,))
    if user:
        # Entra no espaço como membro (sem criar projetos) se ainda não estiver nele.
        ctx.run(
            "INSERT INTO workspace_members(workspace_id, user_id, role) VALUES (%s,%s,'member') "
            "ON CONFLICT DO NOTHING",
            (ws, user["id"]),
        )
        ctx.run(
            "INSERT INTO project_members(project_id, user_id) VALUES (%s,%s) ON CONFLICT DO NOTHING",
            (project_id, user["id"]),
        )
    else:
        ctx.run(
            "INSERT INTO project_invites(project_id, matricula, invited_by) VALUES (%s,%s,%s) "
            "ON CONFLICT DO NOTHING",
            (project_id, m, ctx.user_id),
        )
    # O log guarda a matrícula, nunca o resultado: não distingue conta existente de pendente.
    log_activity(ctx, ws, "project.invited", project_id, data={"matricula": m})
    return {
        "matricula": m,
        "message": "Convite registrado. A pessoa passa a ver o projeto após entrar com o GIA.",
    }


def list_pending(ctx: Ctx, project_id: str) -> list[dict]:
    a = project_access(ctx, project_id)
    if not a.can_manage:
        raise ForbiddenError()
    return ctx.all(
        "SELECT i.matricula, i.created_at, u.name AS invited_by_name FROM project_invites i "
        "JOIN users u ON u.id = i.invited_by WHERE i.project_id = %s ORDER BY i.created_at",
        (project_id,),
    )


def revoke(ctx: Ctx, project_id: str, matricula: str) -> None:
    a = project_access(ctx, project_id)
    if not a.can_manage:
        raise ForbiddenError()
    ctx.run(
        "DELETE FROM project_invites WHERE project_id = %s AND matricula = %s",
        (project_id, _normalize(matricula)),
    )
