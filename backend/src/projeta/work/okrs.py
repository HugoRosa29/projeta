"""OKRs do espaço: objetivos por trimestre, resultados-chave (KRs) com dono e check-ins.

Quem cria e edita objetivos e KRs precisa de `okr.manage`. O check-in (novo valor, confiança e
nota) é do dono do KR, que não precisa de permissão extra: ser dono é a delegação. Quem tem
`okr.manage` também pode registrar no lugar do dono. Qualquer membro do espaço lê.

O progresso é calculado na leitura, nunca guardado no KR: mudar a meta recalcula tudo. O check-in
guarda o progresso daquele momento, para o histórico não mudar quando a meta mudar.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from ..db import Ctx
from ..errors import BadRequestError, ForbiddenError
from ..identity.access import VISIBLE_PROJECT, is_uuid, membership, project_access
from ..identity.policy import Member, assert_can

CONFIDENCE = ("on_track", "at_risk", "off_track")
KINDS = ("number", "project")
# Sem check-in há mais que isso, o KR aparece como "pedindo atualização".
STALE_DAYS = 7
# Mesmo critério da esteira dos projetos: tempo decorrido passa o progresso em mais de 25 pontos.
PACE_GAP = 25
TITLE_MAX = 200
NOTE_MAX = 2000
UNIT_MAX = 20
# Teto de sanidade para o custo (R$): pega erro de digitação, como um valor colado duas vezes.
COST_MAX = 10**11


# ---------- período ----------


def quarter_of(d: date) -> str:
    return f"{d.year}-T{(d.month - 1) // 3 + 1}"


def quarter_bounds(period: str) -> tuple[date, date]:
    year, q = int(period[:4]), int(period[-1])
    start = date(year, 3 * (q - 1) + 1, 1)
    nxt = date(year + 1, 1, 1) if q == 4 else date(year, 3 * q + 1, 1)
    return start, nxt - timedelta(days=1)


def _check_period(period: str) -> str:
    period = (period or "").strip().upper()
    if (
        len(period) != 7
        or period[4:6] != "-T"
        or not period[:4].isdigit()
        or period[6] not in "1234"
    ):
        raise BadRequestError("Período inválido. Use o trimestre no formato AAAA-Tn, ex.: 2026-T4.")
    return period


def _today(timezone: str, now: datetime | None = None) -> date:
    return (now or datetime.now(UTC)).astimezone(ZoneInfo(timezone)).date()


def elapsed_pct(period: str, today: date) -> int | None:
    """Quanto do trimestre já passou (0-100); nulo fora dele (trimestre passado ou futuro)."""
    start, end = quarter_bounds(period)
    if not start <= today <= end:
        return None
    return round(100 * ((today - start).days + 1) / ((end - start).days + 1))


# ---------- cálculo ----------


def progress_of(kind: str, start: float, target: float, current: float, project: int | None) -> int:
    """0-100. Meta abaixo do ponto de partida (ex.: reduzir prazo médio) funciona igual."""
    if kind == "project" and project is not None:
        return max(0, min(100, int(project)))
    if target == start:
        return 100 if current >= target else 0
    return max(0, min(100, round(100 * (current - start) / (target - start))))


def _num(v: Decimal | float | int | None) -> float | None:
    if v is None:
        return None
    f = float(v)
    return int(f) if f.is_integer() else f


_KR_SELECT = f"""SELECT k.id, k.objective_id, k.title, k.owner_id, ou.name AS owner_name, k.kind,
  k.start_value, k.target_value, k.current_value, k.unit, k.confidence, k.last_checkin_at,
  k.position, k.created_at, k.project_id, k.cost,
  CASE WHEN {VISIBLE_PROJECT} THEN p.name END AS project_name,
  COALESCE(p.progress, (SELECT CASE WHEN count(*) > 0 THEN
      round(100.0 * count(*) FILTER (WHERE t.status = 'done') / count(*))::int END
    FROM tasks t WHERE t.project_id = p.id)) AS project_progress,
  o.workspace_id, o.period
