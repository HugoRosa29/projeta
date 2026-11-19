from fastapi import APIRouter, Depends

from ...db import uow
from ...work import comments
from ...work import tasks as svc
from ...work.today import today_in
from ..deps import current_user
from ..schemas import CommentIn, DependencyIn, TaskCreate, TaskPatch

router = APIRouter(tags=["tasks"])


@router.get("/projects/{project_id}/tasks")
def project_tasks(
    project_id: str,
    status: str | None = None,
    priority: str | None = None,
    assignee_id: str | None = None,
    q: str | None = None,
    user: dict = Depends(current_user),
) -> dict:
    with uow(user["id"]) as ctx:
        return {"tasks": svc.list_project_tasks(ctx, project_id, status, priority, assignee_id, q)}


@router.get("/tasks/mine")
def my_tasks(
    workspace_id: str,
    status: str | None = None,
    priority: str | None = None,
    due: str | None = None,
    include_done: bool = False,
    user: dict = Depends(current_user),
) -> dict:
    today = today_in(user["timezone"])
    with uow(user["id"]) as ctx:
        rows = svc.list_my_tasks(ctx, workspace_id, today, status, priority, due, include_done)
    return {"tasks": rows, "today": today}


@router.post("/tasks", status_code=201)
def create(body: TaskCreate, user: dict = Depends(current_user)) -> dict:
    fields = body.model_dump(exclude={"workspace_id", "project_id"}, exclude_none=True)
    with uow(user["id"]) as ctx:
        return svc.create_task(ctx, body.workspace_id, body.project_id, fields)


@router.get("/tasks/{task_id}")
def get(task_id: str, user: dict = Depends(current_user)) -> dict:
    with uow(user["id"]) as ctx:
        return svc.get_task(ctx, task_id)


@router.patch("/tasks/{task_id}")
def patch(task_id: str, body: TaskPatch, user: dict = Depends(current_user)) -> dict:
    # exclude_unset: permite limpar campos (ex.: due_date = null) sem confundir com "não enviado"
    fields = body.model_dump(exclude_unset=True, exclude={"expected_version"})
    with uow(user["id"]) as ctx:
        return svc.update_task(ctx, task_id, fields, body.expected_version)


@router.delete("/tasks/{task_id}", status_code=204)
def delete(task_id: str, user: dict = Depends(current_user)) -> None:
    with uow(user["id"]) as ctx:
        svc.delete_task(ctx, task_id)


@router.post("/tasks/{task_id}/dependencies", status_code=204)
def add_dep(task_id: str, body: DependencyIn, user: dict = Depends(current_user)) -> None:
    with uow(user["id"]) as ctx:
        svc.add_dependency(ctx, task_id, body.depends_on_id)


@router.delete("/tasks/{task_id}/dependencies/{depends_on_id}", status_code=204)
def remove_dep(task_id: str, depends_on_id: str, user: dict = Depends(current_user)) -> None:
    with uow(user["id"]) as ctx:
        svc.remove_dependency(ctx, task_id, depends_on_id)


@router.get("/tasks/{task_id}/comments")
def list_comments(task_id: str, user: dict = Depends(current_user)) -> dict:
    with uow(user["id"]) as ctx:
        return {"comments": comments.list_comments(ctx, task_id)}


@router.post("/tasks/{task_id}/comments", status_code=201)
def add_comment(task_id: str, body: CommentIn, user: dict = Depends(current_user)) -> dict:
    with uow(user["id"]) as ctx:
        return comments.add_comment(ctx, task_id, body.body)


@router.patch("/comments/{comment_id}")
def edit_comment(comment_id: str, body: CommentIn, user: dict = Depends(current_user)) -> dict:
    with uow(user["id"]) as ctx:
        return comments.edit_comment(ctx, comment_id, body.body)


@router.delete("/comments/{comment_id}", status_code=204)
def delete_comment(comment_id: str, user: dict = Depends(current_user)) -> None:
    with uow(user["id"]) as ctx:
        comments.delete_comment(ctx, comment_id)
