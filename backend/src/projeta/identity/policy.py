"""Política central: única fonte de verdade para papel -> ação."""

from ..errors import ForbiddenError

ROLES: tuple[str, ...] = ("admin", "manager", "member", "viewer")
ROLE_LABEL = {
    "admin": "Administrador do espaço",
    "manager": "Gerente de projeto",
    "member": "Membro",
    "viewer": "Leitor",
}

_RANK = {"viewer": 0, "member": 1, "manager": 2, "admin": 3}
_MIN = {
    "read": "viewer",
    "task.write": "member",
    "project.create": "manager",
    "project.manage": "manager",
    "workspace.manage": "admin",
}


def can(role: str | None, action: str) -> bool:
    return role is not None and _RANK[role] >= _RANK[_MIN[action]]


def assert_can(role: str | None, action: str) -> None:
    if not can(role, action):
        raise ForbiddenError()
