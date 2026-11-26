"""Foto de perfil: cada pessoa troca, lê e remove só a própria (sempre a de `ctx.user_id`)."""

from ..db import Ctx
from ..errors import BadRequestError

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
