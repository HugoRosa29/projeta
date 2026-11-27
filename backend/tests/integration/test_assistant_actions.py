"""Assistente com alcance total: plano de ações genéricas pelos mesmos serviços da interface.

Cobre: resolução de nomes, simulação no SAVEPOINT (nada grava antes da confirmação), permissão
decidida pelo serviço, escopo do espaço, execução tudo-ou-nada, versão conferida na confirmação
e o link secreto de convite fora do histórico.
"""

from datetime import date, timedelta

import pytest

from helpers import join, make_project, make_team, make_user
from projeta.assistant import actions, proposals, service, tools
from projeta.assistant.tools import Session
from projeta.db import uow
from projeta.errors import AppError, BadRequestError, ConflictError
from projeta.work import okrs, risks, sprints, tasks

TZ = "America/Sao_Paulo"


def run(user: dict, ws: str, name: str, args: dict, project_id: str | None = None):
    with uow(user["id"]) as ctx:
        conv = service.get_or_create_conversation(ctx, ws, project_id)
        s = Session(ctx, ws, conv, TZ, project_id)
        return tools.execute(s, name, args), s


def plan(user: dict, ws: str, steps: list[dict], project_id: str | None = None):
    r, s = run(user, ws, "propose_actions", {"steps": steps}, project_id)
    return r, s.proposal


def confirm(user: dict, proposal_id: str) -> dict:
    with uow(user["id"]) as ctx:
        return proposals.confirm_proposal(ctx, proposal_id)


def days(n: int) -> str:
    return (date.today() + timedelta(days=n)).isoformat()


def count(user: dict, sql: str, params: tuple) -> int:
    with uow(user["id"]) as ctx:
        row = ctx.one(sql, params)
        assert row
        return row["n"]


@pytest.fixture
def team():
    adm, mem, vic = make_user("Adm"), make_user("Mem"), make_user("Vic")
    ws = make_team(adm)
    join(adm, ws, mem, "member")
    join(adm, ws, vic, "viewer")
    aberto = make_project(adm, ws, "Portal do cidadão", members=(mem, vic))
    sigiloso = make_project(adm, ws, "Projeto sigiloso")
    with uow(adm["id"]) as ctx:
        edital = tasks.create_task(ctx, ws, aberto, {"title": "Publicar edital"})
    return {
        "adm": adm,
        "mem": mem,
        "vic": vic,
        "ws": ws,
        "aberto": aberto,
        "sigiloso": sigiloso,
        "edital": edital,
    }


# ------------------------------------------------------------------ catálogo


def test_catalogo_cobre_todas_as_acoes_e_rotula_os_campos():
    text = actions.catalog()
    for a in actions.ACTIONS:
        assert f"- {a.name}:" in text
        for name, f in a.params.model_fields.items():
            # Todo campo visível precisa de rótulo em português para a prévia.
            assert name in actions.HIDDEN or f.title, f"{a.name}.{name} sem título"
    spec = next(t for t in tools.tool_specs() if t["name"] == "propose_actions")
    enum = spec["parameters"]["$defs"]["ActionStepArg"]["properties"]["action"]["enum"]
    assert set(enum) == set(actions.NAMES)


# ------------------------------------------------------------------ plano entre domínios


