from fastapi import Cookie

from ..db import uow
from ..errors import UnauthorizedError
from ..identity import auth

COOKIE = "projeta_session"
CSRF_HEADER = "x-requested-with"
CSRF_VALUE = "projeta-web"
NOBODY = "00000000-0000-0000-0000-000000000000"


def current_user(projeta_session: str | None = Cookie(default=None)) -> dict:
    """Identidade vem exclusivamente da sessão do cookie — nunca do corpo da requisição."""
    with uow(NOBODY) as ctx:
        user = auth.user_from_token(ctx, projeta_session)
    if not user:
        raise UnauthorizedError("Sessão expirada. Entre novamente.")
    return user
