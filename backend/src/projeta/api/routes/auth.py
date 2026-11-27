from fastapi import APIRouter, Cookie, Depends, Request, Response
from starlette.concurrency import run_in_threadpool

from ...db import uow
from ...errors import BadRequestError
from ...identity import auth, photos, workspaces
from ...settings import get_settings
from ..deps import COOKIE, NOBODY, current_user
from ..schemas import AcceptIn, LocalLoginIn, LoginIn, RegisterIn, TimezoneIn

router = APIRouter(tags=["auth"])


def _set_cookie(resp: Response, token: str, expires) -> None:
    resp.set_cookie(
        COOKIE,
        token,
        expires=expires,
        httponly=True,
        secure=get_settings().cookie_secure,
        samesite="lax",
        path="/",
    )


@router.post("/auth/login")
def login(body: LoginIn, request: Request, resp: Response) -> dict:
    station = request.client.host if request.client else ""
    with uow(NOBODY) as ctx:
        user = auth.login(ctx, body.matricula, body.password, station)
        token, expires = auth.create_session(ctx, user["id"])
    _set_cookie(resp, token, expires)
    return {"user": user}


@router.post("/auth/register")
def register(body: RegisterIn, resp: Response) -> dict:
    with uow(NOBODY) as ctx:
        user = auth.register(ctx, body.name, body.email, body.password)
        token, expires = auth.create_session(ctx, user["id"])
    _set_cookie(resp, token, expires)
    return {"user": user}


@router.post("/auth/login-local")
def login_local(body: LocalLoginIn, resp: Response) -> dict:
    with uow(NOBODY) as ctx:
        user = auth.login_local(ctx, body.email, body.password)
        token, expires = auth.create_session(ctx, user["id"])
    _set_cookie(resp, token, expires)
    return {"user": user}


@router.post("/auth/logout", status_code=204)
def logout(resp: Response, projeta_session: str | None = Cookie(default=None)) -> None:
    if projeta_session:
        with uow(NOBODY) as ctx:
            auth.end_session(ctx, projeta_session)
    resp.delete_cookie(COOKIE, path="/")


@router.get("/me")
def me(user: dict = Depends(current_user)) -> dict:
    with uow(user["id"]) as ctx:
        return {"user": user, "workspaces": workspaces.list_my_workspaces(ctx)}


@router.get("/me/profile")
def my_profile(user: dict = Depends(current_user)) -> dict:
    with uow(user["id"]) as ctx:
        return workspaces.my_profile(ctx)


@router.patch("/me/timezone", status_code=204)
def my_timezone(body: TimezoneIn, user: dict = Depends(current_user)) -> None:
    with uow(user["id"]) as ctx:
        workspaces.update_my_timezone(ctx, body.timezone)


@router.put("/me/photo")
async def put_my_photo(request: Request, user: dict = Depends(current_user)) -> dict:
    # Corpo é a imagem crua (sem multipart). Recusa antes de ler tudo quando já declara ser grande.
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > photos.MAX_BYTES + 1024:
        raise BadRequestError("A foto passa de 1 MB. Escolha uma menor ou reduza o tamanho dela.")
    data = await request.body()

    def run() -> dict:
        with uow(user["id"]) as ctx:
            return photos.set_my_photo(ctx, data)

    return await run_in_threadpool(run)


@router.get("/me/photo")
def get_my_photo(user: dict = Depends(current_user)) -> Response:
    with uow(user["id"]) as ctx:
        p = photos.get_my_photo(ctx)
    if not p:
        return Response(status_code=404)
    return Response(
        content=bytes(p["data"]),
        media_type=p["content_type"],
        headers={"Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff"},
    )


@router.get("/users/{user_id}/photo")
def get_user_photo(user_id: str, user: dict = Depends(current_user)) -> Response:
    with uow(user["id"]) as ctx:
        p = photos.get_user_photo(ctx, user_id)
    if not p:
        return Response(status_code=404)
    return Response(
        content=bytes(p["data"]),
        media_type=p["content_type"],
        headers={"Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff"},
    )


@router.delete("/me/photo", status_code=204)
def delete_my_photo(user: dict = Depends(current_user)) -> None:
    with uow(user["id"]) as ctx:
        photos.delete_my_photo(ctx)


@router.post("/invitations/accept")
def accept(body: AcceptIn, user: dict = Depends(current_user)) -> dict:
    with uow(user["id"]) as ctx:
        return workspaces.accept_invitation(ctx, user, body.token)
