from fastapi import APIRouter, Depends

from ...db import uow
from ...work import risks as svc
from ..deps import current_user
from ..schemas import RiskIn, RiskPatch

router = APIRouter(tags=["risks"])

_META = {"version", "reviewed"}


@router.get("/projects/{project_id}/risks")
def list_(project_id: str, user: dict = Depends(current_user)) -> dict:
    with uow(user["id"]) as ctx:
        return svc.list_risks(ctx, project_id)


@router.post("/projects/{project_id}/risks", status_code=201)
def create(project_id: str, body: RiskIn, user: dict = Depends(current_user)) -> dict:
    with uow(user["id"]) as ctx:
        return svc.create_risk(ctx, project_id, body.model_dump(exclude_unset=True, exclude=_META))


@router.patch("/projects/{project_id}/risks/{risk_id}")
def patch(
    project_id: str, risk_id: str, body: RiskPatch, user: dict = Depends(current_user)
) -> dict:
    with uow(user["id"]) as ctx:
        return svc.update_risk(
            ctx,
            project_id,
            risk_id,
            body.model_dump(exclude_unset=True, exclude=_META),
            body.version,
            body.reviewed,
        )


@router.delete("/projects/{project_id}/risks/{risk_id}", status_code=204)
def delete(project_id: str, risk_id: str, user: dict = Depends(current_user)) -> None:
    with uow(user["id"]) as ctx:
        svc.delete_risk(ctx, project_id, risk_id)
