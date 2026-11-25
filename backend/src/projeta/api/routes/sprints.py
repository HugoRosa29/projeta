from fastapi import APIRouter, Depends

from ...db import uow
from ...work import sprints as svc
from ...work.today import today_in
from ..deps import current_user
from ..schemas import SprintCloseIn, SprintIn, SprintPatch

router = APIRouter(tags=["sprints"])


@router.get("/projects/{project_id}/sprints")
def list_(project_id: str, user: dict = Depends(current_user)) -> dict:
    with uow(user["id"]) as ctx:
        return svc.list_sprints(ctx, project_id, today_in(user["timezone"]))


@router.post("/projects/{project_id}/sprints", status_code=201)
def create(project_id: str, body: SprintIn, user: dict = Depends(current_user)) -> dict:
    with uow(user["id"]) as ctx:
        return svc.create_sprint(
            ctx, project_id, body.model_dump(exclude_none=True), today_in(user["timezone"])
        )


@router.patch("/sprints/{sprint_id}")
def patch(sprint_id: str, body: SprintPatch, user: dict = Depends(current_user)) -> dict:
    # exclude_unset: capacidade pode ser limpa (null) sem confundir com "não enviado".
    fields = body.model_dump(exclude_unset=True, exclude={"expected_version"})
    with uow(user["id"]) as ctx:
        return svc.update_sprint(ctx, sprint_id, fields, body.expected_version)


@router.delete("/sprints/{sprint_id}", status_code=204)
def delete(sprint_id: str, user: dict = Depends(current_user)) -> None:
    with uow(user["id"]) as ctx:
        svc.delete_sprint(ctx, sprint_id)


@router.post("/sprints/{sprint_id}/start")
def start(sprint_id: str, user: dict = Depends(current_user)) -> dict:
    with uow(user["id"]) as ctx:
        return svc.start_sprint(ctx, sprint_id, today_in(user["timezone"]))


@router.post("/sprints/{sprint_id}/close")
def close(sprint_id: str, body: SprintCloseIn, user: dict = Depends(current_user)) -> dict:
    with uow(user["id"]) as ctx:
        return svc.close_sprint(ctx, sprint_id, body.carry_to, today_in(user["timezone"]))
