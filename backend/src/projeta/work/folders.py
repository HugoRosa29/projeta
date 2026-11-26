"""Pastas de projetos: o setor agrupa os próprios projetos por tema.

A pasta é do espaço e só organiza a visão (o panorama mostra um bloco por pasta); não muda quem
vê nem quem edita o projeto. Ler as pastas é de qualquer membro. Criar, renomear, excluir e
pôr projetos nelas exige `project.manage` no espaço dono — organizar o setor é gestão do
setor, então não depende de estar vinculado a cada projeto (mas o projeto precisa estar visível).
Projeto recebido pelo organograma nunca entra em pasta de quem recebeu: a pasta é do dono.
"""

from __future__ import annotations

from ..db import Ctx
from ..errors import BadRequestError, ForbiddenError
from ..identity.access import is_uuid, membership, project_access
from ..identity.policy import assert_can
from .activity import log_activity

NAME_MAX = 60
# Pasta demais vira de novo uma lista longa: o objetivo é agrupar, não dar um bloco por projeto.
MAX_FOLDERS = 30

_SELECT = """SELECT f.id::text AS id, f.name, f.position,
  (SELECT count(*)::int FROM projects p WHERE p.folder_id = f.id AND p.status = 'active')
    AS project_count
  FROM project_folders f"""


def _name(name: str) -> str:
    name = " ".join((name or "").split())
    if not name:
        raise BadRequestError("Dê um nome à pasta.")
    if len(name) > NAME_MAX:
        raise BadRequestError(f"O nome da pasta passa de {NAME_MAX} caracteres. Encurte.")
    return name


def _unique(ctx: Ctx, workspace_id: str, name: str, except_id: str | None = None) -> None:
    if ctx.one(
        "SELECT 1 AS x FROM project_folders WHERE workspace_id = %s AND lower(name) = lower(%s) "
        "AND (%s::uuid IS NULL OR id <> %s::uuid)",
        (workspace_id, name, except_id, except_id),
    ):
        raise BadRequestError(f"Já existe a pasta “{name}” neste espaço. Escolha outro nome.")


def _find(ctx: Ctx, folder_id: str) -> dict:
    """Pasta e permissão de geri-la. Pasta de outro espaço responde igual à inexistente (403)."""
    if not is_uuid(folder_id):
        raise ForbiddenError()
    f = ctx.one(
        "SELECT id::text AS id, workspace_id::text AS workspace_id, name FROM project_folders "
        "WHERE id = %s",
        (folder_id,),
    )
    if not f:
        raise ForbiddenError()
    assert_can(membership(ctx, f["workspace_id"]), "project.manage")
    return f


def list_folders(ctx: Ctx, workspace_id: str) -> dict:
    m = membership(ctx, workspace_id)
    rows = ctx.all(
        f"{_SELECT} WHERE f.workspace_id = %s ORDER BY f.position, lower(f.name)",
        (workspace_id,),
    )
    return {"folders": rows, "can_manage": m.can("project.manage")}


def create_folder(ctx: Ctx, workspace_id: str, name: str) -> dict:
    assert_can(membership(ctx, workspace_id), "project.manage")
    name = _name(name)
    # Trava o espaço: limite e posição contam com as pastas que existem agora.
    ctx.run("SELECT 1 FROM workspaces WHERE id = %s FOR UPDATE", (workspace_id,))
    stats = ctx.one(
        "SELECT count(*)::int AS n, COALESCE(max(position), -1) AS last FROM project_folders "
        "WHERE workspace_id = %s",
        (workspace_id,),
    )
    assert stats
    if stats["n"] >= MAX_FOLDERS:
        raise BadRequestError(
            f"O espaço já tem {MAX_FOLDERS} pastas. Junte ou exclua alguma antes de criar outra."
        )
    _unique(ctx, workspace_id, name)
    row = ctx.one(
        "INSERT INTO project_folders(workspace_id, name, position, created_by) "
        "VALUES (%s, %s, %s, %s) RETURNING id::text AS id",
        (workspace_id, name, stats["last"] + 1, ctx.user_id),
    )
    assert row
    f = ctx.one(f"{_SELECT} WHERE f.id = %s", (row["id"],))
    assert f
    return f


def rename_folder(ctx: Ctx, folder_id: str, name: str) -> dict:
    f = _find(ctx, folder_id)
    name = _name(name)
    _unique(ctx, f["workspace_id"], name, folder_id)
    ctx.run("UPDATE project_folders SET name = %s WHERE id = %s", (name, folder_id))
    out = ctx.one(f"{_SELECT} WHERE f.id = %s", (folder_id,))
    assert out
    return out


def delete_folder(ctx: Ctx, folder_id: str) -> None:
    """Os projetos da pasta voltam para "sem pasta" (ON DELETE SET NULL); nenhum é apagado."""
    _find(ctx, folder_id)
    ctx.run("DELETE FROM project_folders WHERE id = %s", (folder_id,))


def set_project_folder(ctx: Ctx, project_id: str, folder_id: str | None) -> dict:
    """Põe o projeto na pasta (ou tira, com `folder_id` nulo)."""
    a = project_access(ctx, project_id, lock=True)
    # Visível só pelo organograma: `project_access` devolve um leitor, que não tem a ação.
    assert_can(a.member, "project.manage")
    ws = str(a.project["workspace_id"])
    name = None
    if folder_id is not None:
        if not is_uuid(folder_id):
            raise ForbiddenError()
        f = ctx.one(
            "SELECT name FROM project_folders WHERE id = %s AND workspace_id = %s",
            (folder_id, ws),
        )
        # Pasta de outro espaço responde igual à inexistente.
        if not f:
            raise ForbiddenError()
        name = f["name"]
    ctx.run("UPDATE projects SET folder_id = %s WHERE id = %s", (folder_id, project_id))
    if str(a.project.get("folder_id") or "") != str(folder_id or ""):
        log_activity(ctx, ws, "project.folder_set", project_id, data={"folder": name})
    return {"project_id": project_id, "folder_id": folder_id}
