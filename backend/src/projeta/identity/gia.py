"""Cliente do GIA, o serviço corporativo que valida matrícula e senha.

O PROJETA não guarda senha: quem confirma a identidade é o GIA. Só este módulo fala com ele.
"""

import logging
from typing import Any

import httpx

from ..errors import UnauthorizedError, UpstreamError
from ..settings import get_settings

logger = logging.getLogger(__name__)

# O GIA devolve chaves em português que variam entre ambientes (mesma lista do plugin gia-auth).
_NAME_KEYS = ("name", "nm_usuario", "no_usuario", "nm_pessoa", "nome")
_EMAIL_KEYS = ("email", "ds_email", "nm_email", "email_institucional")
# Lotação: em produção o GIA manda só a sigla em `sg_lotacao` (ex.: "DIRAU").
_ALLOTMENT_KEYS = ("sg_lotacao", "allotment")


def _pick(body: dict[str, Any], keys: tuple[str, ...]) -> str:
    for key in keys:
        value = body.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def authenticate(matricula: str, password: str, station: str) -> dict:
    """Confirma matrícula e senha. Devolve `gia_code`, `name`, `email` e `allotment`.

    Recusa do GIA (credencial errada, matrícula sem acesso ao sistema) vira 401; serviço fora do
    ar vira 503. A entrada local por e-mail e senha é outra via (auth.login_local) e não vale como reserva para contas do GIA, que não têm senha local.
    """
    cfg = get_settings()
    url = cfg.gia_service.rstrip("/") + "/" + cfg.gia_endpoint.lstrip("/")
    payload = {
        "sistema": cfg.gia_system_id,
        "matricula": matricula.upper(),
        "senha": password,
        "estacao": station,
    }
    try:
        resp = httpx.post(url, json=payload, timeout=cfg.gia_timeout_s, verify=cfg.gia_verify_ssl)
    except httpx.HTTPError as exc:
        # Sem corpo nem senha no log: só o tipo do erro.
        logger.warning("GIA indisponível (%s)", type(exc).__name__)
        raise UpstreamError(
            "O serviço de autenticação (GIA) não respondeu. Tente de novo em instantes."
        ) from exc

    if resp.status_code >= 500:
        logger.warning("GIA respondeu HTTP %s", resp.status_code)
        raise UpstreamError(
            "O serviço de autenticação (GIA) está com problemas. Tente de novo em instantes."
        )
    refusal = UnauthorizedError("Matrícula ou senha incorretas, ou sem acesso a este sistema.")
    if not resp.is_success:
        raise refusal
    try:
        body = resp.json()
    except ValueError:
        body = None
    if not isinstance(body, dict) or not body.get("cd_usuario"):
        raise refusal

    return {
        "gia_code": str(body["cd_usuario"]),
        "name": _pick(body, _NAME_KEYS),
        "email": _pick(body, _EMAIL_KEYS).lower(),
        "allotment": " ".join(_pick(body, _ALLOTMENT_KEYS).split()),
    }
