"""Imagem de capa do projeto: quem vê o projeto vê a capa; só quem gerencia troca ou remove."""

from ..db import Ctx
from ..errors import BadRequestError, ForbiddenError
from ..identity.access import project_access

MAX_BYTES = 3 * 1024 * 1024

# O tipo vem dos primeiros bytes, nunca do cabeçalho enviado: o cliente não escolhe o que é servido.
# SVG fica de fora de propósito (pode carregar script).
_SIGNATURES = (
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
)


def sniff_type(data: bytes) -> str | None:
    for magic, ctype in _SIGNATURES:
        if data.startswith(magic):
            return ctype
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def set_cover(ctx: Ctx, project_id: str, data: bytes) -> dict:
    a = project_access(ctx, project_id, lock=True)
    if not a.can_manage:
        raise ForbiddenError()
    if not data:
        raise BadRequestError("Nenhuma imagem foi enviada. Escolha um arquivo PNG, JPEG ou WebP.")
    if len(data) > MAX_BYTES:
        raise BadRequestError("A imagem passa de 3 MB. Escolha uma menor ou reduza o tamanho dela.")
    ctype = sniff_type(data)
    if not ctype:
        raise BadRequestError("Formato não aceito. Envie uma imagem PNG, JPEG ou WebP.")
    row = ctx.one(
        "INSERT INTO project_covers(project_id, content_type, data) VALUES (%s,%s,%s) "
        "ON CONFLICT (project_id) DO UPDATE SET content_type=EXCLUDED.content_type, "
        "data=EXCLUDED.data, updated_at=now() RETURNING updated_at",
        (project_id, ctype, data),
    )
    assert row
    return {"cover_version": row["updated_at"]}


def get_cover(ctx: Ctx, project_id: str) -> dict | None:
    project_access(ctx, project_id)  # mesma regra de leitura do projeto
    return ctx.one(
        "SELECT content_type, data, updated_at FROM project_covers WHERE project_id=%s",
        (project_id,),
    )


def delete_cover(ctx: Ctx, project_id: str) -> None:
    a = project_access(ctx, project_id, lock=True)
    if not a.can_manage:
        raise ForbiddenError()
    ctx.run("DELETE FROM project_covers WHERE project_id=%s", (project_id,))
