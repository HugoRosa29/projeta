"""Modo "projeto formal": funções, notas semanais, termos TAP/TEP e portfólio.

Tudo opcional: projeto comum (`phase` nulo) continua funcionando como antes. As regras
valem no servidor; a interface só reflete.
"""

from __future__ import annotations

from datetime import date, timedelta

from psycopg.types.json import Jsonb

from ..db import Ctx
from ..errors import BadRequestError, ConflictError, ForbiddenError
from ..identity.access import (
    IN_WORKSPACE_OR_RECEIVED,
    SHARED_FROM,
    VISIBLE_PROJECT,
    project_access,
    role_in,
)
from .activity import log_activity

PHASES = ("initiation", "planning", "execution", "monitoring", "closing")
PHASE_LABEL = {
    "initiation": "Iniciação",
    "planning": "Planejamento",
    "execution": "Execução",
    "monitoring": "Monitoramento e controle",
    "closing": "Encerramento",
}
ROLE_LABEL = {
    "gp": "Gerente do projeto",
    "po": "Dono do produto",
    "an": "Analista de negócios",
    "as": "Arquiteto de soluções",
    "ex": "Executor",
    "se": "Analista de segurança",
    "qa": "Analista de qualidade",
    "ei": "Especialista em infraestrutura/DevOps",
}
# Quem valida (qualidade, segurança) não pode ter projetado nem implementado a solução.
INDEPENDENT_ROLES = {"qa", "se"}
BUILDER_ROLES = {"ex", "as"}

_ORDER = ("gp", "po", "an", "as", "ex", "se", "qa")
# Matriz de responsabilidades de referência (R executa, A responde, C consulta, I informa,
# V verifica, S aprova), na ordem de _ORDER.
RACI = [
    ("initiation", "Definir recursos", ("R", "A/S", "C", "I", "I", "I", "I")),
    ("planning", "Levantar requisitos", ("I", "A/V", "R", "C", "I", "C", "I")),
    ("planning", "Planejar o projeto", ("A/R", "C", "C", "I", "I", "I", "I")),
    ("execution", "Projetar a solução", ("I", "C", "C", "A/R", "C", "C", "I")),
    ("execution", "Implementar", ("A", "I", "I", "C", "R", "C", "I")),
    ("execution", "Revisar código e segurança", ("A", "I", "I", "C", "C", "R", "V")),
    ("execution", "Testar e validar", ("I", "A/V", "I", "I", "C", "C", "R")),
    ("execution", "Implantar em produção", ("I", "A", "I", "C", "C", "C", "I")),
    ("monitoring", "Monitorar e controlar", ("A/R", "I", "C", "I", "I", "I", "I")),
    ("closing", "Encerrar o projeto", ("A/R/S", "C", "C", "I", "I", "C", "C")),
]


def reference() -> dict:
    return {
        "phases": [{"id": p, "label": PHASE_LABEL[p]} for p in PHASES],
        "roles": [{"id": r, "label": label} for r, label in ROLE_LABEL.items()],
        "raci": [
            {"phase": ph, "activity": act, "cells": dict(zip(_ORDER, cells, strict=True))}
            for ph, act, cells in RACI
        ],
    }


# --- funções no projeto -----------------------------------------------------------------


def set_member_roles(ctx: Ctx, project_id: str, user_id: str, roles: list[str]) -> list[str]:
    a = project_access(ctx, project_id, lock=True)
    if not a.can_manage:
        raise ForbiddenError()
    clean = sorted(set(roles))
    if any(r not in ROLE_LABEL for r in clean):
        raise BadRequestError("Função desconhecida. Use gp, po, an, as, ex, se, qa ou ei.")
    if INDEPENDENT_ROLES & set(clean) and BUILDER_ROLES & set(clean):
        raise BadRequestError(
            "Qualidade e segurança precisam ser de pessoas diferentes de quem projeta "
            "ou executa a solução. Escolha outra pessoa para uma das funções."
        )
    row = ctx.one(
        "UPDATE project_members SET roles = %s WHERE project_id = %s AND user_id = %s "
        "RETURNING roles",
        (clean, project_id, user_id),
    )
    if not row:
        raise BadRequestError("A pessoa precisa estar vinculada ao projeto antes de ter função.")
    log_activity(
        ctx,
        a.project["workspace_id"],
        "project.roles_set",
        project_id,
        data={"user_id": user_id, "roles": clean},
    )
    return row["roles"]


# --- notas semanais ---------------------------------------------------------------------

STATES = ("on_track", "at_risk", "late")


