"""Provedor determinístico para desenvolvimento e testes (ASSISTANT_PROVIDER=mock).

Reconhece algumas frases-modelo e chama as MESMAS ferramentas do provedor real, então os
testes cobrem validação, autorização e o fluxo de propostas de ponta a ponta sem rede.
"""

from __future__ import annotations

import re
import unicodedata

from .base import HistoryMessage, LLMResult, ToolExecutor


def _norm(s: str) -> str:
    return unicodedata.normalize("NFD", s.lower()).encode("ascii", "ignore").decode()


JOOMLA_WP = [
    (
        "Descoberta e planejamento",
        [
            ("inv", "Inventariar conteúdo, módulos e extensões do Joomla", 3, 8, False, []),
            ("esc", "Definir escopo e estratégia de redirecionamentos 301", 5, 4, False, ["inv"]),
            ("m1", "Marco: escopo aprovado", 6, None, True, ["esc"]),
        ],
    ),
    (
        "Preparação do WordPress",
        [
            ("amb", "Provisionar ambiente de homologação do WordPress", 7, 6, False, ["m1"]),
            ("tema", "Configurar tema e plugins equivalentes", 12, 16, False, ["amb"]),
        ],
    ),
    (
        "Migração de conteúdo",
        [
            ("mig", "Migrar artigos, categorias e mídias", 20, 24, False, ["tema"]),
            ("url", "Configurar redirecionamentos e permalinks", 22, 8, False, ["mig"]),
            ("m2", "Marco: conteúdo migrado", 23, None, True, ["url"]),
        ],
    ),
    (
        "Testes e publicação",
        [
            ("qa", "Testar links, formulários, SEO e desempenho", 27, 12, False, ["m2"]),
            ("go", "Publicar e monitorar nas primeiras 48 horas", 30, 6, False, ["qa"]),
            ("m3", "Marco: site publicado", 30, None, True, ["go"]),
        ],
    ),
]


def _wbs_args(goal: str) -> dict:
    g = _norm(goal)
    if "joomla" in g and "wordpress" in g:
        template, name = JOOMLA_WP, "Migração Joomla → WordPress"
    else:
        name = goal.strip().rstrip(".!?")[:80].capitalize() or "Novo projeto"
        template = [
            (
                "Descoberta",
                [
                    ("a", "Levantar requisitos e restrições", 5, 6, False, []),
                    ("b", "Marco: escopo validado", 6, None, True, ["a"]),
                ],
            ),
            ("Execução", [("c", "Executar o trabalho principal", 20, 24, False, ["b"])]),
            (
                "Entrega",
                [
                    ("d", "Revisar e entregar", 25, 6, False, ["c"]),
                    ("e", "Marco: entrega concluída", 26, None, True, ["d"]),
                ],
            ),
        ]
    return {
        "project_name": name,
        "summary": f"Plano inicial para: {goal.strip()[:200]}",
        "assumptions": [
            "Prazos em dias corridos a partir de hoje (ajuste na prévia).",
            "Estimativas iniciais, a validar com a equipe.",
        ],
        "phases": [
            {
                "name": ph,
                "tasks": [
                    {
                        "ref": r,
                        "title": t,
                        "due_in_days": d,
                        "estimate_hours": h,
                        "is_milestone": m,
                        "depends_on": dep,
                    }
                    for r, t, d, h, m, dep in tasks
                ],
            }
            for ph, tasks in template
        ],
    }


