from fastapi import APIRouter, Depends, Request, Response
from starlette.concurrency import run_in_threadpool

from ...db import uow
from ...errors import BadRequestError
from ...work import baselines, covers, folders, formal, invites, phases
from ...work import projects as svc
from ..deps import current_user
from ..schemas import (
    AttributeIn,
    BaselineIn,
    FolderIn,
    InviteMatriculaIn,
    MemberIn,
    PhaseIn,
    PhaseOrderIn,
    ProjectFolderIn,
    ProjectIn,
    ProjectPatch,
    ProjectRolesIn,
    StatusNoteIn,
    TermIn,
)

router = APIRouter(tags=["projects"])


def _attrs(items: list[AttributeIn] | None) -> list[dict] | None:
    return None if items is None else [i.model_dump() for i in items]


@router.get("/projects")
def list_(
    workspace_id: str, include_archived: bool = False, user: dict = Depends(current_user)
) -> dict:
    with uow(user["id"]) as ctx:
        return {"projects": svc.list_projects(ctx, workspace_id, include_archived)}


@router.post("/projects", status_code=201)
def create(body: ProjectIn, user: dict = Depends(current_user)) -> dict:
    with uow(user["id"]) as ctx:
        return svc.create_project(
            ctx,
            body.workspace_id,
            body.name,
            body.description,
            body.summary,
            body.responsible,
            body.requester,
            body.external_ref,
            _attrs(body.attributes),
        )


@router.get("/projects/{project_id}")
def get(project_id: str, user: dict = Depends(current_user)) -> dict:
    with uow(user["id"]) as ctx:
        return svc.get_project(ctx, project_id)


@router.patch("/projects/{project_id}")
def patch(project_id: str, body: ProjectPatch, user: dict = Depends(current_user)) -> dict:
    with uow(user["id"]) as ctx:
        return svc.update_project(
            ctx,
            project_id,
            body.name,
            body.description,
            body.status,
            body.phase,
            body.approach,
            body.sei_process,
            body.summary,
            body.responsible,
            body.requester,
            body.external_ref,
            _attrs(body.attributes),
            body.progress,
            "progress" in body.model_fields_set and body.progress is None,
        )


@router.get("/projects/{project_id}/baselines")
def list_baselines(project_id: str, user: dict = Depends(current_user)) -> dict:
    with uow(user["id"]) as ctx:
        return baselines.list_baselines(ctx, project_id)


@router.post("/projects/{project_id}/baselines", status_code=201)
def create_baseline(project_id: str, body: BaselineIn, user: dict = Depends(current_user)) -> dict:
    with uow(user["id"]) as ctx:
        return baselines.create_baseline(ctx, project_id, body.name, body.note)


@router.get("/projects/{project_id}/baselines/{baseline_id}")
def get_baseline(project_id: str, baseline_id: str, user: dict = Depends(current_user)) -> dict:
    with uow(user["id"]) as ctx:
        return baselines.get_baseline(ctx, project_id, baseline_id)


@router.delete("/projects/{project_id}/baselines/{baseline_id}", status_code=204)
def delete_baseline(project_id: str, baseline_id: str, user: dict = Depends(current_user)) -> None:
    with uow(user["id"]) as ctx:
        baselines.delete_baseline(ctx, project_id, baseline_id)


@router.put("/projects/{project_id}/cover")
async def put_cover(project_id: str, request: Request, user: dict = Depends(current_user)) -> dict:
    # Corpo é a imagem crua (sem multipart). Recusa antes de ler tudo quando já declara ser grande.
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > covers.MAX_BYTES + 1024:
        raise BadRequestError("A imagem passa de 3 MB. Escolha uma menor ou reduza o tamanho dela.")
    data = await request.body()

    def run() -> dict:
        with uow(user["id"]) as ctx:
            return covers.set_cover(ctx, project_id, data)

    return await run_in_threadpool(run)


@router.get("/projects/{project_id}/cover")
def get_cover(project_id: str, user: dict = Depends(current_user)) -> Response:
    with uow(user["id"]) as ctx:
        c = covers.get_cover(ctx, project_id)
    if not c:
        return Response(status_code=404)
    return Response(
        content=bytes(c["data"]),
        media_type=c["content_type"],
        headers={"Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff"},
    )


@router.delete("/projects/{project_id}/cover", status_code=204)
def delete_cover(project_id: str, user: dict = Depends(current_user)) -> None:
    with uow(user["id"]) as ctx:
        covers.delete_cover(ctx, project_id)


@router.post("/projects/{project_id}/members", status_code=204)
def add_member(project_id: str, body: MemberIn, user: dict = Depends(current_user)) -> None:
    with uow(user["id"]) as ctx:
        svc.add_project_member(ctx, project_id, body.user_id)


@router.delete("/projects/{project_id}/members/{member_id}", status_code=204)
def remove_member(project_id: str, member_id: str, user: dict = Depends(current_user)) -> None:
    with uow(user["id"]) as ctx:
        svc.remove_project_member(ctx, project_id, member_id)


@router.post("/projects/{project_id}/invites", status_code=202)
def invite(project_id: str, body: InviteMatriculaIn, user: dict = Depends(current_user)) -> dict:
    with uow(user["id"]) as ctx:
        return invites.invite_by_matricula(ctx, project_id, body.matricula)