def draft_status_note(ctx: Ctx, project_id: str) -> dict:
    """Rascunho calculado das tarefas; a pessoa revisa e publica. Não grava nada."""
    project_access(ctx, project_id)
    since = date.today() - timedelta(days=7)
    done = ctx.all(
        "SELECT title FROM tasks WHERE project_id = %s AND status = 'done' "
        "AND completed_at >= %s ORDER BY completed_at",
        (project_id, since),
    )
    pending = ctx.all(
        "SELECT title, due_date::text AS due FROM tasks WHERE project_id = %s "
        "AND status <> 'done' ORDER BY due_date NULLS LAST, position LIMIT 20",
        (project_id,),
    )
    blocked = ctx.all(
        "SELECT title FROM tasks WHERE project_id = %s AND status = 'blocked' ORDER BY title",
        (project_id,),
    )
    overdue = ctx.all(
        "SELECT title, due_date::text AS due FROM tasks WHERE project_id = %s "
        "AND status <> 'done' AND due_date < current_date ORDER BY due_date",
        (project_id,),
    )
    state = "late" if overdue else ("at_risk" if blocked else "on_track")
    return {
        "state": state,
        "delay_reason": "",
        "done": "\n".join(f"- {t['title']}" for t in done),
        "pending": "\n".join(
            f"- {t['title']}" + (f" (até {t['due']})" if t["due"] else "") for t in pending
        ),
        "blockers": "\n".join(f"- {t['title']}" for t in blocked),
        "overdue": [{"title": t["title"], "due": t["due"]} for t in overdue],
    }


def add_status_note(
    ctx: Ctx,
    project_id: str,
    state: str,
    delay_reason: str = "",
    done: str = "",
    pending: str = "",
    blockers: str = "",
) -> dict:
    a = project_access(ctx, project_id)
    if not a.can_manage:
        raise ForbiddenError()
    if state not in STATES:
        raise BadRequestError("Situação inválida. Use on_track, at_risk ou late.")
    if state == "late" and not delay_reason.strip():
        raise BadRequestError(
            "Projeto atrasado precisa de justificativa. Explique o motivo do atraso."
        )
    note = ctx.one(
        "INSERT INTO project_status_notes"
        "(project_id, author_id, state, delay_reason, done, pending, blockers) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING *",
        (
            project_id,
            ctx.user_id,
            state,
            delay_reason.strip(),
            done.strip(),
            pending.strip(),
            blockers.strip(),
        ),
    )
    assert note
    log_activity(
        ctx, a.project["workspace_id"], "project.status_note", project_id, data={"state": state}
    )
    return note


def list_status_notes(ctx: Ctx, project_id: str, limit: int = 20) -> list[dict]:
    project_access(ctx, project_id)
    return ctx.all(
        "SELECT n.*, u.name AS author_name FROM project_status_notes n "
        "JOIN users u ON u.id = n.author_id WHERE n.project_id = %s "
        "ORDER BY n.created_at DESC LIMIT %s",
        (project_id, max(1, min(limit, 100))),
    )


# --- termos TAP / TEP -------------------------------------------------------------------

TAP_FIELDS = (
    "objetivo_estrategico",
    "justificativa",
    "objetivos",
    "escopo",
    "nao_escopo",
    "beneficios",
    "grandes_entregas",
    "partes_interessadas",
    "premissas",
    "restricoes",
    "custo_estimado",
    "data_inicio",
    "data_termino",
)
TEP_FIELDS = (
    "objetivo_estrategico",
    "justificativa",
    "objetivos",
    "escopo",
    "nao_escopo",
    "grandes_entregas",
    "custo_real",
    "data_inicio",
    "data_termino",
    "encerramento",
)


def _fields(kind: str) -> tuple[str, ...]:
    if kind == "tap":
        return TAP_FIELDS
    if kind == "tep":
        return TEP_FIELDS
    raise BadRequestError("Termo desconhecido. Use tap ou tep.")


def get_term(ctx: Ctx, project_id: str, kind: str) -> dict:
    _fields(kind)
    project_access(ctx, project_id)
    row = ctx.one(
        "SELECT kind, content, version, updated_at FROM project_terms "
        "WHERE project_id = %s AND kind = %s",
        (project_id, kind),
    )
    return row or {"kind": kind, "content": {}, "version": 0, "updated_at": None}


def save_term(ctx: Ctx, project_id: str, kind: str, content: dict, expected_version: int) -> dict:
    fields = _fields(kind)
    a = project_access(ctx, project_id, lock=True)
    if not a.can_manage:
        raise ForbiddenError()
    unknown = sorted(set(content) - set(fields))
    if unknown:
        raise BadRequestError(f"Campos desconhecidos no termo: {', '.join(unknown)}.")
    current = ctx.one(
        "SELECT version FROM project_terms WHERE project_id = %s AND kind = %s FOR UPDATE",
        (project_id, kind),
    )
    if (current["version"] if current else 0) != expected_version:
        raise ConflictError(
            "O termo mudou desde que você o abriu. Recarregue e reaplique a edição."
        )
    row = ctx.one(
        "INSERT INTO project_terms(project_id, kind, content, updated_by) VALUES (%s,%s,%s,%s) "
        "ON CONFLICT (project_id, kind) DO UPDATE SET content = EXCLUDED.content, "
        "version = project_terms.version + 1, updated_by = EXCLUDED.updated_by, "
        "updated_at = now() RETURNING kind, content, version, updated_at",
        (project_id, kind, Jsonb(content), ctx.user_id),
    )
    assert row
    log_activity(ctx, a.project["workspace_id"], f"project.{kind}_saved", project_id)
    return row


