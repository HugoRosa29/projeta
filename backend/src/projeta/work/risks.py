"""Registro de riscos do projeto, seguindo o gerenciamento de riscos do PMBOK.

Cada risco passa pelos processos do guia: é *identificado* com causa, evento e efeito e uma
categoria da EAR de riscos; *analisado* qualitativamente (probabilidade x impacto, escala 1-5,
pontuação = produto); recebe uma *resposta* com estratégia própria do tipo (ameaça ou
oportunidade), plano, contingência, gatilho, responsável e prazo; e é *monitorado* pela situação e
pela data da última revisão.

Ler segue o acesso ao projeto. Registrar e atualizar riscos é trabalho do time (`task.write`,
vinculado, projeto ativo): quem está perto do trabalho é quem enxerga o risco primeiro. Excluir
exige gestão do projeto; o caminho normal é encerrar, que mantém o histórico.
"""

from __future__ import annotations

import datetime as dt

from ..db import Ctx
from ..errors import BadRequestError, ConflictError, ForbiddenError
from ..identity.access import is_uuid, project_access
from .activity import log_activity

KINDS = ("threat", "opportunity")
CATEGORIES = ("technical", "management", "commercial", "external")
STATUSES = ("open", "responding", "occurred", "closed")
OBJECTIVES = ("schedule", "cost", "scope", "quality")
# PMBOK 6, 11.5.2.4-5: estratégias para ameaças e para oportunidades. "Escalar" e "aceitar"
# valem para as duas.
STRATEGIES = {
    "threat": ("escalate", "avoid", "transfer", "mitigate", "accept"),
    "opportunity": ("escalate", "exploit", "share", "enhance", "accept"),
}

TITLE_MAX = 160
TEXT_MAX = {
    "cause": 1000,
    "effect": 1000,
    "response": 2000,
    "contingency": 2000,
    "trigger_signal": 500,
}
_TEXT_LABEL = {
    "cause": "A causa",
    "effect": "O efeito",
    "response": "O plano de resposta",
    "contingency": "O plano de contingência",
    "trigger_signal": "O gatilho",
}
# Evita que o registro vire depósito; muito acima do que um projeto acompanha de verdade.
MAX_RISKS = 300

EDITABLE = (
    "kind",
    "title",
    "cause",
    "effect",
    "category",
    "probability",
    "impact",
    "affects",
    "strategy",
    "response",
    "contingency",
    "trigger_signal",
    "owner_id",
    "response_due",
    "status",
)
# Mudar a avaliação ou a situação conta como revisão do risco.
_REVIEW_FIELDS = ("probability", "impact", "status")

_SELECT = """SELECT r.id::text AS id, r.number, r.kind, r.title, r.cause, r.effect, r.category,
       r.probability, r.impact, r.score, r.affects, r.strategy, r.response, r.contingency,
       r.trigger_signal, r.owner_id::text AS owner_id, u.name AS owner_name,
       r.response_due::text AS response_due, r.status, r.reviewed_at, r.version,
       r.created_at, r.updated_at
     FROM project_risks r LEFT JOIN users u ON u.id = r.owner_id"""


def list_risks(ctx: Ctx, project_id: str) -> dict:
    a = project_access(ctx, project_id)
    rows = ctx.all(
        f"{_SELECT} WHERE r.project_id = %s ORDER BY r.number",
        (project_id,),
    )
    return {"risks": rows, "can_write": a.can_write, "can_manage": a.can_manage}


