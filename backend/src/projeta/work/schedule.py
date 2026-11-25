"""Datas encadeadas: tarefa com dependências começa no dia seguinte ao prazo mais tardio delas.

Quando o prazo de uma tarefa muda, as que dependem dela (direta ou indiretamente) andam junto,
mantendo a duração (início → prazo). Só tarefas do mesmo projeto se ligam, então quem pode
editar a tarefa de origem pode editar as que se movem. Datas são de calendário, sem expediente.
"""

from __future__ import annotations

from datetime import date, timedelta

from ..db import Ctx
from .activity import log_activity


def linked_start(ctx: Ctx, task_id: str) -> str | None:
    """Início imposto pelas dependências; nulo se nenhuma delas tem prazo (início livre)."""
    row = ctx.one(
        "SELECT max(t.due_date) AS d FROM task_dependencies d "
        "JOIN tasks t ON t.id = d.depends_on_id WHERE d.task_id = %s",
        (task_id,),
    )
    return (row["d"] + timedelta(days=1)).isoformat() if row and row["d"] else None


def _shift(start: date | None, due: date | None, new_start: date) -> date | None:
    """Novo prazo para o novo início: preserva a duração; sem início anterior, só evita inverter."""
    if due is None:
        return None
    if start is not None:
        return due + (new_start - start)
    return max(due, new_start)


def cascade(ctx: Ctx, seeds: list[str], *, include_seeds: bool, via: str = "manual") -> None:
    """Recalcula o início das tarefas que dependem de `seeds` (e das próprias, se pedido)."""
    if not seeds:
        return
    rows = ctx.all(
        """WITH RECURSIVE down(id) AS (
             SELECT unnest(%(seeds)s::uuid[])
             UNION SELECT d.task_id FROM task_dependencies d JOIN down ON d.depends_on_id = down.id)
           SELECT t.id::text AS id, t.title, t.workspace_id, t.project_id, t.start_date, t.due_date
           FROM tasks t JOIN down ON down.id = t.id ORDER BY t.id FOR UPDATE OF t""",
        {"seeds": seeds},
    )
    tasks = {r["id"]: r for r in rows}
    edges = ctx.all(
        "SELECT d.task_id::text AS task, d.depends_on_id::text AS dep, t.due_date, t.title "
        "FROM task_dependencies d JOIN tasks t ON t.id = d.depends_on_id "
        "WHERE d.task_id = ANY(%(ids)s::uuid[])",
        {"ids": list(tasks)},
    )
    deps: dict[str, list[dict]] = {}
    for e in edges:
        deps.setdefault(e["task"], []).append(e)

    # Ordem topológica dentro do conjunto afetado (o grafo não tem ciclo: add_dependency recusa).
    pending = {tid: sum(1 for e in deps.get(tid, []) if e["dep"] in tasks) for tid in tasks}
    ready = sorted(tid for tid, n in pending.items() if n == 0)
    order: list[str] = []
    while ready:
        tid = ready.pop()
        order.append(tid)
        for other, es in deps.items():
            if other in tasks and any(e["dep"] == tid for e in es):
                pending[other] -= 1
                if pending[other] == 0:
                    ready.append(other)

    skip = set() if include_seeds else set(seeds)
    for tid in order:
        if tid in skip:
            continue
        t = tasks[tid]
        dues = [
            (tasks[e["dep"]]["due_date"] if e["dep"] in tasks else e["due_date"], e)
            for e in deps.get(tid, [])
        ]
        dated = [(d, e) for d, e in dues if d is not None]
        if not dated:
            continue
        latest, cause = max(dated, key=lambda x: x[0])
        new_start = latest + timedelta(days=1)
        if new_start == t["start_date"]:
            continue
        new_due = _shift(t["start_date"], t["due_date"], new_start)
        ctx.run(
            "UPDATE tasks SET start_date=%s, due_date=%s, version = version + 1, updated_at = now() "
            "WHERE id=%s",
            (new_start, new_due, tid),
        )
        changes = {"start_date": {"from": str(t["start_date"]), "to": str(new_start)}}
        if new_due != t["due_date"]:
            changes["due_date"] = {"from": str(t["due_date"]), "to": str(new_due)}
        log_activity(
            ctx,
            t["workspace_id"],
            "task.rescheduled",
            t["project_id"],
            tid,
            {"title": t["title"], "after": cause["title"], "changes": changes},
            via,
        )
        t["start_date"], t["due_date"] = new_start, new_due
