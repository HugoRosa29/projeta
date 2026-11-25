from fastapi import APIRouter, Depends

from ...db import uow
from ...work import okrs as svc
from ..deps import current_user
from ..schemas import CheckInIn, KeyResultIn, ObjectiveIn, ObjectivePatch

router = APIRouter(tags=["okrs"])


@router.get("/okrs")
def list_(workspace_id: str, period: str | None = None, user: dict = Depends(current_user)) -> dict:
    with uow(user["id"]) as ctx:
        return svc.list_okrs(ctx, workspace_id, user["timezone"], period)


@router.get("/okrs/mine")
def mine(workspace_id: str, user: dict = Depends(current_user)) -> dict:
    with uow(user["id"]) as ctx:
        return svc.my_okrs(ctx, workspace_id, user["timezone"])


@router.post("/objectives", status_code=201)
def create_objective(body: ObjectiveIn, user: dict = Depends(current_user)) -> dict:
    with uow(user["id"]) as ctx:
        return svc.create_objective(
            ctx, body.workspace_id, body.title, body.period, body.description, body.owner_id
        )


@router.patch("/objectives/{objective_id}", status_code=204)
def patch_objective(
    objective_id: str, body: ObjectivePatch, user: dict = Depends(current_user)
) -> None:
    with uow(user["id"]) as ctx:
        svc.update_objective(ctx, objective_id, body.model_dump(exclude_unset=True))


@router.delete("/objectives/{objective_id}", status_code=204)
def delete_objective(objective_id: str, user: dict = Depends(current_user)) -> None:
    with uow(user["id"]) as ctx:
        svc.delete_objective(ctx, objective_id)


@router.post("/objectives/{objective_id}/key-results", status_code=201)
def create_kr(objective_id: str, body: KeyResultIn, user: dict = Depends(current_user)) -> dict:
    with uow(user["id"]) as ctx:
        return svc.create_key_result(ctx, objective_id, body.model_dump(exclude_unset=True))


@router.patch("/key-results/{kr_id}", status_code=204)
def patch_kr(kr_id: str, body: KeyResultIn, user: dict = Depends(current_user)) -> None:
    with uow(user["id"]) as ctx:
        svc.update_key_result(ctx, kr_id, body.model_dump(exclude_unset=True))


@router.delete("/key-results/{kr_id}", status_code=204)
def delete_kr(kr_id: str, user: dict = Depends(current_user)) -> None:
    with uow(user["id"]) as ctx:
        svc.delete_key_result(ctx, kr_id)


@router.get("/key-results/{kr_id}/checkins")
def checkins(kr_id: str, user: dict = Depends(current_user)) -> dict:
    with uow(user["id"]) as ctx:
        return {"checkins": svc.list_checkins(ctx, kr_id)}


@router.post("/key-results/{kr_id}/checkins", status_code=201)
def check_in(kr_id: str, body: CheckInIn, user: dict = Depends(current_user)) -> dict:
    with uow(user["id"]) as ctx:
        return svc.check_in(ctx, kr_id, body.value, body.confidence, body.note, user["timezone"])
