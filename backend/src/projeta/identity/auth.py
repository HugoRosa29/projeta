"""Sessões em cookie opaco (só o hash do token fica no banco) e entrada via GIA."""

import hashlib
import hmac
import re
import secrets
from datetime import UTC, datetime, timedelta

from ..db import Ctx
from ..errors import BadRequestError, ConflictError, UnauthorizedError
from ..settings import get_settings
from . import gia

_EMAIL = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
_MATRICULA = re.compile(r"^[A-Z0-9._-]{1,40}$")


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def new_token() -> str:
    return secrets.token_urlsafe(32)


def create_session(ctx: Ctx, user_id: str) -> tuple[str, datetime]:
    token = new_token()
    expires = datetime.now(UTC) + timedelta(days=get_settings().session_ttl_days)
    ctx.run(
        "INSERT INTO sessions(token_hash, user_id, expires_at) VALUES (%s,%s,%s)",
        (hash_token(token), user_id, expires),
    )
    return token, expires


def user_from_token(ctx: Ctx, token: str | None) -> dict | None:
    if not token:
        return None
    return ctx.one(
        "SELECT u.id, u.email, u.name, u.timezone FROM sessions s JOIN users u ON u.id = s.user_id "
        "WHERE s.token_hash = %s AND s.expires_at > now()",
        (hash_token(token),),
    )


def end_session(ctx: Ctx, token: str) -> None:
    ctx.run("DELETE FROM sessions WHERE token_hash = %s", (hash_token(token),))


def _free_email(ctx: Ctx, matricula: str, email: str, user_id: str | None) -> str:
    """E-mail do GIA se válido e livre; senão o de reserva (e-mail é único no PROJETA)."""
    fallback = f"{matricula.lower()}@{get_settings().gia_email_domain.lstrip('@')}"
    if not _EMAIL.match(email):
        return fallback
    owner = ctx.one("SELECT id FROM users WHERE email = %s", (email,))
    return fallback if owner and owner["id"] != user_id else email


def _join_allotment_workspace(ctx: Ctx, user_id: str, allotment: str) -> None:
    """Espaço de equipe comum da lotação: criado na primeira entrada, depois só recebe membros.

    Todos entram como `manager` (membro não cria projeto, e o espaço precisa ser útil a quem
    chega); administrar o espaço (papéis e convites) é decisão posterior, não de quem
    chegou primeiro.
    """
    ctx.run(
        "INSERT INTO workspaces(name, kind, allotment, created_by) VALUES (%s,'team',%s,%s) "
        "ON CONFLICT (lower(allotment)) WHERE allotment IS NOT NULL DO NOTHING",
        (allotment, allotment, user_id),
    )
    ctx.run(
        "INSERT INTO workspace_members(workspace_id, user_id, role) "
        "SELECT id, %s, 'manager' FROM workspaces WHERE lower(allotment) = lower(%s) "
        "ON CONFLICT DO NOTHING",
        (user_id, allotment),
    )


def _claim_project_invites(ctx: Ctx, user_id: str, matricula: str) -> None:
    """Convites por matrícula feitos antes da primeira entrada: vincula ao espaço e ao projeto.

    O GIA acabou de confirmar a matrícula, então ela prova a identidade. Entra como `member`
    no espaço, sem rebaixar quem já tem papel maior (por exemplo, o da lotação).
    """
    ctx.run(
        "INSERT INTO workspace_members(workspace_id, user_id, role) "
        "SELECT DISTINCT p.workspace_id, %s::uuid, 'member' FROM project_invites i "
        "JOIN projects p ON p.id = i.project_id WHERE i.matricula = %s ON CONFLICT DO NOTHING",
        (user_id, matricula),
    )
    ctx.run(
        "INSERT INTO project_members(project_id, user_id) "
        "SELECT project_id, %s::uuid FROM project_invites WHERE matricula = %s ON CONFLICT DO NOTHING",
        (user_id, matricula),
    )
    ctx.run("DELETE FROM project_invites WHERE matricula = %s", (matricula,))