@router.get("/projects/{project_id}/invites")
def pending_invites(project_id: str, user: dict = Depends(current_user)) -> dict:
    with uow(user["id"]) as ctx:
        return {"invites": invites.list_pending(ctx, project_id)}


@router.delete("/projects/{project_id}/invites/{matricula}", status_code=204)
def revoke_invite(project_id: str, matricula: str, user: dict = Depends(current_user)) -> None:
    with uow(user["id"]) as ctx:
        invites.revoke(ctx, project_id, matricula)


@router.get("/formal/reference")
def formal_reference(_: dict = Depends(current_user)) -> dict:
    return formal.reference()


@router.put("/projects/{project_id}/members/{member_id}/roles")
def set_roles(
    project_id: str, member_id: str, body: ProjectRolesIn, user: dict = Depends(current_user)
) -> dict:
    with uow(user["id"]) as ctx:
        return {"roles": formal.set_member_roles(ctx, project_id, member_id, body.roles)}


@router.get("/projects/{project_id}/status-notes")
def status_notes(project_id: str, user: dict = Depends(current_user)) -> dict:
    with uow(user["id"]) as ctx:
        return {"notes": formal.list_status_notes(ctx, project_id)}


@router.get("/projects/{project_id}/status-notes/draft")
def status_note_draft(project_id: str, user: dict = Depends(current_user)) -> dict:
    with uow(user["id"]) as ctx:
        return formal.draft_status_note(ctx, project_id)


@router.post("/projects/{project_id}/status-notes", status_code=201)
def add_status_note(
    project_id: str, body: StatusNoteIn, user: dict = Depends(current_user)
) -> dict:
    with uow(user["id"]) as ctx:
        return formal.add_status_note(
            ctx, project_id, body.state, body.delay_reason, body.done, body.pending, body.blockers
        )


@router.get("/projects/{project_id}/terms/tep/draft")
def tep_draft(project_id: str, user: dict = Depends(current_user)) -> dict:
    with uow(user["id"]) as ctx:
        return formal.draft_tep(ctx, project_id)


@router.get("/projects/{project_id}/terms/{kind}")
def get_term(project_id: str, kind: str, user: dict = Depends(current_user)) -> dict:
    with uow(user["id"]) as ctx:
        return formal.get_term(ctx, project_id, kind)


@router.put("/projects/{project_id}/terms/{kind}")
def save_term(project_id: str, kind: str, body: TermIn, user: dict = Depends(current_user)) -> dict:
    with uow(user["id"]) as ctx:
        return formal.save_term(ctx, project_id, kind, body.content, body.expected_version)


@router.get("/portfolio")
def portfolio(workspace_id: str, user: dict = Depends(current_user)) -> dict:
    with uow(user["id"]) as ctx:
        return {"projects": formal.portfolio(ctx, workspace_id)}


@router.get("/workspaces/{workspace_id}/folders")
def list_folders(workspace_id: str, user: dict = Depends(current_user)) -> dict:
    with uow(user["id"]) as ctx:
        return folders.list_folders(ctx, workspace_id)


@router.post("/workspaces/{workspace_id}/folders", status_code=201)
def create_folder(workspace_id: str, body: FolderIn, user: dict = Depends(current_user)) -> dict:
    with uow(user["id"]) as ctx:
        return folders.create_folder(ctx, workspace_id, body.name)


@router.patch("/folders/{folder_id}")
def rename_folder(folder_id: str, body: FolderIn, user: dict = Depends(current_user)) -> dict:
    with uow(user["id"]) as ctx:
        return folders.rename_folder(ctx, folder_id, body.name)


@router.delete("/folders/{folder_id}", status_code=204)
def delete_folder(folder_id: str, user: dict = Depends(current_user)) -> None:
    with uow(user["id"]) as ctx:
        folders.delete_folder(ctx, folder_id)


@router.put("/projects/{project_id}/folder")
def set_project_folder(
    project_id: str, body: ProjectFolderIn, user: dict = Depends(current_user)
) -> dict:
    with uow(user["id"]) as ctx:
        return folders.set_project_folder(ctx, project_id, body.folder_id)


@router.get("/projects/{project_id}/phases")
def list_phases(project_id: str, user: dict = Depends(current_user)) -> dict:
    with uow(user["id"]) as ctx:
        return phases.list_phases(ctx, project_id)


@router.post("/projects/{project_id}/phases", status_code=201)
def create_phase(project_id: str, body: PhaseIn, user: dict = Depends(current_user)) -> dict:
    with uow(user["id"]) as ctx:
        return phases.create_phase(ctx, project_id, body.name)


@router.put("/projects/{project_id}/phases/order")
def reorder_phases(project_id: str, body: PhaseOrderIn, user: dict = Depends(current_user)) -> dict:
    with uow(user["id"]) as ctx:
        return phases.reorder_phases(ctx, project_id, body.ids)


@router.patch("/phases/{phase_id}")
def rename_phase(phase_id: str, body: PhaseIn, user: dict = Depends(current_user)) -> dict:
    with uow(user["id"]) as ctx:
        return phases.rename_phase(ctx, phase_id, body.name)


@router.delete("/phases/{phase_id}", status_code=204)
def delete_phase(phase_id: str, user: dict = Depends(current_user)) -> None:
    with uow(user["id"]) as ctx:
        phases.delete_phase(ctx, phase_id)