FROM key_results k JOIN objectives o ON o.id = k.objective_id
LEFT JOIN users ou ON ou.id = k.owner_id
LEFT JOIN projects p ON p.id = k.project_id"""


def _shape_kr(ctx: Ctx, r: dict, m: Member, pace: int | None, now: datetime) -> dict:
    start, target, current = (_num(r[k]) for k in ("start_value", "target_value", "current_value"))
    pct = progress_of(r["kind"], start or 0, target or 0, current or 0, r["project_progress"])
    last = r["last_checkin_at"]
    visible = r["project_name"] is not None
    return {
        "id": r["id"],
        "objective_id": r["objective_id"],
        "title": r["title"],
        "owner_id": r["owner_id"],
        "owner_name": r["owner_name"],
        "kind": r["kind"],
        "start_value": start,
        "target_value": target,
        "current_value": current,
        "unit": r["unit"],
        # Nulo = não informado; 0 = equipe interna, sem custo externo.
        "cost": _num(r["cost"]),
        # Projeto que a pessoa não enxerga: o KR mostra o progresso, mas não o nome nem o link.
        "project_id": r["project_id"] if visible else None,
        "project_name": r["project_name"],
        "confidence": r["confidence"],
        "last_checkin_at": last,
        "progress": pct,
        "stale": last is None or now - last > timedelta(days=STALE_DAYS),
        "behind_pace": pace is not None and pct < 100 and pace - pct > PACE_GAP,
        "mine": r["owner_id"] == ctx.user_id,
        "can_checkin": r["owner_id"] == ctx.user_id or m.can("okr.manage"),
    }


def _worst(confidences: list[str]) -> str | None:
    return max(confidences, key=CONFIDENCE.index) if confidences else None


# ---------- leitura ----------


def list_okrs(
    ctx: Ctx,
    workspace_id: str,
    timezone: str,
    period: str | None = None,
    now: datetime | None = None,
) -> dict:
    """Objetivos do trimestre com KRs, progresso e o resumo do painel de quem gere."""
    m = membership(ctx, workspace_id)
    now = now or datetime.now(UTC)
    today = _today(timezone, now)
    period = _check_period(period) if period else quarter_of(today)
    pace = elapsed_pct(period, today)
    objectives = ctx.all(
        "SELECT o.id, o.title, o.description, o.owner_id, u.name AS owner_name, o.period "
        "FROM objectives o LEFT JOIN users u ON u.id = o.owner_id "
        "WHERE o.workspace_id = %s AND o.period = %s ORDER BY o.position, o.created_at",
        (workspace_id, period),
    )
    krs = [
        _shape_kr(ctx, r, m, pace, now)
        for r in ctx.all(
            f"{_KR_SELECT} WHERE o.workspace_id = %(ws)s AND o.period = %(period)s "
            "ORDER BY k.position, k.created_at",
            {"ws": workspace_id, "period": period, "uid": ctx.user_id},
        )
    ]
    by_obj: dict[str, list[dict]] = {}
    for k in krs:
        by_obj.setdefault(k["objective_id"], []).append(k)
    for o in objectives:
        items = by_obj.get(o["id"], [])
        o["key_results"] = items
        o["progress"] = round(sum(k["progress"] for k in items) / len(items)) if items else 0
        o["confidence"] = _worst([k["confidence"] for k in items])
    periods = {
        r["period"]
        for r in ctx.all(
            "SELECT DISTINCT period FROM objectives WHERE workspace_id = %s", (workspace_id,)
        )
    } | {period, quarter_of(today)}
    week_ago = now - timedelta(days=STALE_DAYS)
    return {
        "period": period,
        "periods": sorted(periods, reverse=True),
        "pace": pace,
        "can_manage": m.can("okr.manage"),
        "objectives": objectives,
        "summary": {
            "objectives": len(objectives),
            "key_results": len(krs),
            "progress": round(sum(o["progress"] for o in objectives) / len(objectives))
            if objectives
            else 0,
            "confidence": {c: sum(1 for k in krs if k["confidence"] == c) for c in CONFIDENCE},
            "stale": sum(1 for k in krs if k["stale"]),
            "behind_pace": sum(1 for k in krs if k["behind_pace"]),
            "updated_this_week": sum(
                1 for k in krs if k["last_checkin_at"] and k["last_checkin_at"] >= week_ago
            ),
            "without_owner": sum(1 for k in krs if not k["owner_id"]),
            "cost": sum(k["cost"] or 0 for k in krs),
        },
    }


def _week(d: date) -> date:
    return d - timedelta(days=d.weekday())


def streak_weeks(days: list[date], today: date) -> int:
    """Semanas seguidas com check-in, contando até esta semana (ou a anterior, se esta ainda não teve)."""
    weeks = {_week(d) for d in days}
    cur = _week(today)
    if cur not in weeks:
        cur -= timedelta(days=7)
    n = 0
    while cur in weeks:
        n += 1
        cur -= timedelta(days=7)
    return n


def my_okrs(ctx: Ctx, workspace_id: str, timezone: str, now: datetime | None = None) -> dict:
    """O que cabe a mim no trimestre atual: meus KRs, o que pede check-in e a minha sequência."""
    m = membership(ctx, workspace_id)
    now = now or datetime.now(UTC)
    today = _today(timezone, now)
    period = quarter_of(today)
    pace = elapsed_pct(period, today)
    krs = [
        _shape_kr(ctx, r, m, pace, now)
        for r in ctx.all(
            f"{_KR_SELECT} WHERE o.workspace_id = %(ws)s AND o.period = %(period)s "
            "AND k.owner_id = %(uid)s ORDER BY k.last_checkin_at NULLS FIRST, k.position",
            {"ws": workspace_id, "period": period, "uid": ctx.user_id},
        )
    ]
    titles = {
        r["id"]: r["title"]
        for r in ctx.all(
            "SELECT id, title FROM objectives WHERE id = ANY(%s::uuid[])",
            ([k["objective_id"] for k in krs],),
        )
    }
    for k in krs:
        k["objective_title"] = titles.get(k["objective_id"], "")
    tz = ZoneInfo(timezone)
    days = [
        r["created_at"].astimezone(tz).date()
        for r in ctx.all(
            "SELECT c.created_at FROM okr_checkins c JOIN key_results k ON k.id = c.key_result_id "
            "JOIN objectives o ON o.id = k.objective_id "
            "WHERE o.workspace_id = %s AND c.author_id = %s AND c.created_at >= %s",
            (workspace_id, ctx.user_id, now - timedelta(days=7 * 53)),
        )
    ]
    this_week = _week(today)
    return {
        "period": period,
        "pace": pace,
        "key_results": krs,
        "pending": sum(1 for k in krs if k["stale"]),
        "streak_weeks": streak_weeks(days, today),
        "checkins_this_week": sum(1 for d in days if _week(d) == this_week),
    }


def list_checkins(ctx: Ctx, kr_id: str) -> list[dict]:
    kr, _ = _kr_and_member(ctx, kr_id)
    rows = ctx.all(
        "SELECT c.id, c.value, c.progress, c.confidence, c.note, c.created_at, c.author_id, "
        "u.name AS author_name FROM okr_checkins c LEFT JOIN users u ON u.id = c.author_id "
        "WHERE c.key_result_id = %s ORDER BY c.created_at DESC LIMIT 50",
        (kr["id"],),
    )
    for r in rows:
        r["value"] = _num(r["value"])
    return rows


# ---------- escrita ----------


def _clean_title(title: str, what: str) -> str:
    title = " ".join((title or "").split())
    if len(title) < 3:
        raise BadRequestError(f"Dê um título ao {what} (pelo menos 3 letras).")
    if len(title) > TITLE_MAX:
        raise BadRequestError(f"O título do {what} passa de {TITLE_MAX} caracteres. Encurte.")
    return title


def _check_owner(ctx: Ctx, workspace_id: str, owner_id: str | None) -> str | None:
    if not owner_id:
        return None
    ok = is_uuid(owner_id) and ctx.one(
        "SELECT 1 AS x FROM workspace_members WHERE workspace_id = %s AND user_id = %s",
        (workspace_id, owner_id),
    )
    if not ok:
        raise BadRequestError(
            "O responsável precisa ser membro do espaço. Escolha alguém da lista."
        )
    return owner_id


def _objective(ctx: Ctx, objective_id: str, lock: bool = False) -> tuple[dict, Member]:
    if not is_uuid(objective_id):
        raise ForbiddenError()
    o = ctx.one(
        "SELECT * FROM objectives WHERE id = %s" + (" FOR UPDATE" if lock else ""),
        (objective_id,),
    )
    if not o:
        raise ForbiddenError()
    return o, membership(ctx, o["workspace_id"])


def _kr_and_member(ctx: Ctx, kr_id: str, lock: bool = False) -> tuple[dict, Member]:
    if not is_uuid(kr_id):
        raise ForbiddenError()
    kr = ctx.one(
        "SELECT k.*, o.workspace_id FROM key_results k JOIN objectives o ON o.id = k.objective_id "
        "WHERE k.id = %s" + (" FOR UPDATE OF k" if lock else ""),
        (kr_id,),
    )
    if not kr:
        raise ForbiddenError()
    return kr, membership(ctx, kr["workspace_id"])


def create_objective(
    ctx: Ctx,
    workspace_id: str,
    title: str,
    period: str,
    description: str = "",
    owner_id: str | None = None,
) -> dict:
    assert_can(membership(ctx, workspace_id), "okr.manage")
    row = ctx.one(
        "INSERT INTO objectives(workspace_id, period, title, description, owner_id, created_by, "
        "position) VALUES (%s,%s,%s,%s,%s,%s, (SELECT COALESCE(max(position), 0) + 1 "
        "FROM objectives WHERE workspace_id = %s)) RETURNING id",
        (
            workspace_id,
            _check_period(period),
            _clean_title(title, "objetivo"),
            (description or "").strip()[:2000],
            _check_owner(ctx, workspace_id, owner_id),
            ctx.user_id,
            workspace_id,
        ),
    )
    assert row
    return {"id": row["id"]}


def update_objective(ctx: Ctx, objective_id: str, fields: dict) -> None:
    o, m = _objective(ctx, objective_id, lock=True)
    assert_can(m, "okr.manage")
    sets: dict = {}
    if "title" in fields:
        sets["title"] = _clean_title(fields["title"], "objetivo")
    if "description" in fields:
        sets["description"] = (fields["description"] or "").strip()[:2000]
    if "period" in fields:
        sets["period"] = _check_period(fields["period"])
    if "owner_id" in fields:
        sets["owner_id"] = _check_owner(ctx, o["workspace_id"], fields["owner_id"])
    if sets:
        cols = ", ".join(f"{k} = %({k})s" for k in sets)
        ctx.run(
            f"UPDATE objectives SET {cols}, updated_at = now() WHERE id = %(id)s",
            {**sets, "id": objective_id},
        )


def delete_objective(ctx: Ctx, objective_id: str) -> None:
    _, m = _objective(ctx, objective_id, lock=True)
    assert_can(m, "okr.manage")
    ctx.run("DELETE FROM objectives WHERE id = %s", (objective_id,))


def _kr_values(ctx: Ctx, workspace_id: str, data: dict, current: dict | None) -> dict:
    """Valida os campos do KR. `current` é o KR existente (edição) ou nulo (criação)."""
    out: dict = {}
    if "title" in data or current is None:
        out["title"] = _clean_title(data.get("title", ""), "resultado-chave")
    if "owner_id" in data:
        out["owner_id"] = _check_owner(ctx, workspace_id, data["owner_id"])
    kind = data.get("kind", current["kind"] if current else "number")
    if kind not in KINDS:
        raise BadRequestError("Tipo de resultado-chave inválido. Use número ou projeto.")
    out["kind"] = kind
    for key in ("start_value", "target_value"):
        if key in data and data[key] is not None:
            out[key] = data[key]
    if "unit" in data:
        out["unit"] = " ".join((data["unit"] or "").split())[:UNIT_MAX]
    if "cost" in data:
        cost = data["cost"]
        if cost is not None and not 0 <= cost <= COST_MAX:
            raise BadRequestError(
                "Custo inválido. Informe um valor em reais a partir de 0 (0 = equipe interna) "
                "ou deixe em branco."
            )
        out["cost"] = cost
    project_id = data.get("project_id", current["project_id"] if current else None)
    if kind == "project":
        if not project_id:
            raise BadRequestError("Escolha o projeto que mede este resultado-chave.")
        # Só vincula projeto do próprio espaço e que quem edita enxerga.
        pa = project_access(ctx, project_id)
        if pa.project["workspace_id"] != workspace_id:
            raise BadRequestError("O projeto precisa ser deste espaço.")
        out["project_id"] = project_id
        out["start_value"], out["target_value"], out["unit"] = 0, 100, "%"
    elif "project_id" in data or (current and current["kind"] == "project"):
        out["project_id"] = None
    start = out.get("start_value", current["start_value"] if current else 0)
    target = out.get("target_value", current["target_value"] if current else 100)
    if start == target:
        raise BadRequestError("A meta precisa ser diferente do valor de partida.")
    return out


def create_key_result(ctx: Ctx, objective_id: str, data: dict) -> dict:
    o, m = _objective(ctx, objective_id)
    assert_can(m, "okr.manage")
    v = _kr_values(ctx, o["workspace_id"], data, None)
    # Sem valor atual informado, o KR começa no ponto de partida.
    v.setdefault("current_value", v.get("start_value", 0))
    v.update(objective_id=objective_id)
    cols = ", ".join(v)
    vals = ", ".join(f"%({k})s" for k in v)
    row = ctx.one(
        f"INSERT INTO key_results({cols}, position) VALUES ({vals}, "
        "(SELECT COALESCE(max(position), 0) + 1 FROM key_results WHERE objective_id = %(objective_id)s)) "
        "RETURNING id",
        v,
    )
    assert row
    return {"id": row["id"]}


def update_key_result(ctx: Ctx, kr_id: str, data: dict) -> None:
    kr, m = _kr_and_member(ctx, kr_id, lock=True)
    assert_can(m, "okr.manage")
    v = _kr_values(ctx, kr["workspace_id"], data, kr)
    if "objective_id" in data and data["objective_id"] != kr["objective_id"]:
        o, _ = _objective(ctx, data["objective_id"])
        if o["workspace_id"] != kr["workspace_id"]:
            raise ForbiddenError()
        v["objective_id"] = data["objective_id"]
    cols = ", ".join(f"{k} = %({k})s" for k in v)
    ctx.run(f"UPDATE key_results SET {cols} WHERE id = %(id)s", {**v, "id": kr_id})


def delete_key_result(ctx: Ctx, kr_id: str) -> None:
    _, m = _kr_and_member(ctx, kr_id, lock=True)
    assert_can(m, "okr.manage")
    ctx.run("DELETE FROM key_results WHERE id = %s", (kr_id,))


def check_in(
    ctx: Ctx,
    kr_id: str,
    value: float | None,
    confidence: str,
    note: str = "",
    timezone: str = "UTC",
) -> dict:
    """Registra o andamento: valor novo (KR de projeto lê o projeto), confiança e nota opcional.

    Devolve o KR atualizado e o progresso anterior, para a interface mostrar o avanço.
    """
    kr, m = _kr_and_member(ctx, kr_id, lock=True)
    if not (kr["owner_id"] == ctx.user_id or m.can("okr.manage")):
        raise ForbiddenError(
            "Só o responsável pelo resultado-chave ou quem gere os OKRs registra o check-in."
        )
    if confidence not in CONFIDENCE:
        raise BadRequestError(
            "Confiança inválida. Escolha: no caminho, em risco ou fora do caminho."
        )
    note = (note or "").strip()
    if len(note) > NOTE_MAX:
        raise BadRequestError(f"A nota passa de {NOTE_MAX} caracteres. Resuma o essencial.")
    now = datetime.now(UTC)
    row = _read_kr(ctx, kr_id)
    before = _shape_kr(ctx, row, m, None, now)["progress"]
    if kr["kind"] == "project" and kr["project_id"]:
        # O valor vem do projeto (o mesmo % do portfólio); não há o que digitar.
        value = row["project_progress"] or 0
    elif value is None:
        raise BadRequestError("Informe o valor atual do resultado-chave.")
    ctx.run(
        "UPDATE key_results SET current_value = %s, confidence = %s, last_checkin_at = %s "
        "WHERE id = %s",
        (value, confidence, now, kr_id),
    )
    after = _shape_kr(ctx, _read_kr(ctx, kr_id), m, None, now)
    ctx.run(
        "INSERT INTO okr_checkins(key_result_id, author_id, value, progress, confidence, note) "
        "VALUES (%s,%s,%s,%s,%s,%s)",
        (kr_id, ctx.user_id, value, after["progress"], confidence, note),
    )
    today = _today(timezone, now)
    o = ctx.one("SELECT period FROM objectives WHERE id = %s", (kr["objective_id"],))
    assert o
    pace = elapsed_pct(o["period"], today)
    after = _shape_kr(ctx, _read_kr(ctx, kr_id), m, pace, now)
    return {"key_result": after, "previous_progress": before}


def _read_kr(ctx: Ctx, kr_id: str) -> dict:
    r = ctx.one(f"{_KR_SELECT} WHERE k.id = %(id)s", {"id": kr_id, "uid": ctx.user_id})
    assert r
    return r