def test_plano_com_varias_areas_por_nome_grava_so_apos_confirmar(team):
    adm, ws, pid = team["adm"], team["ws"], team["aberto"]
    r, prop = plan(
        adm,
        ws,
        [
            {"action": "phase.create", "params": {"project": "Portal", "name": "Homologação"}},
            {
                "action": "sprint.create",
                "params": {
                    "project": "Portal",
                    "name": "Sprint Alfa",
                    "start_date": days(0),
                    "end_date": days(13),
                },
            },
            {
                "action": "task.update",
                "params": {
                    "task": "Publicar edital",
                    "sprint": "Sprint Alfa",
                    "assignee": "Mem",
                    "estimate_hours": 6,
                    "labels": ["edital"],
                    "phase": "Homologação",
                },
            },
            {
                "action": "risk.create",
                "params": {
                    "project": "Portal",
                    "title": "Atraso do jurídico",
                    "probability": 4,
                    "impact": 3,
                    "owner": "eu",
                },
            },
            {
                "action": "objective.create",
                "params": {
                    "title": "Digitalizar o atendimento",
                    "period": "2026-T4",
                    "key_results": [
                        {"title": "Serviços online", "start_value": 10, "target_value": 40},
                        {"title": "Portal no ar", "kind": "project", "project": "Portal"},
                    ],
                },
            },
        ],
    )
    assert r.get("proposta_criada"), r
    # A simulação rodou e foi desfeita: nada existe ainda.
    assert count(adm, "SELECT count(*)::int AS n FROM sprints WHERE project_id=%s", (pid,)) == 0
    assert (
        count(adm, "SELECT count(*)::int AS n FROM project_risks WHERE project_id=%s", (pid,)) == 0
    )
    assert count(adm, "SELECT count(*)::int AS n FROM objectives WHERE workspace_id=%s", (ws,)) == 0

    # Prévia com nomes no lugar de IDs.
    steps = prop["preview"]["steps"]
    assert [s["action"] for s in steps][:2] == ["phase.create", "sprint.create"]
    upd = {f["key"]: f for f in steps[2]["fields"]}
    assert upd["task_id"]["display"] == "Publicar edital"
    assert upd["assignee_id"]["display"] == "Mem"
    assert "expected_version" not in upd  # controle interno não aparece

    out = confirm(adm, prop["id"])
    assert out["status"] == "confirmed"
    assert len(out["proposal"]["result"]["done"]) == 5
    with uow(adm["id"]) as ctx:
        t = tasks.get_task(ctx, team["edital"]["id"])["task"]
        assert t["sprint_name"] == "Sprint Alfa"
        assert t["assignee_id"] == team["mem"]["id"]
        assert t["estimate_minutes"] == 360 and t["phase"] == "Homologação"
        assert risks.list_risks(ctx, pid)["risks"][0]["owner_id"] == adm["id"]
        o = okrs.list_okrs(ctx, ws, TZ, "2026-T4")["objectives"][0]
        assert {k["title"] for k in o["key_results"]} == {"Serviços online", "Portal no ar"}


def test_referencia_inexistente_ou_ambigua_volta_para_o_modelo(team):
    adm, ws = team["adm"], team["ws"]
    with uow(adm["id"]) as ctx:
        tasks.create_task(ctx, ws, team["aberto"], {"title": "Publicar edital revisado"})
    r, prop = plan(adm, ws, [{"action": "task.delete", "params": {"task": "edital"}}])
    assert prop is None and "Mais de um(a) tarefa" in r["erro"] and "id " in r["erro"]
    r, _ = plan(
        adm,
        ws,
        [{"action": "risk.update", "params": {"project": "Portal", "risk": "R9", "impact": 2}}],
    )
    assert "Não encontrei risco" in r["erro"]
    r, _ = plan(
        adm, ws, [{"action": "task.update", "params": {"task": "Publicar edital", "inventado": 1}}]
    )
    assert "erro" in r  # campo desconhecido não passa


# ------------------------------------------------------------------ permissão e escopo


def test_permissao_e_do_servico_e_aparece_ja_na_proposta(team):
    ws = team["ws"]
    # Membro edita tarefas mas não gere o projeto: sprint é de quem gere.
    r, prop = plan(team["mem"], ws, [{"action": "sprint.create", "params": {"project": "Portal"}}])
    assert prop is None and r["erro"] == "Acesso negado"
    # Leitor não cria tarefa.
    r, prop = plan(
        team["vic"], ws, [{"action": "task.create", "params": {"project": "Portal", "title": "X"}}]
    )
    assert prop is None and "erro" in r
    # Projeto invisível é tratado como inexistente, até pelo nome.
    r, _ = plan(team["mem"], ws, [{"action": "project.archive", "params": {"project": "sigiloso"}}])
    assert "Não encontrei projeto" in r["erro"]
    # Membro não mexe em permissões do espaço.
    r, _ = plan(
        team["mem"],
        ws,
        [
            {
                "action": "workspace.set_permissions",
                "params": {"role": "member", "grant": ["okr.manage"]},
            }
        ],
    )
    assert "erro" in r


