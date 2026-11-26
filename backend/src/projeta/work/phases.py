"""Fases do projeto: lista ordenada e editável que agrupa as tarefas (migração 029).

A tarefa guarda o *nome* da fase em `tasks.phase`; esta lista dá ordem e permite fase vazia,
renomear e excluir. Os dois andam juntos na mesma transação: renomear a fase renomeia nas
tarefas, excluir deixa as tarefas "sem fase" (nenhuma tarefa é apagada).

Ler segue o acesso ao projeto. Mexer nas fases exige poder editar tarefas do projeto
(`can_write`): quem pode pôr uma tarefa numa fase pode organizar as fases.
"""

from __future__ import annotations

from ..db import Ctx
from ..errors import BadRequestError, ForbiddenError
from ..identity.access import is_uuid, project_access

# Mesmo limite do nome de fase na importação: fase vinda de arquivo nunca fica sem registro.
NAME_MAX = 200
# Fase demais vira de novo uma lista longa: o objetivo é agrupar.
MAX_PHASES = 30

_SELECT = """SELECT f.id::text AS id, f.name, f.position,
  (SELECT count(*)::int FROM tasks t WHERE t.project_id = f.project_id AND t.phase = f.name)
    AS task_count,
  (SELECT count(*)::int FROM tasks t WHERE t.project_id = f.project_id AND t.phase = f.name
     AND t.status = 'done') AS done_count
  FROM project_phases f"""


def clean_name(name: str | None) -> str | None:
    """Espaços repetidos viram um; vazio = sem fase."""
    name = " ".join((name or "").split())
    if len(name) > NAME_MAX:
        raise BadRequestError(f"O nome da fase passa de {NAME_MAX} caracteres. Encurte.")
    return name or None


def _required(name: str) -> str:
    n = clean_name(name)
    if not n:
        raise BadRequestError("Dê um nome à fase.")
    return n


def _writable(ctx: Ctx, project_id: str) -> None:
    a = project_access(ctx, project_id, lock=True)  # trava: limite e posição contam com o agora
    if not a.can_write:
        raise ForbiddenError()


def _find(ctx: Ctx, phase_id: str) -> dict:
    """Fase e permissão de mexer nela. Fase de projeto invisível responde igual à inexistente."""
    if not is_uuid(phase_id):
        raise ForbiddenError()
    f = ctx.one(
        "SELECT id::text AS id, project_id::text AS project_id, name FROM project_phases "
        "WHERE id = %s",
        (phase_id,),
    )
    if not f:
        raise ForbiddenError()
    _writable(ctx, f["project_id"])
    return f


def _taken(ctx: Ctx, project_id: str, name: str, except_id: str | None = None) -> bool:
    return bool(
        ctx.one(
            "SELECT 1 AS x FROM project_phases WHERE project_id = %s AND lower(name) = lower(%s) "
            "AND (%s::uuid IS NULL OR id <> %s::uuid)",
            (project_id, name, except_id, except_id),
        )
    )


def _insert(ctx: Ctx, project_id: str, name: str) -> str:
    stats = ctx.one(
        "SELECT count(*)::int AS n, COALESCE(max(position), -1) AS last FROM project_phases "
        "WHERE project_id = %s",
        (project_id,),
    )
    assert stats
    if stats["n"] >= MAX_PHASES:
        raise BadRequestError(
            f"O projeto já tem {MAX_PHASES} fases. Junte ou exclua alguma antes de criar outra."
        )
    row = ctx.one(
        "INSERT INTO project_phases(project_id, name, position) VALUES (%s, %s, %s) "
        "RETURNING id::text AS id",
        (project_id, name, stats["last"] + 1),
    )
    assert row
    return row["id"]


def _one(ctx: Ctx, phase_id: str) -> dict:
    f = ctx.one(f"{_SELECT} WHERE f.id = %s", (phase_id,))
    assert f
    return f


