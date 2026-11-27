"""Foto de perfil: cada pessoa troca e remove só a própria (sempre a de `ctx.user_id`).

Ler a de outra pessoa só vale para quem divide algum espaço com ela: é o que a equipe do
projeto e a lista de quem convidar mostram.
"""

from ..db import Ctx
from ..errors import BadRequestError, ForbiddenError
from .access import is_uuid

MAX_BYTES = 1024 * 1024

# O tipo vem dos primeiros bytes, nunca do cabeçalho enviado: o cliente não escolhe o que é servido.
# SVG fica de fora de propósito (pode carregar script). A capa de projeto usa a mesma regra.
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


def set_my_photo(ctx: Ctx, data: bytes) -> dict:
    if not data:
        raise BadRequestError("Nenhuma imagem foi enviada. Escolha um arquivo PNG, JPEG ou WebP.")
    if len(data) > MAX_BYTES:
        raise BadRequestError("A foto passa de 1 MB. Escolha uma menor ou reduza o tamanho dela.")
    ctype = sniff_type(data)
    if not ctype:
        raise BadRequestError("Formato não aceito. Envie uma imagem PNG, JPEG ou WebP.")
    row = ctx.one(
        "INSERT INTO user_photos(user_id, content_type, data) VALUES (%s,%s,%s) "
        "ON CONFLICT (user_id) DO UPDATE SET content_type=EXCLUDED.content_type, "
        "data=EXCLUDED.data, updated_at=now() RETURNING updated_at",
        (ctx.user_id, ctype, data),
    )
    assert row
    return {"photo_version": row["updated_at"]}


def get_my_photo(ctx: Ctx) -> dict | None:
    return ctx.one(
        "SELECT content_type, data, updated_at FROM user_photos WHERE user_id=%s", (ctx.user_id,)
    )


def delete_my_photo(ctx: Ctx) -> None:
    ctx.run("DELETE FROM user_photos WHERE user_id=%s", (ctx.user_id,))


def get_user_photo(ctx: Ctx, user_id: str) -> dict | None:
    """Foto de alguém que divide espaço com quem pede. Pessoa inexistente ou fora de todos os
    espaços de quem pede responde igual (403): não revela se a conta existe."""
    if user_id == ctx.user_id:
        return get_my_photo(ctx)
    if not is_uuid(user_id) or not ctx.one(
        "SELECT 1 AS x FROM workspace_members a JOIN workspace_members b "
        "ON b.workspace_id = a.workspace_id WHERE a.user_id = %s AND b.user_id = %s LIMIT 1",
        (ctx.user_id, user_id),
    ):
        raise ForbiddenError()
    return ctx.one(
        "SELECT content_type, data, updated_at FROM user_photos WHERE user_id=%s", (user_id,)
    )