def test_id_de_outro_espaco_e_recusado(team):
    adm = team["adm"]
    outro_ws = make_team(adm, "Outra equipe")
    outro = make_project(adm, outro_ws, "Projeto de fora")
    r, prop = plan(
        adm, team["ws"], [{"action": "project.archive", "params": {"project_id": outro}}]
    )
    assert prop is None and r["erro"] == "Acesso negado"


def test_edicao_da_previa_revalida_no_servidor(team):
    adm, ws = team["adm"], team["ws"]
    _, prop = plan(
        adm, ws, [{"action": "phase.create", "params": {"project": "Portal", "name": "Testes"}}]
    )
    with uow(team["mem"]["id"]) as ctx, pytest.raises(AppError):
        proposals.edit_proposal(ctx, prop["id"], prop["payload"])  # só o autor
    bad = {
        "steps": [{"action": "phase.create", "params": {"project_id": team["aberto"], "name": ""}}]
    }
    with uow(adm["id"]) as ctx, pytest.raises(BadRequestError):
        proposals.edit_proposal(ctx, prop["id"], bad)


# ------------------------------------------------------------------ execução


def test_plano_e_tudo_ou_nada(team):
    adm, ws, pid = team["adm"], team["ws"], team["aberto"]
    _, prop = plan(
        adm,
        ws,
        [
            {"action": "phase.create", "params": {"project": "Portal", "name": "Piloto"}},
            {"action": "task.delete", "params": {"task": "Publicar edital"}},
        ],
    )
    with uow(adm["id"]) as ctx:  # a tarefa some antes da confirmação
        tasks.delete_task(ctx, team["edital"]["id"])
    with pytest.raises(AppError) as e:
        confirm(adm, prop["id"])
    assert e.value.message.startswith("Passo 2")
    # O passo 1 foi desfeito junto e a proposta segue pendente.
    assert (
        count(
            adm,
            "SELECT count(*)::int AS n FROM project_phases WHERE project_id=%s AND name='Piloto'",
            (pid,),
        )
        == 0
    )
    with uow(adm["id"]) as ctx:
        assert proposals.get_proposal(ctx, prop["id"])["status"] == "pending"


def test_versao_conferida_na_confirmacao(team):
    adm, ws = team["adm"], team["ws"]
    _, prop = plan(
        adm,
        ws,
        [{"action": "task.update", "params": {"task": "Publicar edital", "title": "Edital 2026"}}],
    )
    with uow(adm["id"]) as ctx:  # outra pessoa mexe na tarefa depois da prévia
        tasks.update_task(ctx, team["edital"]["id"], {"priority": "urgent"})
    with pytest.raises(ConflictError):
        confirm(adm, prop["id"])


def test_mesma_tarefa_em_dois_passos_nao_conflita_consigo(team):
    adm, ws = team["adm"], team["ws"]
    _, prop = plan(
        adm,
        ws,
        [
            {"action": "task.update", "params": {"task": "Publicar edital", "status": "doing"}},
            {"action": "task.update", "params": {"task": "Publicar edital", "priority": "urgent"}},
        ],
    )
    assert confirm(adm, prop["id"])["status"] == "confirmed"


def test_convite_devolve_link_so_na_confirmacao(team):
    adm, ws = team["adm"], team["ws"]
    _, prop = plan(adm, ws, [{"action": "workspace.invite", "params": {"email": "nova@ex.com"}}])
    out = confirm(adm, prop["id"])
    link = out["once"][0]["href"]
    assert link.startswith("/convite/")
    token = link.removeprefix("/convite/")
    with uow(adm["id"]) as ctx:
        stored = ctx.one(
            "SELECT result::text AS r FROM assistant_proposals WHERE id=%s", (prop["id"],)
        )
        msgs = ctx.all("SELECT content, links::text AS l FROM assistant_messages")
    assert token not in stored["r"]
    assert all(token not in m["content"] and token not in m["l"] for m in msgs)


