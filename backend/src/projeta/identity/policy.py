"""Política central: única fonte de verdade para papel -> ação.

O Gestor (`admin`) pode tudo, sempre. Para os demais perfis, cada espaço guarda em
`workspaces.permissions` quais ações configuráveis o perfil recebe; o Gestor edita essa matriz.
Ações fora da matriz são fixas: ler é de qualquer membro, gerir o espaço é só do Gestor.
"""

from dataclasses import dataclass

from ..errors import ForbiddenError

ROLES: tuple[str, ...] = ("admin", "manager", "member", "viewer")
ROLE_LABEL = {
    "admin": "Gestor",
    "manager": "Gerente de projeto",
    "member": "Membro",
    "viewer": "Leitor",
}
# Perfis cuja matriz o Gestor edita (o próprio Gestor não entra: ele pode tudo).
CONFIGURABLE_ROLES: tuple[str, ...] = ("manager", "member", "viewer")

# Ações configuráveis, na ordem em que a tela mostra. "Nos projetos em que está" importa:
# ver todos os projetos dá só leitura; escrever e gerir exigem vínculo com o projeto.
PERMISSIONS: dict[str, str] = {
    "project.view_all": "Ver todos os projetos do espaço (só leitura nos que não participa)",
    "project.create": "Criar projetos",
    "project.manage": "Gerir os projetos em que está (equipe, dados, arquivar)",
    "task.write": "Criar e editar tarefas nos projetos em que está",
    "comment.write": "Comentar tarefas nos projetos em que está",
    "workspace.invite": "Convidar pessoas para o espaço (até o próprio perfil)",
    "org.view_shared": "Ver projetos compartilhados pelas unidades abaixo no organograma (só leitura)",
}

# Padrão de espaço novo (DEFAULT da coluna, migrações 015 e 016).
DEFAULT_PERMISSIONS: dict[str, list[str]] = {
    "manager": [
        "project.create",
        "project.manage",
        "task.write",
        "comment.write",
        "org.view_shared",
    ],
    "member": ["task.write", "comment.write"],
    "viewer": [],
}

_RANK = {"viewer": 0, "member": 1, "manager": 2, "admin": 3}
_FIXED = {"read": "viewer", "workspace.manage": "admin"}


@dataclass(frozen=True)
class Member:
    """Vínculo de quem age com um espaço: o perfil e as ações que a matriz do espaço concede."""

    role: str
    granted: frozenset[str] = frozenset()

    def can(self, action: str) -> bool:
        if self.role == "admin":
            return True
        if action in _FIXED:
            return _RANK[self.role] >= _RANK[_FIXED[action]]
        if action not in PERMISSIONS:
            raise KeyError(action)  # ação inexistente é bug de código, não falta de permissão
        return action in self.granted

    def outranks_or_equals(self, role: str) -> bool:
        return _RANK[self.role] >= _RANK[role]


def member(role: str, matrix: dict | None) -> Member:
    granted = (matrix or {}).get(role, []) if role != "admin" else PERMISSIONS
    return Member(role, frozenset(granted))


def granted_list(m: Member) -> list[str]:
    """Ações configuráveis que a pessoa tem, na ordem do catálogo (para a interface)."""
    return [p for p in PERMISSIONS if m.can(p)]


def assert_can(m: Member, action: str) -> None:
    if not m.can(action):
        raise ForbiddenError()
