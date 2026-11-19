from fastapi import APIRouter, Depends

from ...db import uow
from ...work import today as svc
from ..deps import current_user

router = APIRouter(tags=["today"])


@router.get("/today")
def today(workspace_id: str, user: dict = Depends(current_user)) -> dict:
    with uow(user["id"]) as ctx:
        return svc.get_today(ctx, workspace_id, user["timezone"])


@router.get("/agenda")
def agenda(workspace_id: str, start: str, end: str, user: dict = Depends(current_user)) -> dict:
    from ...work import tasks

    with uow(user["id"]) as ctx:
        return {"items": tasks.list_agenda(ctx, workspace_id, start, end)}