def test_sprint_ciclo_completo_e_acao_destrutiva_marcada(team):
    adm, ws, pid = team["adm"], team["ws"], team["aberto"]
    _, prop = plan(
        adm,
        ws,
        [{"action": "sprint.create", "params": {"name": "S1", "goal": "Publicar o edital"}}],
        project_id=pid,
    )
    confirm(adm, prop["id"])
    r, prop = plan(
        adm, ws, [{"action": "sprint.start", "params": {"sprint": "S1"}}], project_id=pid
    )
    assert prop, r
    confirm(adm, prop["id"])
    with uow(adm["id"]) as ctx:
        assert sprints.list_sprints(ctx, pid, days(0))["sprints"][0]["status"] == "active"
    _, prop = plan(adm, ws, [{"action": "sprint.create", "params": {"name": "S2"}}], project_id=pid)
    confirm(adm, prop["id"])
    r, prop = plan(
        adm, ws, [{"action": "sprint.delete", "params": {"sprint": "2"}}], project_id=pid
    )
    assert prop, r
    assert prop["preview"]["danger"] is True and "irreversível" in r["instrucao"]


# ------------------------------------------------------------------ consultas novas


def test_consultas_novas_respeitam_visibilidade(team):
    adm, mem, ws = team["adm"], team["mem"], team["ws"]
    with uow(adm["id"]) as ctx:
        risks.create_risk(
            ctx, team["sigiloso"], {"title": "Vazamento", "probability": 2, "impact": 5}
        )
    r, _ = run(adm, ws, "risks", {"project_name": "sigiloso"})
    assert r["dados"]["riscos"][0]["codigo"] == "R1"
    r, _ = run(mem, ws, "risks", {"project_id": team["sigiloso"]})
    assert r["erro"] == "Acesso negado"

    r, _ = run(mem, ws, "people", {"project_name": "Portal"})
    assert {p["nome"] for p in r["dados"]["espaco"]} == {"Adm", "Mem", "Vic"}
    assert "convites_pendentes_do_espaco" not in r["dados"]  # membro não convida
    r, _ = run(mem, ws, "project_plan", {"project_name": "Portal"})
    assert r["dados"]["projeto"] == "Portal do cidadão"
    r, _ = run(mem, ws, "settings", {})
    assert r["dados"]["meu_perfil_no_espaco"] == "member"
    r, _ = run(mem, ws, "term", {"project_name": "Portal", "kind": "tap"})
    assert "objetivos" in r["dados"]["campos_possiveis"]


def test_passos_citam_pelo_nome_o_que_passos_anteriores_criam(team):
    adm, ws = team["adm"], team["ws"]
    r, prop = plan(
        adm,
        ws,
        [
            {"action": "project.create", "params": {"name": "Censo 2027"}},
            {"action": "task.create", "params": {"project": "Censo 2027", "title": "Contratar"}},
            {"action": "task.create", "params": {"project": "Censo 2027", "title": "Treinar"}},
            {
                "action": "task.add_dependency",
                "params": {"task": "Treinar", "depends_on": "Contratar"},
            },
        ],
    )
    assert prop, r
    assert prop["payload"]["steps"][1]["params"]["project_id"] == "@passo:1"
    names = {f["key"]: f["display"] for f in prop["preview"]["steps"][3]["fields"]}
    assert names["depends_on_id"] == "(criado no passo 2)"
    confirm(adm, prop["id"])
    with uow(adm["id"]) as ctx:
        row = ctx.one(
            "SELECT t.title FROM task_dependencies d JOIN tasks t ON t.id = d.depends_on_id "
            "JOIN tasks a ON a.id = d.task_id WHERE a.title = 'Treinar'"
        )
    assert row and row["title"] == "Contratar"


def test_historico_leva_resumo_da_proposta_para_permitir_ajuste(team):
    adm, ws = team["adm"], team["ws"]
    _, prop = plan(
        adm,
        ws,
        [{"action": "phase.create", "params": {"project": "Portal", "name": "Homologação"}}],
    )
    with uow(adm["id"]) as ctx:
        conv = service.get_or_create_conversation(ctx, ws, None)
        ctx.run(
            "INSERT INTO assistant_messages(conversation_id, role, content, proposal_id) VALUES (%s,'assistant','Preparei.',%s)",
            (conv, prop["id"]),
        )
        hist = service._history(ctx, conv)
    last = hist[-1].content
    assert "[Proposta actions — aguardando confirmação" in last
    assert "phase.create name=Homologação" in last
    assert team["aberto"] not in last  # IDs não vão ao modelo


# ------------------------------------------------------------------ projeto homônimo (bug relatado)


