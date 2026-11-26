"""Linhas de base do cronograma: o que foi planejado, para comparar com o que está agora.

A linha de base inicial (número 0) nasce com o projeto e guarda as *primeiras* datas planejadas
de cada tarefa: a tarefa entra nela quando ganha prazo pela primeira vez e não muda depois. Assim
"o plano original" existe mesmo que o cronograma seja montado aos poucos depois da criação.

As seguintes (1, 2, …) são fotografias completas das tarefas com prazo naquele momento, salvas
sob demanda por quem gerencia o projeto (replanejamento aprovado, mudança de escopo etc.).

Ler segue o acesso ao projeto; salvar e excluir exigem gestão do projeto. A inicial não se exclui.
"""

from __future__ import annotations

from ..db import Ctx
from ..errors import BadRequestError, ForbiddenError
from ..identity.access import is_uuid, project_access
from .activity import log_activity

INITIAL_NAME = "Linha de base inicial"
NAME_MAX = 80
NOTE_MAX = 280
# Sem contar a inicial. Evita que o seletor do cronograma vire uma lista sem fim.
MAX_BASELINES = 20

_SUMMARY = """SELECT b.id::text AS id, b.number, b.name, b.note, b.created_at,
       u.name AS created_by_name,
       (SELECT count(*)::int FROM baseline_tasks bt WHERE bt.baseline_id = b.id) AS task_count,
       (SELECT min(COALESCE(bt.start_date, bt.due_date))::text FROM baseline_tasks bt
         WHERE bt.baseline_id = b.id) AS start,
       (SELECT max(bt.due_date)::text FROM baseline_tasks bt WHERE bt.baseline_id = b.id) AS finish
     FROM baselines b LEFT JOIN users u ON u.id = b.created_by"""


def create_initial(ctx: Ctx, project_id: str) -> None:
    """Chamada por quem cria o projeto (tela ou importação), na mesma transação."""
    ctx.run(
        "INSERT INTO baselines(project_id, number, name, created_by) VALUES (%s, 0, %s, %s) "
        "ON CONFLICT (project_id, number) DO NOTHING",
        (project_id, INITIAL_NAME, ctx.user_id),
    )
    capture_first_plan(ctx, project_id)


def capture_first_plan(ctx: Ctx, project_id: str, task_ids: list[str] | None = None) -> None:
    """Grava na inicial as tarefas do projeto que têm prazo e ainda não estão nela.

    Quem já está não é tocado: a inicial é o primeiro plano, não o último. Sem `task_ids`, olha
    o projeto inteiro (usado na criação e na importação).
    """
    ctx.run(
        """INSERT INTO baseline_tasks(baseline_id, task_id, title, phase, is_milestone,
             start_date, due_date)
           SELECT b.id, t.id, t.title, t.phase, t.is_milestone, t.start_date, t.due_date
           FROM tasks t JOIN baselines b ON b.project_id = t.project_id AND b.number = 0
           WHERE t.project_id = %(pid)s AND t.due_date IS NOT NULL
             AND (%(ids)s::uuid[] IS NULL OR t.id = ANY(%(ids)s::uuid[]))
           ON CONFLICT (baseline_id, task_id) DO NOTHING""",
        {"pid": project_id, "ids": task_ids},
    )


def list_baselines(ctx: Ctx, project_id: str) -> dict:
    a = project_access(ctx, project_id)
    rows = ctx.all(f"{_SUMMARY} WHERE b.project_id = %s ORDER BY b.number", (project_id,))
    return {"baselines": rows, "can_manage": a.can_manage}


def get_baseline(ctx: Ctx, project_id: str, baseline_id: str) -> dict:
    project_access(ctx, project_id)
    b = _find(ctx, project_id, baseline_id)
    items = ctx.all(
        "SELECT task_id::text AS task_id, title, phase, is_milestone, start_date::text, "
        "due_date::text FROM baseline_tasks WHERE baseline_id = %s ORDER BY due_date, title",
        (baseline_id,),
    )
    return {**b, "tasks": items}


def create_baseline(ctx: Ctx, project_id: str, name: str = "", note: str = "") -> dict:
    a = project_access(ctx, project_id, lock=True)  # trava: o número é sequencial no projeto
    if not a.can_manage:
        raise ForbiddenError()
    name = " ".join((name or "").split())
    note = (note or "").strip()
    if len(name) > NAME_MAX:
        raise BadRequestError(f"O nome da linha de base passa de {NAME_MAX} caracteres. Encurte.")
    if len(note) > NOTE_MAX:
        raise BadRequestError(f"A observação passa de {NOTE_MAX} caracteres. Encurte o texto.")
    stats = ctx.one(
        "SELECT COALESCE(max(number), 0) AS last, count(*) FILTER (WHERE number > 0)::int AS n "
        "FROM baselines WHERE project_id = %s",
        (project_id,),
    )
    assert stats
    if stats["n"] >= MAX_BASELINES:
        raise BadRequestError(
            f"O projeto já tem {MAX_BASELINES} linhas de base além da inicial. "
            "Exclua uma antiga antes de salvar outra."
        )
    dated = ctx.one(
        "SELECT count(*)::int AS n FROM tasks WHERE project_id = %s AND due_date IS NOT NULL",
        (project_id,),
    )
    if not dated or not dated["n"]:
        raise BadRequestError(
            "Nenhuma tarefa tem prazo ainda. Defina as datas no cronograma antes de salvar "
            "uma linha de base."
        )
    number = stats["last"] + 1
    row = ctx.one(
        "INSERT INTO baselines(project_id, number, name, note, created_by) "
        "VALUES (%s, %s, %s, %s, %s) RETURNING id::text AS id",
        (project_id, number, name or f"Linha de base {number}", note, ctx.user_id),
    )
    assert row
    ctx.run(
        """INSERT INTO baseline_tasks(baseline_id, task_id, title, phase, is_milestone,
             start_date, due_date)
           SELECT %s, id, title, phase, is_milestone, start_date, due_date
           FROM tasks WHERE project_id = %s AND due_date IS NOT NULL""",
        (row["id"], project_id),
    )
    b = _find(ctx, project_id, row["id"])
    log_activity(
        ctx,
        a.project["workspace_id"],
        "baseline.created",
        project_id,
        data={"number": number, "name": b["name"]},
    )
    return b


def delete_baseline(ctx: Ctx, project_id: str, baseline_id: str) -> None:
    a = project_access(ctx, project_id, lock=True)
    if not a.can_manage:
        raise ForbiddenError()
    b = _find(ctx, project_id, baseline_id)
    if b["number"] == 0:
        raise BadRequestError(
            "A linha de base inicial é o plano original do projeto e não pode ser excluída."
        )
    ctx.run("DELETE FROM baselines WHERE id = %s", (baseline_id,))
    log_activity(
        ctx,
        a.project["workspace_id"],
        "baseline.deleted",
        project_id,
        data={"number": b["number"], "name": b["name"]},
    )


def _find(ctx: Ctx, project_id: str, baseline_id: str) -> dict:
    # Linha de base de outro projeto responde igual à inexistente: não revela se o ID existe.
    if not is_uuid(baseline_id):
        raise ForbiddenError()
    b = ctx.one(f"{_SUMMARY} WHERE b.id = %s AND b.project_id = %s", (baseline_id, project_id))
    if not b:
        raise ForbiddenError()
    return b