def draft_tep(ctx: Ctx, project_id: str) -> dict:
    """Pré-preenche o encerramento com o planejado (TAP) e o realizado (tarefas). Não grava."""
    project_access(ctx, project_id)
    tap = get_term(ctx, project_id, "tap")["content"]
    milestones = ctx.all(
        "SELECT title, phase, due_date::text AS due, completed_at::date::text AS done_on "
        "FROM tasks WHERE project_id = %s AND is_milestone "
        "ORDER BY due_date NULLS LAST, position",
        (project_id,),
    )
    span = ctx.one(
        "SELECT min(created_at)::date::text AS start, max(completed_at)::date::text AS finish "
        "FROM tasks WHERE project_id = %s",
        (project_id,),
    )
    draft = {k: tap[k] for k in TEP_FIELDS if k in tap}
    draft["grandes_entregas"] = [
        {
            "entrega": m["title"],
            "fase": m["phase"],
            "prevista": m["due"],
            "concluida_em": m["done_on"],
        }
        for m in milestones
    ]
    draft["data_inicio"] = tap.get("data_inicio") or (span or {}).get("start")
    draft["data_termino"] = (span or {}).get("finish")
    return draft


# --- portfólio --------------------------------------------------------------------------


def portfolio(ctx: Ctx, workspace_id: str) -> list[dict]:
    """Projetos ativos visíveis ao usuário no espaço, com situação e frescor do acompanhamento."""
    role_in(ctx, workspace_id)
    rows = ctx.all(
        f"""SELECT p.id, p.workspace_id, p.name, p.phase, p.approach, p.sei_process, p.summary, p.attributes, p.progress,
          (SELECT count(*)::int FROM tasks t WHERE t.project_id = p.id) AS task_count,
          (SELECT count(*)::int FROM tasks t WHERE t.project_id = p.id
             AND t.status = 'done') AS done_count,
          (SELECT count(*)::int FROM tasks t WHERE t.project_id = p.id
             AND t.status = 'doing') AS doing_count,
          (SELECT count(*)::int FROM tasks t WHERE t.project_id = p.id
             AND t.status <> 'done' AND t.due_date < current_date) AS overdue_count,
          (SELECT count(*)::int FROM tasks t WHERE t.project_id = p.id
             AND t.status = 'blocked') AS blocked_count,
          (SELECT n.state FROM project_status_notes n WHERE n.project_id = p.id
             ORDER BY n.created_at DESC LIMIT 1) AS last_note_state,
          (SELECT n.created_at FROM project_status_notes n WHERE n.project_id = p.id
             ORDER BY n.created_at DESC LIMIT 1) AS last_note_at,
          (SELECT c.updated_at FROM project_covers c WHERE c.project_id = p.id) AS cover_version,
          -- Datas para a esteira e a timeline da home. O TAP é texto livre: a interface interpreta.
          (SELECT min(t.due_date) FROM tasks t WHERE t.project_id = p.id) AS first_due,
          (SELECT max(t.due_date) FROM tasks t WHERE t.project_id = p.id) AS last_due,
          (SELECT pt.content->>'data_inicio' FROM project_terms pt
             WHERE pt.project_id = p.id AND pt.kind = 'tap') AS tap_start,
          (SELECT pt.content->>'data_termino' FROM project_terms pt
             WHERE pt.project_id = p.id AND pt.kind = 'tap') AS tap_end,
          p.created_at::date AS created_on,
          {SHARED_FROM}
        FROM projects p
        WHERE {IN_WORKSPACE_OR_RECEIVED} AND p.status = 'active' AND {VISIBLE_PROJECT}
        ORDER BY p.name""",
        {"ws": workspace_id, "uid": ctx.user_id},
    )
    today = date.today()
    for r in rows:
        r["health"] = (
            "late" if r["overdue_count"] else "at_risk" if r["blocked_count"] else "on_track"
        )
        # Só projeto formal deve ter nota semanal; sinaliza se passou de 7 dias.
        r["note_stale"] = bool(r["phase"]) and (
            r["last_note_at"] is None or (today - r["last_note_at"].date()).days > 7
        )
    return rows
