from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from ...db import uow
from ...errors import BadRequestError
from ...identity import workspaces as svc
from ...work import org, transfer
from ..deps import current_user
from ..schemas import (
    DirectShareIn,
    InviteIn,
    ObjectiveShareIn,
    PermissionsIn,
    PrefsIn,
    RoleIn,
    ShareIn,
    WorkspaceIn,
    WorkspacePatch,
)

router = APIRouter(tags=["workspaces"])


@router.post("/workspaces", status_code=201)
def create(body: WorkspaceIn, user: dict = Depends(current_user)) -> dict:
    with uow(user["id"]) as ctx:
        return svc.create_team_workspace(ctx, body.name, body.timezone)


@router.patch("/workspaces/{workspace_id}", status_code=204)
def patch(workspace_id: str, body: WorkspacePatch, user: dict = Depends(current_user)) -> None:
    with uow(user["id"]) as ctx:
        svc.update_workspace(ctx, workspace_id, body.name, body.timezone)


@router.get("/workspaces/{workspace_id}/permissions")
def permissions(workspace_id: str, user: dict = Depends(current_user)) -> dict:
    with uow(user["id"]) as ctx:
        return svc.get_permissions(ctx, workspace_id)


@router.put("/workspaces/{workspace_id}/permissions")
def set_permissions(
    workspace_id: str, body: PermissionsIn, user: dict = Depends(current_user)
) -> dict:
    with uow(user["id"]) as ctx:
        return svc.set_permissions(ctx, workspace_id, body.permissions)


@router.get("/workspaces/{workspace_id}/members")
def members(workspace_id: str, user: dict = Depends(current_user)) -> dict:
    with uow(user["id"]) as ctx:
        return {"members": svc.list_members(ctx, workspace_id)}


@router.patch("/workspaces/{workspace_id}/members/{member_id}", status_code=204)
def set_role(
    workspace_id: str, member_id: str, body: RoleIn, user: dict = Depends(current_user)
) -> None:
    with uow(user["id"]) as ctx:
        svc.set_member_role(ctx, workspace_id, member_id, body.role)


@router.delete("/workspaces/{workspace_id}/members/{member_id}", status_code=204)
def remove(workspace_id: str, member_id: str, user: dict = Depends(current_user)) -> None:
    with uow(user["id"]) as ctx:
        svc.remove_member(ctx, workspace_id, member_id)


@router.get("/workspaces/{workspace_id}/invitations")
def invitations(workspace_id: str, user: dict = Depends(current_user)) -> dict:
    with uow(user["id"]) as ctx:
        return {"invitations": svc.list_invitations(ctx, workspace_id)}


@router.post("/workspaces/{workspace_id}/invitations", status_code=201)
def invite(workspace_id: str, body: InviteIn, user: dict = Depends(current_user)) -> dict:
    with uow(user["id"]) as ctx:
        return svc.create_invitation(ctx, workspace_id, body.email, body.role)


@router.delete("/workspaces/{workspace_id}/invitations/{invitation_id}", status_code=204)
def revoke(workspace_id: str, invitation_id: str, user: dict = Depends(current_user)) -> None:
    with uow(user["id"]) as ctx:
        svc.revoke_invitation(ctx, workspace_id, invitation_id)


@router.patch("/workspaces/{workspace_id}/me", status_code=204)
def prefs(workspace_id: str, body: PrefsIn, user: dict = Depends(current_user)) -> None:
    with uow(user["id"]) as ctx:
        svc.update_my_prefs(ctx, workspace_id, body.notify_email, body.notify_inapp)


@router.get("/workspaces/{workspace_id}/export")
def export(workspace_id: str, user: dict = Depends(current_user)) -> JSONResponse:
    with uow(user["id"]) as ctx:
        data = transfer.export_workspace(ctx, workspace_id)
    # Nome do arquivo sem o nome do espaço: cabeçalho só aceita ASCII e o nome é dado do usuário.
    return JSONResponse(
        data,
        headers={
            "Content-Disposition": 'attachment; filename="projeta-espaco.json"',
            "Cache-Control": "no-store",
        },
    )


@router.post("/workspaces/import", status_code=201)
async def import_(
    request: Request,
    workspace_id: str | None = None,
    name: str | None = None,
    user: dict = Depends(current_user),
) -> dict:
    # Corpo é o arquivo de exportação cru. Recusa antes de ler tudo quando já declara ser grande.
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > transfer.MAX_FILE_BYTES:
        raise BadRequestError("O arquivo passa de 64 MB. Exporte o espaço sem capas grandes.")
    raw = await request.body()

    def run() -> dict:
        with uow(user["id"]) as ctx:
            return transfer.import_workspace(ctx, raw, workspace_id or None, name)

    return await run_in_threadpool(run)


@router.get("/workspaces/{workspace_id}/org")
def org_view(workspace_id: str, user: dict = Depends(current_user)) -> dict:
    with uow(user["id"]) as ctx:
        return org.org_view(ctx, workspace_id)


@router.post("/workspaces/{workspace_id}/org/shares", status_code=204)
def share(workspace_id: str, body: ShareIn, user: dict = Depends(current_user)) -> None:
    with uow(user["id"]) as ctx:
        org.share_up(ctx, workspace_id, body.project_id)


@router.delete("/workspaces/{workspace_id}/org/shares/{project_id}", status_code=204)
def unshare(workspace_id: str, project_id: str, user: dict = Depends(current_user)) -> None:
    with uow(user["id"]) as ctx:
        org.unshare_up(ctx, workspace_id, project_id)


@router.post("/workspaces/{workspace_id}/org/direct-shares", status_code=204)
def share_direct(
    workspace_id: str, body: DirectShareIn, user: dict = Depends(current_user)
) -> None:
    with uow(user["id"]) as ctx:
        org.share_direct(ctx, workspace_id, body.project_id, body.unit)


@router.delete("/workspaces/{workspace_id}/org/direct-shares/{project_id}/{unit}", status_code=204)
def unshare_direct(
    workspace_id: str, project_id: str, unit: str, user: dict = Depends(current_user)
) -> None:
    with uow(user["id"]) as ctx:
        org.unshare_direct(ctx, workspace_id, project_id, unit)


@router.post("/workspaces/{workspace_id}/org/objective-shares", status_code=204)
def share_objective(
    workspace_id: str, body: ObjectiveShareIn, user: dict = Depends(current_user)
) -> None:
    with uow(user["id"]) as ctx:
        org.share_objective_up(ctx, workspace_id, body.objective_id)


@router.delete("/workspaces/{workspace_id}/org/objective-shares/{objective_id}", status_code=204)
def unshare_objective(
    workspace_id: str, objective_id: str, user: dict = Depends(current_user)
) -> None:
    with uow(user["id"]) as ctx:
        org.unshare_objective_up(ctx, workspace_id, objective_id)


@router.post("/workspaces/{workspace_id}/org/share-all")
def share_all(workspace_id: str, user: dict = Depends(current_user)) -> dict:
    with uow(user["id"]) as ctx:
        return {"shared": org.share_all_up(ctx, workspace_id)}
