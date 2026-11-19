"""Exceções de domínio. As mensagens chegam ao usuário: digam o que houve e o que fazer."""

from typing import Any


class AppError(Exception):
    status = 400
    code = "bad_request"

    def __init__(self, message: str, details: Any = None):
        super().__init__(message)
        self.message = message
        self.details = details


class BadRequestError(AppError):
    status, code = 400, "bad_request"


class UnauthorizedError(AppError):
    status, code = 401, "unauthorized"


class ForbiddenError(AppError):
    """Também usada para objeto inexistente: não revela se o ID existe em outro espaço."""

    status, code = 403, "forbidden"

    def __init__(self, message: str = "Acesso negado", details: Any = None):
        super().__init__(message, details)


class ConflictError(AppError):
    status, code = 409, "conflict"


class GoneError(AppError):
    status, code = 410, "gone"


class RateLimitError(AppError):
    status, code = 429, "rate_limited"


class UpstreamError(AppError):
    """Provedor externo (modelo) indisponível — recuperável."""

    status, code = 503, "upstream_unavailable"
