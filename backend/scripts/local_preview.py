"""Serve a interface compilada junto com a API para demonstração local."""

from pathlib import Path

from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException

from projeta.api.app import create_app


class PreviewFiles(StaticFiles):
    async def get_response(self, path, scope):
        try:
            return await super().get_response(path, scope)
        except HTTPException as exc:
            # Rotas da SPA precisam voltar ao index ao recarregar o navegador.
            if exc.status_code == 404 and "." not in path.rsplit("/", 1)[-1]:
                return await super().get_response("index.html", scope)
            raise


app = create_app()
app.mount(
    "/",
    PreviewFiles(directory=Path(__file__).resolve().parents[2] / "frontend" / "dist", html=True),
)