def wbs_args(name: str) -> dict:
    return {
        "project_name": name,
        "phases": [
            {"name": "Diagnóstico", "tasks": [{"ref": "a", "title": "Inventariar conteúdo"}]}
        ],
    }


def test_eap_pelo_nome_de_projeto_existente_entra_nele_e_nao_cria_outro(team):
    adm, ws = team["adm"], team["ws"]
    # Sem projeto em tela, a pessoa pede "planeje as tarefas" do projeto recém-criado.
    r, s = run(adm, ws, "propose_wbs", wbs_args("portal do cidadao"))
    assert r.get("proposta_criada"), r
    assert s.proposal["payload"]["project_id"] == team["aberto"]
    assert s.proposal["preview"]["project"] == "Portal do cidadão"
    confirm(adm, s.proposal["id"])
    assert count(adm, "SELECT count(*)::int AS n FROM projects WHERE workspace_id=%s", (ws,)) == 2


def test_nome_novo_com_outro_projeto_em_tela_cria_projeto_novo(team):
    adm, ws = team["adm"], team["ws"]
    _, s = run(adm, ws, "propose_wbs", wbs_args("Intranet nova"), project_id=team["aberto"])
    assert s.proposal["payload"]["project_id"] is None
    assert s.proposal["payload"]["project_name"] == "Intranet nova"


def test_assistente_nao_cria_projeto_homonimo(team):
    adm, ws = team["adm"], team["ws"]
    r, prop = plan(adm, ws, [{"action": "project.create", "params": {"name": "PORTAL DO CIDADÃO"}}])
    assert prop is None and "Já existe o projeto" in r["erro"]
    # Duas propostas de projeto novo pendentes: a segunda confirmação é recusada.
    _, p1 = plan(adm, ws, [{"action": "project.create", "params": {"name": "Censo"}}])
    _, p2 = plan(adm, ws, [{"action": "project.create", "params": {"name": "Censo"}}])
    confirm(adm, p1["id"])
    with pytest.raises(BadRequestError):
        confirm(adm, p2["id"])


def test_homonimos_existentes_trazem_dados_para_desempatar(team):
    adm, ws = team["adm"], team["ws"]
    outro = make_project(adm, ws, "Portal do cidadão")  # criado pela tela, onde é permitido
    r, _ = run(adm, ws, "project_summary", {"project_name": "Portal do cidadão"})
    assert team["aberto"] in r["erro"] and outro in r["erro"] and "tarefas" in r["erro"]
    r, _ = run(adm, ws, "propose_wbs", wbs_args("Portal do cidadão"))
    assert "Mais de um projeto" in r["erro"]  # não cria um terceiro


# ------------------------------------------------------------------ edição em lote


@pytest.fixture
def lote(team):
    """Projeto com 25 tarefas: mais que o limite de passos de um plano."""
    adm, ws, pid = team["adm"], team["ws"], team["aberto"]
    with uow(adm["id"]) as ctx:
        for i in range(25):
            tasks.create_task(
                ctx,
                ws,
                pid,
                {
                    "title": f"Migrar seção {i:02d}",
                    "phase": "Migração" if i < 22 else "Testes",
                    "due_date": days(10 + i),
                    "start_date": days(5 + i),
                },
            )
    return team


def test_lote_muda_muitas_tarefas_num_passo_so(lote):
    adm, ws, pid = lote["adm"], lote["ws"], lote["aberto"]
    r, prop = plan(
        adm,
        ws,
        [
            {
                "action": "task.bulk_update",
                "params": {
                    "project": "Portal",
                    "where_phase": "migração",
                    "assignee": "Mem",
                    "priority": "high",
                },
            }
        ],
    )
    assert prop, r
    step = prop["preview"]["steps"][0]
    assert len(step["targets"]) == 22  # a prévia lista exatamente o que muda
    assert "task_ids" not in {f["key"] for f in step["fields"]}
    assert (
        count(
            adm, "SELECT count(*)::int AS n FROM tasks WHERE assignee_id=%s", (lote["mem"]["id"],)
        )
        == 0
    )
    confirm(adm, prop["id"])
    with uow(adm["id"]) as ctx:
        rows = ctx.all("SELECT phase, assignee_id, priority FROM tasks WHERE project_id=%s", (pid,))
    mig = [x for x in rows if x["phase"] == "Migração"]
    assert len(mig) == 22 and all(
        x["assignee_id"] == lote["mem"]["id"] and x["priority"] == "high" for x in mig
    )
    assert all(x["assignee_id"] is None for x in rows if x["phase"] == "Testes")


