from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .. import db
from ..errors import AppError
from .deps import CSRF_HEADER, CSRF_VALUE
from .routes import assistant, auth, okrs, projects, risks, sprints, tasks, today, workspaces

logger = logging.getLogger("projeta")
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


@asynccontextmanager
async def lifespan(_: FastAPI):
    applied = db.migrate()
    if applied:
        logger.info("Migrações aplicadas: %s", applied)
    yield
    db.close_pool()


def create_app() -> FastAPI:
    app = FastAPI(title="Projeta API", version="0.1.0", lifespan=lifespan)

    @app.middleware("http")
    async def csrf_guard(request: Request, call_next):
        # Defesa em profundidade além de SameSite=Lax: exige cabeçalho que formulários
        # cross-site não conseguem enviar.
        if request.method not in SAFE_METHODS and request.headers.get(CSRF_HEADER) != CSRF_VALUE:
            return JSONResponse(
                status_code=403,
                content={"error": {"code": "csrf", "message": "Requisição não reconhecida."}},
            )
        return await call_next(request)

    # Tabela única: exceção de domínio -> resposta HTTP.
    @app.exception_handler(AppError)
    async def app_error(_: Request, e: AppError):
        body = {"code": e.code, "message": e.message}
        if e.details is not None:
            body["details"] = e.details
        return JSONResponse(status_code=e.status, content=jsonable_encoder({"error": body}))

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, e: RequestValidationError):
        return JSONResponse(
            status_code=422,
            content={"error": {"code": "invalid", "message": "Confira os campos enviados."}},
        )

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok"}

    for r in (auth, workspaces, projects, risks, tasks, sprints, today, okrs, assistant):
        app.include_router(r.router, prefix="/api/v1")
    return app


app = create_app()
