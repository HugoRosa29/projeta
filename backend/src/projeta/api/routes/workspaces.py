from fastapi import APIRouter, Depends

from ...db import uow
from ...identity import workspaces as svc
from ..deps import current_user
from ..schemas import InviteIn, PermissionsIn, PrefsIn, RoleIn, WorkspaceIn, WorkspacePatch

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