def test_lote_adia_prazos_e_inicios(lote):
    adm, ws = lote["adm"], lote["ws"]
    _, prop = plan(
        adm,
        ws,
        [
            {
                "action": "task.bulk_update",
                "params": {"project": "Portal", "where_phase": "Testes", "shift_days": 7},
            }
        ],
    )
    with uow(adm["id"]) as ctx:
        before = ctx.all(
            "SELECT title, due_date::text AS d FROM tasks WHERE phase='Testes' ORDER BY title"
        )
    confirm(adm, prop["id"])
    with uow(adm["id"]) as ctx:
        after = ctx.all(
            "SELECT title, due_date::text AS d FROM tasks WHERE phase='Testes' ORDER BY title"
        )
    assert [
        date.fromisoformat(a["d"]) - date.fromisoformat(b["d"])
        for a, b in zip(after, before, strict=True)
    ] == [timedelta(days=7)] * 3


def test_lote_selecao_congelada_e_versao_conferida(lote):
    adm, ws, pid = lote["adm"], lote["ws"], lote["aberto"]
    _, prop = plan(
        adm,
        ws,
        [
            {
                "action": "task.bulk_update",
                "params": {"project": "Portal", "where_phase": "Testes", "status": "done"},
            }
        ],
    )
    with uow(adm["id"]) as ctx:  # tarefa nova que casa com o filtro depois da prévia: não entra
        nova = tasks.create_task(ctx, ws, pid, {"title": "Testar busca", "phase": "Testes"})
    confirm(adm, prop["id"])
    with uow(adm["id"]) as ctx:
        assert tasks.get_task(ctx, nova["id"])["task"]["status"] == "todo"

    _, prop = plan(
        adm,
        ws,
        [
            {
                "action": "task.bulk_update",
                "params": {"project": "Portal", "where_phase": "Migração", "priority": "low"},
            }
        ],
    )
    with uow(adm["id"]) as ctx:  # uma das selecionadas muda antes da confirmação: nada grava
        alvo = ctx.one("SELECT id FROM tasks WHERE phase='Migração' LIMIT 1")
        tasks.update_task(ctx, alvo["id"], {"title": "Migrar seção renomeada"})
    with pytest.raises(ConflictError):
        confirm(adm, prop["id"])
    assert count(adm, "SELECT count(*)::int AS n FROM tasks WHERE priority='low'", ()) == 0


def test_lote_sem_responsavel_nao_vira_todas_e_respeita_permissao(lote):
    adm, ws = lote["adm"], lote["ws"]
    with uow(adm["id"]) as ctx:
        t = ctx.one("SELECT id FROM tasks WHERE title='Migrar seção 00'")
        tasks.update_task(ctx, t["id"], {"assignee_id": lote["mem"]["id"]})
    _, prop = plan(
        adm,
        ws,
        [
            {
                "action": "task.bulk_update",
                "params": {"project": "Portal", "where_assignee": "ninguém", "priority": "urgent"},
            }
        ],
    )
    titles = {x["title"] for x in prop["preview"]["steps"][0]["targets"]}
    assert "Migrar seção 00" not in titles and len(titles) == 25  # 24 do lote + "Publicar edital"
    # Leitor não edita em lote: o serviço recusa já na proposta.
    r, prop = plan(
        lote["vic"],
        ws,
        [{"action": "task.bulk_update", "params": {"project": "Portal", "status": "done"}}],
    )
    assert prop is None and "erro" in r
    # Filtro sem resultado e filtros contraditórios voltam para o modelo.
    r, _ = plan(
        adm,
        ws,
        [
            {
                "action": "task.bulk_update",
                "params": {"project": "Portal", "where_phase": "Nada", "status": "done"},
            }
        ],
    )
    assert "Nenhuma tarefa" in r["erro"]
    r, _ = plan(
        adm,
        ws,
        [
            {
                "action": "task.bulk_update",
                "params": {"project": "Portal", "shift_days": 3, "due_date": days(1)},
            }
        ],
    )
    assert "shift_days" in r["erro"]