def create_risk(ctx: Ctx, project_id: str, fields: dict) -> dict:
    a = project_access(ctx, project_id, lock=True)  # trava: o código é sequencial no projeto
    if not a.can_write:
        raise ForbiddenError()
    f = {"kind": "threat", "category": "technical", "status": "open", **_pick(fields)}
    if "title" not in f or "probability" not in f or "impact" not in f:
        raise BadRequestError(
            "Informe o evento de risco, a probabilidade e o impacto para registrar o risco."
        )
    _validate(ctx, project_id, f)
    stats = ctx.one(
        "SELECT count(*)::int AS n FROM project_risks WHERE project_id = %s", (project_id,)
    )
    assert stats
    if stats["n"] >= MAX_RISKS:
        raise BadRequestError(
            f"O projeto já tem {MAX_RISKS} riscos registrados. Exclua os encerrados que não "
            "precisam mais de histórico antes de registrar outro."
        )
    seq = ctx.one(
        "UPDATE projects SET last_risk_number = last_risk_number + 1 WHERE id = %s "
        "RETURNING last_risk_number AS n",
        (project_id,),
    )
    assert seq
    cols = ["project_id", "number", "created_by", *f]
    row = ctx.one(
        f"INSERT INTO project_risks({', '.join(cols)}) "
        f"VALUES ({', '.join(['%s'] * len(cols))}) RETURNING id::text AS id",
        (project_id, seq["n"], ctx.user_id, *f.values()),
    )
    assert row
    risk = _find(ctx, project_id, row["id"])
    _log(ctx, a.project["workspace_id"], "risk.created", project_id, risk)
    return risk


def update_risk(
    ctx: Ctx,
    project_id: str,
    risk_id: str,
    fields: dict,
    expected_version: int | None = None,
    reviewed: bool = False,
) -> dict:
    """Altera os campos enviados. `reviewed` registra a revisão mesmo sem mudar a avaliação."""
    a = project_access(ctx, project_id)
    if not a.can_write:
        raise ForbiddenError()
    current = _find(ctx, project_id, risk_id, lock=True)
    if expected_version is not None and expected_version != current["version"]:
        raise ConflictError(
            "O risco foi alterado por outra pessoa. Recarregue para ver a versão atual.",
            {"current": current},
        )
    f = _pick(fields)
    if "title" in f and f["title"] is None:
        raise BadRequestError("O evento de risco não pode ficar vazio.")
    merged = {**current, **f}
    _validate(ctx, project_id, merged, only=f)
    # Trocar de ameaça para oportunidade invalida a estratégia que só vale para o tipo antigo.
    if "kind" in f and "strategy" not in f and current["strategy"] not in STRATEGIES[f["kind"]]:
        f["strategy"] = None
    changed = {k: v for k, v in f.items() if _norm(v) != _norm(current[k])}
    review = reviewed or any(k in changed for k in _REVIEW_FIELDS)
    if not changed and not review:
        return current
    sets = [f"{k} = %({k})s" for k in changed]
    if review:
        sets.append("reviewed_at = now()")
    ctx.run(
        f"UPDATE project_risks SET {', '.join(sets)}, version = version + 1, updated_at = now() "
        "WHERE id = %(_id)s",
        {**changed, "_id": risk_id},
    )
    risk = _find(ctx, project_id, risk_id)
    extra = {}
    if "probability" in changed or "impact" in changed:
        extra = {"score_from": current["score"], "score_to": risk["score"]}
    if "status" in changed:
        extra["status"] = risk["status"]
    kind = "risk.updated" if changed else "risk.reviewed"
    _log(ctx, a.project["workspace_id"], kind, project_id, risk, extra)
    return risk


def delete_risk(ctx: Ctx, project_id: str, risk_id: str) -> None:
    a = project_access(ctx, project_id)
    if not a.can_manage:
        raise ForbiddenError()
    risk = _find(ctx, project_id, risk_id, lock=True)
    ctx.run("DELETE FROM project_risks WHERE id = %s", (risk_id,))
    _log(ctx, a.project["workspace_id"], "risk.deleted", project_id, risk)


def _pick(fields: dict) -> dict:
    f = {k: fields[k] for k in EDITABLE if k in fields}
    for k in ("title", *TEXT_MAX):
        if k in f and isinstance(f[k], str):
            f[k] = f[k].strip()
    if isinstance(f.get("title"), str):
        f["title"] = " ".join(f["title"].split()) or None
    for k in ("owner_id", "response_due", "strategy"):
        if k in f and not f[k]:
            f[k] = None  # "" = limpar, como nulo
    for k in TEXT_MAX:
        if k in f and f[k] is None:
            f[k] = ""
    if "affects" in f:
        # Sem repetição e na ordem fixa da tela, para a comparação de mudança ser estável.
        chosen = set(f["affects"] or [])
        unknown = chosen - set(OBJECTIVES)
        if unknown:
            raise BadRequestError(
                "Objetivo afetado desconhecido. Use prazo, custo, escopo ou qualidade."
            )
        f["affects"] = [o for o in OBJECTIVES if o in chosen]
    return f