def provision_user(
    ctx: Ctx,
    matricula: str,
    name: str,
    email: str = "",
    allotment: str = "",
    gia_code: str = "",
) -> dict:
    """Cria ou atualiza a pessoa pela matrícula e a coloca no espaço pessoal e no da lotação."""
    matricula = matricula.strip().upper()
    if not _MATRICULA.match(matricula):
        raise BadRequestError("Matrícula inválida. Use só letras, números, ponto, hífen ou _.")
    name = name.strip() or matricula
    cols = "id, email, name, timezone"
    user = ctx.one(f"SELECT {cols} FROM users WHERE matricula = %s", (matricula,))
    email = _free_email(ctx, matricula, email.strip().lower(), user["id"] if user else None)
    if user:
        user = ctx.one(
            "UPDATE users SET name=%s, email=%s, gia_code=%s, allotment=%s WHERE id=%s "
            f"RETURNING {cols}",
            (name, email, gia_code or None, allotment or None, user["id"]),
        )
        assert user
    else:
        user = ctx.one(
            "INSERT INTO users(matricula, email, name, gia_code, allotment) "
            f"VALUES (%s,%s,%s,%s,%s) RETURNING {cols}",
            (matricula, email, name, gia_code or None, allotment or None),
        )
        assert user
        _create_personal_space(ctx, user["id"], name)
    if allotment:
        _join_allotment_workspace(ctx, user["id"], allotment)
    _claim_project_invites(ctx, user["id"], matricula)
    return user


_MIN_PASSWORD = 8
_SCRYPT = {"n": 2**14, "r": 8, "p": 1}


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, **_SCRYPT)
    return f"scrypt${salt.hex()}${digest.hex()}"


def _check_password(password: str, stored: str | None) -> bool:
    # Sempre calcula o scrypt, mesmo sem conta, para não revelar por tempo se o e-mail existe.
    _, salt_hex, digest_hex = (stored or f"scrypt${'00' * 16}${'00' * 64}").split("$")
    digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt_hex), **_SCRYPT)
    return stored is not None and hmac.compare_digest(digest.hex(), digest_hex)


def _create_personal_space(ctx: Ctx, user_id: str, name: str) -> None:
    ws = ctx.one(
        "INSERT INTO workspaces(name, kind, created_by) VALUES (%s,'personal',%s) RETURNING id",
        (f"Espaço de {name.split()[0]}", user_id),
    )
    assert ws
    ctx.run(
        "INSERT INTO workspace_members(workspace_id, user_id, role) VALUES (%s,%s,'admin')",
        (ws["id"], user_id),
    )


def register(ctx: Ctx, name: str, email: str, password: str) -> dict:
    """Cadastro local por e-mail e senha: cria a conta e o espaço pessoal (sem lotação)."""
    name, email = name.strip(), email.strip().lower()
    if not name:
        raise BadRequestError("Informe seu nome.")
    if not _EMAIL.match(email):
        raise BadRequestError("E-mail inválido. Confira o endereço e tente de novo.")
    if len(password) < _MIN_PASSWORD:
        raise BadRequestError(f"A senha precisa ter ao menos {_MIN_PASSWORD} caracteres.")
    if ctx.one("SELECT 1 FROM users WHERE email = %s", (email,)):
        raise ConflictError("Este e-mail já tem conta. Entre com ele ou use outro e-mail.")
    user = ctx.one(
        "INSERT INTO users(email, name, password_hash) VALUES (%s,%s,%s) "
        "RETURNING id, email, name, timezone",
        (email, name, hash_password(password)),
    )
    assert user
    _create_personal_space(ctx, user["id"], name)
    return user


def login_local(ctx: Ctx, email: str, password: str) -> dict:
    """Entrada por e-mail e senha locais. Contas do GIA não têm senha local e são recusadas."""
    row = ctx.one(
        "SELECT id, email, name, timezone, password_hash FROM users WHERE email = %s",
        (email.strip().lower(),),
    )
    if not _check_password(password, row["password_hash"] if row else None):
        raise UnauthorizedError("E-mail ou senha incorretos.")
    assert row
    row.pop("password_hash")
    return row


def login(ctx: Ctx, matricula: str, password: str, station: str = "") -> dict:
    """Entra pelo GIA; a primeira entrada cria a conta e a lotação vira espaço comum."""
    matricula = matricula.strip()
    if not matricula or not password:
        raise BadRequestError("Informe matrícula e senha.")
    data = gia.authenticate(matricula, password, station)
    return provision_user(
        ctx, matricula, data["name"], data["email"], data["allotment"], data["gia_code"]
    )
