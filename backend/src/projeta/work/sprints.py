"""Sprints do projeto: planejar, iniciar e encerrar (ADR 0006).

Quem gere o projeto (`project.manage`) cria, edita, inicia e encerra sprints. Quem edita tarefas
(`task.write`) coloca e tira tarefas da sprint pelo `tasks.update_task`, que usa `move_tasks`.
Subtarefas acompanham a sprint da tarefa-mãe.

Datas de sprint são datas de calendário; "hoje" chega já calculado no fuso da pessoa.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from psycopg.types.json import Jsonb

from ..db import Ctx
from ..errors import BadRequestError, ConflictError, ForbiddenError
from ..identity.access import ProjectAccess, is_uuid, project_access
from .activity import log_activity

DEFAULT_DAYS = 14
MAX_DAYS = 31  # o guia do Scrum limita a sprint a um mês
MAX_NAME = 80
MAX_GOAL = 500

COLS = """s.id, s.project_id, s.number, s.name, s.goal, s.start_date::text AS start_date,
  s.end_date::text AS end_date, s.status, s.capacity_minutes, s.summary, s.started_at,
  s.closed_at, s.version"""


def _d(v: str) -> date:
    return date.fromisoformat(v)


def _fmt(v: str) -> str:
    return _d(v).strftime("%d/%m")


def _valid_date(v: Any) -> bool:
    try:
        return isinstance(v, str) and date.fromisoformat(v).isoformat() == v
    except ValueError:
        return False


def _validate(fields: dict[str, Any]) -> None:
    if "name" in fields:
        name = (fields["name"] or "").strip()
        if not name:
            raise BadRequestError("Informe o nome da sprint.")
        if len(name) > MAX_NAME:
            raise BadRequestError(f"Nome muito longo (máx. {MAX_NAME} caracteres).")
    if len(fields.get("goal") or "") > MAX_GOAL:
        raise BadRequestError(
            f"Meta muito longa (máx. {MAX_GOAL} caracteres). Resuma em uma frase."
        )
    for k in ("start_date", "end_date"):
        if k in fields and not _valid_date(fields[k]):
            raise BadRequestError("Data inválida (use AAAA-MM-DD).")
    cap = fields.get("capacity_minutes")
    if cap is not None and not (isinstance(cap, int) and 0 <= cap <= 1_000_000):
        raise BadRequestError("Capacidade inválida. Informe as horas disponíveis da equipe.")


def _check_range(ctx: Ctx, project_id: str, start: str, end: str, exclude: str | None) -> None:
    days = (_d(end) - _d(start)).days + 1
    if days < 1:
        raise BadRequestError("O fim da sprint precisa ser no mesmo dia do início ou depois.")
    if days > MAX_DAYS:
        raise BadRequestError(
            f"A sprint tem {days} dias. Use até {MAX_DAYS} dias: sprints curtas dão retorno mais cedo."
        )
    other = ctx.one(
        "SELECT name, start_date::text AS s, end_date::text AS e FROM sprints "
        "WHERE project_id=%s AND id IS DISTINCT FROM %s AND start_date <= %s AND end_date >= %s "
        "ORDER BY start_date LIMIT 1",
        (project_id, exclude, end, start),
    )
    if other:
        raise BadRequestError(
            f"As datas se sobrepõem à {other['name']} ({_fmt(other['s'])} a {_fmt(other['e'])}). "
            "Ajuste o início ou o fim."
        )


def _sprint(ctx: Ctx, sprint_id: str, lock: bool = False) -> tuple[dict, ProjectAccess]:
    """Sprint e acesso ao projeto dela. Sprint inexistente ou de projeto invisível: 403."""
    if not is_uuid(sprint_id):
        raise ForbiddenError()
    row = ctx.one("SELECT project_id FROM sprints WHERE id=%s", (sprint_id,))
    if not row:
        raise ForbiddenError()
    # Trava o projeto: numeração, sobreposição e "uma ativa por vez" ficam serializadas.
    a = project_access(ctx, str(row["project_id"]), lock=lock)
    s = ctx.one(f"SELECT {COLS} FROM sprints s WHERE s.id=%s", (sprint_id,))
    assert s
    return s, a


def _managed(ctx: Ctx, sprint_id: str) -> tuple[dict, ProjectAccess]:
    s, a = _sprint(ctx, sprint_id, lock=True)
    if not a.can_manage:
        raise ForbiddenError()
    return s, a


def _defaults(ctx: Ctx, project_id: str, today: str) -> dict[str, Any]:
    """Próxima sprint na mesma cadência: mesma duração da última, começando no dia seguinte."""
    last = ctx.one(
        "SELECT start_date, end_date FROM sprints WHERE project_id=%s ORDER BY end_date DESC LIMIT 1",
        (project_id,),
    )
    n = ctx.one(
        "SELECT COALESCE(max(number), 0) + 1 AS n FROM sprints WHERE project_id=%s", (project_id,)
    )
    assert n
    days = DEFAULT_DAYS
    start = _d(today)
    if last:
        days = (last["end_date"] - last["start_date"]).days + 1
        start = max(start, last["end_date"] + timedelta(days=1))
    return {"number": n["n"], "start": start, "days": days}


def _insert(ctx: Ctx, a: ProjectAccess, fields: dict[str, Any], today: str) -> dict:
    pid = str(a.project["id"])
    dflt = _defaults(ctx, pid, today)
    start = fields.get("start_date") or dflt["start"].isoformat()
    end = fields.get("end_date") or (_d(start) + timedelta(days=dflt["days"] - 1)).isoformat()
    _check_range(ctx, pid, start, end, None)
    name = (fields.get("name") or "").strip() or f"Sprint {dflt['number']}"
    row = ctx.one(
        "INSERT INTO sprints(project_id, number, name, goal, start_date, end_date, capacity_minutes, "
        "created_by) VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id",
        (
            pid,
            dflt["number"],
            name,
            (fields.get("goal") or "").strip(),
            start,
            end,
            fields.get("capacity_minutes"),
            ctx.user_id,
        ),
    )
    assert row
    log_activity(ctx, a.project["workspace_id"], "sprint.created", pid, data={"title": name})
    s = ctx.one(f"SELECT {COLS} FROM sprints s WHERE s.id=%s", (row["id"],))
    assert s
    return s


def move_tasks(ctx: Ctx, task_ids: list[str], sprint_id: str | None) -> None:
    """Põe as tarefas (e as subtarefas delas) na sprint, ou no backlog com None, registrando a
    entrada e a saída. Não confere permissão: quem chama já conferiu."""
    if not task_ids:
        return
    ids = [
        str(r["id"])
        for r in ctx.all(
            "SELECT id FROM tasks WHERE (id = ANY(%(ids)s::uuid[]) OR parent_id = ANY(%(ids)s::uuid[])) "
            "AND sprint_id IS DISTINCT FROM %(s)s",
            {"ids": task_ids, "s": sprint_id},
        )
    ]
    if not ids:
        return
    ctx.run(
        "UPDATE sprint_task_log SET removed_at = now() "
        "WHERE task_id = ANY(%s::uuid[]) AND removed_at IS NULL",
        (ids,),
    )
    if sprint_id:
        ctx.run(
            "INSERT INTO sprint_task_log(sprint_id, task_id) SELECT %s, unnest(%s::uuid[])",
            (sprint_id, ids),
        )
    ctx.run(
        "UPDATE tasks SET sprint_id = %s, version = version + 1, updated_at = now() "
        "WHERE id = ANY(%s::uuid[])",
        (sprint_id, ids),
    )


def assert_target(ctx: Ctx, project_id: str, sprint_id: str) -> dict:
    """Sprint de destino de uma tarefa: do mesmo projeto e ainda não encerrada."""
    if not is_uuid(sprint_id):
        raise ForbiddenError()
    s = ctx.one(
        "SELECT id, status FROM sprints WHERE id=%s AND project_id=%s", (sprint_id, project_id)
    )
    if not s:
        raise ForbiddenError()  # outro projeto ou inexistente: mesma resposta
    if s["status"] == "closed":
        raise BadRequestError(
            "Essa sprint já foi encerrada. Escolha uma sprint planejada ou em andamento."
        )
    return s


# --- leitura -------------------------------------------------------------------------------


def _calendar(s: dict, today: str) -> dict:
    start, end, t = _d(s["start_date"]), _d(s["end_date"]), _d(today)
    total = (end - start).days + 1
    elapsed = min(max((t - start).days + 1, 0), total)
    return {
        "days_total": total,
        "days_elapsed": elapsed,
        # Hoje conta como decorrido: no último dia, restam 0.
        "days_left": total - elapsed,
        "overdue": s["status"] == "active" and t > end,
    }


def list_sprints(ctx: Ctx, project_id: str, today: str) -> dict:
    """Sprints do projeto com números ao vivo (tarefas, horas e carga por pessoa)."""
    a = project_access(ctx, project_id)
    rows = ctx.all(
        f"SELECT {COLS} FROM sprints s WHERE s.project_id=%s ORDER BY s.start_date, s.number",
        (project_id,),
    )
    totals = {
        str(r["sprint_id"]): r
        for r in ctx.all(
            """SELECT sprint_id, count(*)::int AS tasks,
                 count(*) FILTER (WHERE status = 'done')::int AS done,
                 COALESCE(sum(estimate_minutes), 0)::int AS minutes,
                 COALESCE(sum(estimate_minutes) FILTER (WHERE status = 'done'), 0)::int AS done_minutes,
                 count(*) FILTER (WHERE estimate_minutes IS NULL)::int AS unestimated
               FROM tasks WHERE project_id=%s AND sprint_id IS NOT NULL GROUP BY sprint_id""",
            (project_id,),
        )
    }
    load: dict[str, list[dict]] = {}
    for r in ctx.all(
        """SELECT t.sprint_id, t.assignee_id, u.name, count(*)::int AS tasks,
             COALESCE(sum(t.estimate_minutes) FILTER (WHERE t.status <> 'done'), 0)::int AS open_minutes,
             COALESCE(sum(t.estimate_minutes), 0)::int AS minutes
           FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
           WHERE t.project_id=%s AND t.sprint_id IS NOT NULL
           GROUP BY t.sprint_id, t.assignee_id, u.name ORDER BY minutes DESC, u.name""",
        (project_id,),
    ):
        load.setdefault(str(r["sprint_id"]), []).append(
            {
                "assignee_id": r["assignee_id"],
                "name": r["name"],
                "tasks": r["tasks"],
                "minutes": r["minutes"],
                "open_minutes": r["open_minutes"],
            }
        )
    empty = {"tasks": 0, "done": 0, "minutes": 0, "done_minutes": 0, "unestimated": 0}
    out = []
    for s in rows:
        sid = str(s["id"])
        t = totals.get(sid)
        stats = {k: t[k] for k in empty} if t else dict(empty)
        out.append({**s, **_calendar(s, today), "stats": stats, "load": load.get(sid, [])})
    backlog = ctx.one(
        "SELECT count(*)::int AS n FROM tasks WHERE project_id=%s AND sprint_id IS NULL "
        "AND status <> 'done'",
        (project_id,),
    )
    assert backlog
    return {
        "sprints": out,
        "backlog_open": backlog["n"],
        "today": today,
        "can_manage": a.can_manage,
        "can_write": a.can_write,
    }


# --- escrita -------------------------------------------------------------------------------


def create_sprint(ctx: Ctx, project_id: str, fields: dict[str, Any], today: str) -> dict:
    _validate(fields)
    a = project_access(ctx, project_id, lock=True)
    if not a.can_manage:
        raise ForbiddenError()
    return _insert(ctx, a, fields, today)


def update_sprint(
    ctx: Ctx, sprint_id: str, fields: dict[str, Any], expected_version: int | None = None
) -> dict:
    fields = {
        k: v
        for k, v in fields.items()
        if k in ("name", "goal", "start_date", "end_date", "capacity_minutes")
    }
    if "name" in fields and fields["name"] is None:
        del fields["name"]
    _validate(fields)
    s, a = _managed(ctx, sprint_id)
    if expected_version is not None and expected_version != s["version"]:
        raise ConflictError(
            "A sprint foi alterada por outra pessoa. Recarregue para ver a versão atual.",
            {"current": s},
        )
    if s["status"] == "closed":
        raise BadRequestError("Sprint encerrada não muda: ela guarda o que aconteceu.")
    start = fields.get("start_date") or s["start_date"]
    end = fields.get("end_date") or s["end_date"]
    if s["status"] == "active" and (start, end) != (s["start_date"], s["end_date"]):
        raise BadRequestError(
            "As datas ficam fixas depois do início. Se o plano mudou, encerre a sprint e "
            "planeje a próxima."
        )
    if (start, end) != (s["start_date"], s["end_date"]):
        _check_range(ctx, str(s["project_id"]), start, end, sprint_id)
    sets: dict[str, Any] = {}
    if "name" in fields:
        sets["name"] = fields["name"].strip()
    if "goal" in fields:
        sets["goal"] = (fields["goal"] or "").strip()
    if "capacity_minutes" in fields:
        sets["capacity_minutes"] = fields["capacity_minutes"]
    if start != s["start_date"]:
        sets["start_date"] = start
    if end != s["end_date"]:
        sets["end_date"] = end
    if sets:
        cols = ", ".join(f"{c} = %({c})s" for c in sets)
        ctx.run(
            f"UPDATE sprints SET {cols}, version = version + 1, updated_at = now() WHERE id = %(_id)s",
            {**sets, "_id": sprint_id},
        )
        if s["status"] == "active" and sets.get("goal", s["goal"]) != s["goal"]:
            log_activity(
                ctx,
                a.project["workspace_id"],
                "sprint.goal_changed",
                str(s["project_id"]),
                data={"title": sets.get("name", s["name"]), "from": s["goal"], "to": sets["goal"]},
            )
    after = ctx.one(f"SELECT {COLS} FROM sprints s WHERE s.id=%s", (sprint_id,))
    assert after
    return after


def delete_sprint(ctx: Ctx, sprint_id: str) -> None:
    s, a = _managed(ctx, sprint_id)
    if s["status"] != "planned":
        raise BadRequestError(
            "Só dá para excluir sprint planejada. Sprint iniciada guarda o histórico: encerre-a."
        )
    ids = [str(r["id"]) for r in ctx.all("SELECT id FROM tasks WHERE sprint_id=%s", (sprint_id,))]
    move_tasks(ctx, ids, None)  # voltam ao backlog com versão nova
    ctx.run("DELETE FROM sprints WHERE id=%s", (sprint_id,))
    log_activity(
        ctx,
        a.project["workspace_id"],
        "sprint.deleted",
        str(s["project_id"]),
        data={"title": s["name"]},
    )


def start_sprint(ctx: Ctx, sprint_id: str, today: str) -> dict:
    s, a = _managed(ctx, sprint_id)
    if s["status"] != "planned":
        raise BadRequestError("Esta sprint já foi iniciada.")
    active = ctx.one(
        "SELECT name FROM sprints WHERE project_id=%s AND status='active'", (s["project_id"],)
    )
    if active:
        raise ConflictError(
            f"A {active['name']} ainda está em andamento. Encerre-a antes de iniciar outra."
        )
    if not s["goal"].strip():
        # A meta é o compromisso da sprint (guia do Scrum): sem ela, a sprint é só uma lista.
        raise BadRequestError(
            "Escreva a meta da sprint antes de iniciar: em uma frase, o que ela entrega."
        )
    if _d(today) > _d(s["end_date"]):
        raise BadRequestError(
            "As datas desta sprint já passaram. Ajuste o início e o fim antes de iniciar."
        )
    ctx.run(
        "UPDATE sprints SET status='active', started_at=now(), version=version+1, updated_at=now() "
        "WHERE id=%s",
        (sprint_id,),
    )
    log_activity(
        ctx,
        a.project["workspace_id"],
        "sprint.started",
        str(s["project_id"]),
        data={"title": s["name"]},
    )
    after = ctx.one(f"SELECT {COLS} FROM sprints s WHERE s.id=%s", (sprint_id,))
    assert after
    return after


def _summary(ctx: Ctx, s: dict, started_at: Any) -> dict:
    """O que a sprint comprometeu, o que entrou e saiu no meio e o que foi entregue."""
    rows = ctx.all(
        """SELECT l.task_id, l.added_at, l.removed_at, t.title, t.status, t.estimate_minutes,
             t.sprint_id, t.parent_id
           FROM sprint_task_log l JOIN tasks t ON t.id = l.task_id WHERE l.sprint_id=%s""",
        (s["id"],),
    )
    by_task: dict[str, list[dict]] = {}
    for r in rows:
        by_task.setdefault(str(r["task_id"]), []).append(r)

    def bucket() -> dict[str, int]:
        return {"tasks": 0, "minutes": 0}

    committed, added, done, open_ = bucket(), bucket(), bucket(), bucket()
    removed = 0
    for logs in by_task.values():
        t = logs[0]
        minutes = t["estimate_minutes"] or 0
        was_committed = any(
            r["added_at"] <= started_at
            and (r["removed_at"] is None or r["removed_at"] > started_at)
            for r in logs
        )
        b = committed if was_committed else added
        b["tasks"] += 1
        b["minutes"] += minutes
        if t["sprint_id"] != s["id"]:
            removed += 1
        elif t["status"] == "done":
            done["tasks"] += 1
            done["minutes"] += minutes
        else:
            open_["tasks"] += 1
            open_["minutes"] += minutes
    unestimated = sum(
        1
        for logs in by_task.values()
        if logs[0]["sprint_id"] == s["id"] and logs[0]["estimate_minutes"] is None
    )
    return {
        "goal": s["goal"],
        "planned_end": s["end_date"],
        "committed": committed,
        "added": added,
        "removed": removed,
        "done": done,
        "not_done": open_,
        "unestimated": unestimated,
    }


def close_sprint(ctx: Ctx, sprint_id: str, carry_to: str, today: str) -> dict:
    """Encerra a sprint. O que não terminou vai para a próxima sprint planejada (criada se não
    houver) ou para o backlog; o concluído fica. Nunca acontece sozinho: é o momento da revisão."""
    if carry_to not in ("next", "backlog"):
        raise BadRequestError(
            "Escolha para onde vão as tarefas não concluídas: próxima sprint ou backlog."
        )
    s, a = _managed(ctx, sprint_id)
    if s["status"] != "active":
        raise BadRequestError("Só a sprint em andamento pode ser encerrada.")
    started = ctx.one("SELECT started_at FROM sprints WHERE id=%s", (sprint_id,))
    assert started
    summary = _summary(ctx, s, started["started_at"])
    # Subtarefas seguem a mãe: só as tarefas principais abertas decidem o que sai da sprint.
    open_ids = [
        str(r["id"])
        for r in ctx.all(
            "SELECT id FROM tasks WHERE sprint_id=%s AND parent_id IS NULL AND status <> 'done' "
            "ORDER BY position",
            (sprint_id,),
        )
    ]
    titles = ctx.all(
        "SELECT id, title FROM tasks WHERE id = ANY(%s::uuid[]) ORDER BY position", (open_ids,)
    )
    # Encerrou antes do fim: o fim passa a ser hoje, para a próxima sprint poder começar já.
    end = max(_d(s["start_date"]), min(_d(s["end_date"]), _d(today))).isoformat()
    ctx.run(
        "UPDATE sprints SET status='closed', closed_at=now(), end_date=%s, version=version+1, "
        "updated_at=now() WHERE id=%s",
        (end, sprint_id),
    )
    target: dict | None = None
    if carry_to == "next" and open_ids:
        target = ctx.one(
            f"SELECT {COLS} FROM sprints s WHERE s.project_id=%s AND s.status='planned' "
            "ORDER BY s.start_date LIMIT 1",
            (s["project_id"],),
        ) or _insert(ctx, a, {}, today)
    move_tasks(ctx, open_ids, str(target["id"]) if target else None)
    summary["carried"] = {
        "to": target["name"] if target else None,
        "items": [{"id": str(t["id"]), "title": t["title"]} for t in titles],
    }
    ctx.run("UPDATE sprints SET summary=%s WHERE id=%s", (Jsonb(summary), sprint_id))
    log_activity(
        ctx,
        a.project["workspace_id"],
        "sprint.closed",
        str(s["project_id"]),
        data={"title": s["name"], "done": summary["done"]["tasks"], "carried": len(open_ids)},
    )
    after = ctx.one(f"SELECT {COLS} FROM sprints s WHERE s.id=%s", (sprint_id,))
    assert after
    return {"sprint": after, "next": target}