class MockLLM:
    def run(
        self,
        instructions: str,
        history: list[HistoryMessage],
        tools: list[dict],
        execute: ToolExecutor,
        max_rounds: int,
    ) -> LLMResult:
        text = history[-1].content if history else ""
        n = _norm(text)
        rounds = 0

        def call(name: str, args: dict) -> dict:
            nonlocal rounds
            rounds += 1
            return execute(name, args)

        def done(msg: str) -> LLMResult:
            return LLMResult(msg, 10, 10, rounds)

        def after_proposal(r: dict, ok: str) -> LLMResult:
            if "erro" in r:
                return done(r["erro"])
            if r.get("ambiguo"):
                return done("Há mais de uma tarefa com esse nome — escolha a correta abaixo.")
            return done(ok)

        if re.search(r"(o que|que).*(vence|vencem)|vence hoje", n):
            r = call("tasks_due", {})
            if not r.get("total"):
                return done("Nada vence hoje entre as tarefas que você pode ver.")
            return done(
                f"Hoje ({r['hoje']}) vencem {r['total']} tarefa(s), em ordem de prioridade:\n"
                + "\n".join(
                    f"• {t['titulo']} — prazo {t['prazo']} ({t['projeto']})" for t in r["tarefas"]
                )
            )
        if "meu dia" in n or "minha agenda" in n:
            r = call("my_day", {})
            t = r["totais"]
            lines = [
                f"• {x['titulo']} — prazo {x['prazo']}" for x in r["atrasadas"] + r["vencem_hoje"]
            ]
            return done(
                f"Hoje ({r['hoje']}): {t['atrasadas']} atrasada(s), {t['vencem_hoje']} vencem hoje, "
                f"{t['proximos_7_dias']} nos próximos 7 dias."
                + ("\n" + "\n".join(lines) if lines else "")
            )
        if "portfolio" in n or "carteira" in n or "panorama" in n:
            r = call("portfolio", {})
            return done(
                f"{r['total_projetos']} projeto(s) ativo(s). Saúde: "
                + ", ".join(f"{k}: {v}" for k, v in sorted(r["por_saude"].items()))
                + "\n"
                + "\n".join(
                    f"• {p['projeto']} — {p['progresso_pct']}%, {p['atrasadas']} atrasada(s)"
                    for p in r["projetos"]
                )
            )
        if "carga" in n or "sobrecarreg" in n:
            r = call("workload", {})
            return done(
                "\n".join(
                    f"• {p['pessoa']}: {p['abertas']} aberta(s), {p['atrasadas']} atrasada(s)"
                    for p in r["por_pessoa"]
                )
                or "Nenhuma tarefa de projeto em aberto."
            )
        m = re.search(r"comente\s+(?:na tarefa\s+)?(.+?)\s*:\s*(.+)$", text, re.I)
        if m:
            r = call(
                "propose_add_comment",
                {"task_query": m.group(1).strip(), "body": m.group(2).strip()},
            )
            return after_proposal(r, "Preparei o comentário. Revise e confirme para publicar.")
        if "parado" in n or "parada" in n or "inativ" in n:
            r = call("stalled_projects", {})
            if not r["total"]:
                return done(f"Nenhum projeto ativo está parado ({r['criterio']}).")
            return done(
                f"Critério: {r['criterio']}.\n"
                + "\n".join(
                    f"• {p['projeto']} — última atividade em {p['ultima_atividade'][:10]}"
                    for p in r["projetos"]
                )
            )
        if "bloque" in n:
            r = call("blockers", {})
            if "erro" in r:
                return done(r["erro"])
            lines = [
                f"• {t['titulo']} (bloqueada)"
                + (
                    " — depende de: " + ", ".join(d["titulo"] for d in t["depende_de_pendentes"])
                    if t["depende_de_pendentes"]
                    else ""
                )
                for t in r["bloqueadas"]
            ]
            lines += [
                f"• {t['titulo']} aguarda: "
                + ", ".join(d["titulo"] for d in t["depende_de_pendentes"])
                for t in r["aguardando_dependencias"]
            ]
            return done(
                "\n".join(lines) + f"\n({r['nota']})"
                if lines
                else f"Nenhuma tarefa bloqueada. ({r['nota']})"
            )
        if "resum" in n:
            r = call("project_summary", {})
            if "erro" in r:
                return done(r["erro"])
            msg = (
                f"Resumo de {r['projeto']}: {r['total_tarefas']} tarefas, {r['progresso_pct']}% concluído. "
                f"{len(r['atrasadas'])} atrasada(s), {len(r['bloqueadas'])} bloqueada(s)."
            )
            if r["lacunas"]:
                msg += "\nLacunas: " + "; ".join(r["lacunas"]) + "."
            return done(msg)
        m = re.search(
            r"(?:a |o )?(.+?)\s+(?:chegou|esta|está|ficou)\s+(?:a|em)\s+(\d{1,3})\s*%", text, re.I
        )
        if m:
            r = call(
                "propose_update_task",
                {"task_query": m.group(1).strip(), "progress": int(m.group(2))},
            )
            return after_proposal(
                r, "Preparei a atualização de progresso. Revise a prévia e confirme."
            )
        m = re.search(
            r"(?:conclua|marque|finalize)\s+(?:a tarefa\s+)?(.+?)(?:\s+como conclu[ií]da)?\s*$",
            text,
            re.I,
        )
        if m and ("conclu" in n or "finaliz" in n):
            r = call("propose_update_task", {"task_query": m.group(1).strip(), "status": "done"})
            return after_proposal(r, "Preparei a conclusão da tarefa. Revise e confirme.")
        m = re.search(r"(?:crie|criar|adicione)\s+(?:uma\s+)?tarefa[:\s]+(.+)", text, re.I)
        if m:
            r = call("propose_create_tasks", {"tasks": [{"title": m.group(1).strip()[:200]}]})
            return after_proposal(r, "Preparei a tarefa. Revise a prévia e confirme para criar.")
        if re.search(r"planej|migr|quero|projeto de|eap|estrutura anal", n):
            r = call("propose_wbs", _wbs_args(text))
            return after_proposal(
                r,
                "Montei um rascunho de EAP com fases, marcos e dependências. Edite o que quiser e confirme para criar.",
            )
        return done(
            "Posso ajudar com: meu dia, o que vence hoje, panorama do portfólio, carga da equipe, projetos parados, bloqueios, resumo do projeto, planejar um projeto (EAP) e preparar tarefas, comentários ou mudanças de estado/prazo/progresso/prioridade/responsável. O que você precisa?"
        )
