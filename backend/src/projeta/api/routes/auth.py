from fastapi import APIRouter, Cookie, Depends, Request, Response

from ...db import uow
from ...identity import auth, workspaces
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


@router.post("/invitations/accept")
def accept(body: AcceptIn, user: dict = Depends(current_user)) -> dict:
    with uow(user["id"]) as ctx:
        return workspaces.accept_invitation(ctx, user, body.token)