def _validate(ctx: Ctx, project_id: str, r: dict, only: dict | None = None) -> None:
    """Valida o risco inteiro `r`; `only` limita as checagens caras aos campos alterados."""
    touched = r if only is None else only
    if not r.get("title"):
        raise BadRequestError("Descreva o evento de risco (o que pode acontecer).")
    if len(r["title"]) > TITLE_MAX:
        raise BadRequestError(f"O evento de risco passa de {TITLE_MAX} caracteres. Encurte.")
    for k, n in TEXT_MAX.items():
        if len(r.get(k) or "") > n:
            raise BadRequestError(f"{_TEXT_LABEL[k]} passa de {n} caracteres. Encurte o texto.")
    if r["kind"] not in KINDS:
        raise BadRequestError("Tipo de risco inválido. Use ameaça ou oportunidade.")
    if r["category"] not in CATEGORIES:
        raise BadRequestError(
            "Categoria inválida. Use técnico, gerenciamento, comercial ou externo."
        )
    if r["status"] not in STATUSES:
        raise BadRequestError(
            "Situação inválida. Use identificado, em tratamento, ocorreu ou encerrado."
        )
    for k, label in (("probability", "A probabilidade"), ("impact", "O impacto")):
        v = r.get(k)
        if not isinstance(v, int) or isinstance(v, bool) or not 1 <= v <= 5:
            raise BadRequestError(f"{label} vai de 1 (muito baixa) a 5 (muito alta).")
    strategy = r.get("strategy")
    if strategy and "strategy" in touched and strategy not in STRATEGIES[r["kind"]]:
        raise BadRequestError(
            "Essa estratégia não vale para o tipo do risco. Ameaças: escalar, evitar, transferir, "
            "mitigar ou aceitar. Oportunidades: escalar, explorar, compartilhar, melhorar ou aceitar."
        )
    if "response_due" in touched and r.get("response_due"):
        try:
            if not isinstance(r["response_due"], dt.date):
                r["response_due"] = dt.date.fromisoformat(str(r["response_due"]))
        except ValueError as e:
            raise BadRequestError("Prazo da resposta inválido. Use uma data (AAAA-MM-DD).") from e
        if only is not None:
            only["response_due"] = r["response_due"]
    owner = r.get("owner_id")
    if owner and "owner_id" in touched and not _is_member(ctx, project_id, owner):
        raise BadRequestError("O responsável pelo risco precisa ser membro do projeto.")


def _is_member(ctx: Ctx, project_id: str, user_id: str) -> bool:
    return is_uuid(user_id) and bool(
        ctx.one(
            "SELECT 1 AS x FROM project_members WHERE project_id=%s AND user_id=%s",
            (project_id, user_id),
        )
    )


def _norm(v: object) -> object:
    return v.isoformat() if isinstance(v, dt.date) else v


def _find(ctx: Ctx, project_id: str, risk_id: str, lock: bool = False) -> dict:
    # Risco de outro projeto responde igual ao inexistente: não revela se o ID existe.
    if not is_uuid(risk_id):
        raise ForbiddenError()
    r = ctx.one(
        f"{_SELECT} WHERE r.id = %s AND r.project_id = %s" + (" FOR UPDATE OF r" if lock else ""),
        (risk_id, project_id),
    )
    if not r:
        raise ForbiddenError()
    return r


def _log(
    ctx: Ctx, workspace_id: str, kind: str, project_id: str, risk: dict, extra: dict | None = None
) -> None:
    # Só o código e o título (o que o histórico do projeto já mostra para tarefas); causa, efeito
    # e planos ficam fora do registro de atividade.
    data = {"number": risk["number"], "title": risk["title"], **(extra or {})}
    log_activity(ctx, workspace_id, kind, project_id, data=data)