def list_phases(ctx: Ctx, project_id: str) -> dict:
    a = project_access(ctx, project_id)
    rows = ctx.all(
        f"{_SELECT} WHERE f.project_id = %s ORDER BY f.position, lower(f.name)", (project_id,)
    )
    return {"phases": rows, "can_write": a.can_write}


def create_phase(ctx: Ctx, project_id: str, name: str) -> dict:
    _writable(ctx, project_id)
    name = _required(name)
    if _taken(ctx, project_id, name):
        raise BadRequestError(f"Já existe a fase “{name}” neste projeto. Escolha outro nome.")
    return _one(ctx, _insert(ctx, project_id, name))


def rename_phase(ctx: Ctx, phase_id: str, name: str) -> dict:
    f = _find(ctx, phase_id)
    name = _required(name)
    if _taken(ctx, f["project_id"], name, phase_id):
        raise BadRequestError(f"Já existe a fase “{name}” neste projeto. Escolha outro nome.")
    if name != f["name"]:
        # Versão sobe: quem estava com a tarefa aberta recebe 409 em vez de gravar o nome antigo.
        ctx.run(
            "UPDATE tasks SET phase = %s, version = version + 1, updated_at = now() "
            "WHERE project_id = %s AND phase = %s",
            (name, f["project_id"], f["name"]),
        )
        ctx.run("UPDATE project_phases SET name = %s WHERE id = %s", (name, phase_id))
    return _one(ctx, phase_id)


def delete_phase(ctx: Ctx, phase_id: str) -> None:
    """As tarefas da fase ficam "sem fase"; nenhuma é apagada."""
    f = _find(ctx, phase_id)
    ctx.run(
        "UPDATE tasks SET phase = NULL, version = version + 1, updated_at = now() "
        "WHERE project_id = %s AND phase = %s",
        (f["project_id"], f["name"]),
    )
    ctx.run("DELETE FROM project_phases WHERE id = %s", (phase_id,))


def reorder_phases(ctx: Ctx, project_id: str, ids: list[str]) -> dict:
    """`ids` é a nova ordem completa: todas as fases do projeto, cada uma uma vez."""
    _writable(ctx, project_id)
    current = {
        r["id"]
        for r in ctx.all(
            "SELECT id::text AS id FROM project_phases WHERE project_id = %s", (project_id,)
        )
    }
    if len(ids) != len(set(ids)) or set(ids) != current:
        raise BadRequestError(
            "A ordem enviada não confere com as fases do projeto. Recarregue e tente de novo."
        )
    for i, pid in enumerate(ids):
        ctx.run("UPDATE project_phases SET position = %s WHERE id = %s", (i, pid))
    return list_phases(ctx, project_id)


def resolve(ctx: Ctx, project_id: str, name: str | None) -> str | None:
    """Nome registrado da fase para gravar na tarefa; registra a fase se ainda não existe.

    Assim a EAP do assistente e a criação de tarefa continuam aceitando um nome livre, e a fase
    aparece na lista do projeto. Chamada por quem já validou que pode editar o projeto.
    """
    name = clean_name(name)
    if not name:
        return None
    row = ctx.one(
        "SELECT name FROM project_phases WHERE project_id = %s AND lower(name) = lower(%s)",
        (project_id, name),
    )
    if row:
        return row["name"]
    _insert(ctx, project_id, name)
    return name


def register_from_tasks(ctx: Ctx, project_id: str) -> None:
    """Registra as fases que já estão nas tarefas (importação grava tarefas direto no banco)."""
    for r in ctx.all(
        "SELECT min(phase) AS name FROM tasks WHERE project_id = %s AND phase IS NOT NULL "
        "GROUP BY lower(phase) ORDER BY min(position)",
        (project_id,),
    ):
        canonical = resolve(ctx, project_id, r["name"])
        ctx.run(
            "UPDATE tasks SET phase = %s WHERE project_id = %s AND lower(phase) = lower(%s) "
            "AND phase <> %s",
            (canonical, project_id, r["name"], canonical),
        )
