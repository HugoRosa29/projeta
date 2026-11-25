"""OKRs: quem gere cria objetivos e KRs; o dono do KR faz check-in; o espaço todo lê."""

from datetime import UTC, date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from projeta.api.app import app
from projeta.db import uow
from projeta.errors import BadRequestError, ForbiddenError
from projeta.work import okrs, tasks
from tests.helpers import join, make_project, make_team, make_user

TZ = "America/Sao_Paulo"


@pytest.fixture
def team():
    gestor, gp, membro, leitor, fora = (
        make_user(n) for n in ("gestor", "gp", "membro", "leitor", "fora")
    )
    ws = make_team(gestor)
    join(gestor, ws, gp, "manager")
    join(gestor, ws, membro, "member")
    join(gestor, ws, leitor, "viewer")
    period = okrs.quarter_of(date.today())
    with uow(gp["id"]) as ctx:
        oid = okrs.create_objective(ctx, ws, "Atender o cidadão mais rápido", period)["id"]
        kr = okrs.create_key_result(
            ctx,
            oid,
            {
                "title": "Reduzir prazo médio",
                "owner_id": membro["id"],
                "start_value": 30,
                "target_value": 10,
                "unit": "dias",
            },
        )["id"]
    return {
        "gestor": gestor,
        "gp": gp,
        "membro": membro,
        "leitor": leitor,
        "fora": fora,
        "ws": ws,
        "oid": oid,
        "kr": kr,
        "period": period,
    }


def _okrs(user, ws, period=None):
    with uow(user["id"]) as ctx:
        return okrs.list_okrs(ctx, ws, TZ, period)


def test_progresso_de_meta_decrescente_e_media_do_objetivo(team):
    with uow(team["membro"]["id"]) as ctx:
        r = okrs.check_in(ctx, team["kr"], 20, "at_risk", "Novo fluxo de triagem", TZ)
    assert r["previous_progress"] == 0
    assert r["key_result"]["progress"] == 50  # de 30 para 10 dias, está em 20
    with uow(team["gp"]["id"]) as ctx:
        okrs.create_key_result(
            ctx,
            team["oid"],
            {"title": "Satisfação", "start_value": 0, "target_value": 10, "unit": "nota"},
        )
    data = _okrs(team["leitor"], team["ws"])
    o = data["objectives"][0]
    assert o["progress"] == 25  # média de 50 e 0
    assert o["confidence"] == "at_risk"  # a pior confiança entre os KRs
    assert data["summary"]["without_owner"] == 1
    assert data["summary"]["updated_this_week"] == 1
    assert data["can_manage"] is False


def test_progresso_e_limitado_entre_0_e_100():
    assert okrs.progress_of("number", 0, 10, 15, None) == 100
    assert okrs.progress_of("number", 0, 10, -3, None) == 0
    assert okrs.progress_of("project", 0, 100, 0, 70) == 70


def test_historico_de_checkins_guarda_progresso_do_momento(team):
    with uow(team["membro"]["id"]) as ctx:
        okrs.check_in(ctx, team["kr"], 20, "on_track", "", TZ)
    with uow(team["gp"]["id"]) as ctx:
        okrs.update_key_result(ctx, team["kr"], {"target_value": 0})
    with uow(team["leitor"]["id"]) as ctx:
        hist = okrs.list_checkins(ctx, team["kr"])
    assert [h["progress"] for h in hist] == [50]
    assert _okrs(team["leitor"], team["ws"])["objectives"][0]["key_results"][0]["progress"] == 33


def test_kr_de_projeto_le_o_progresso_do_projeto(team):
    pid = make_project(team["gp"], team["ws"], "Portal")
    with uow(team["gp"]["id"]) as ctx:
        for i in range(4):
            t = tasks.create_task(ctx, team["ws"], pid, {"title": f"T{i}"})
            if i == 0:
                tasks.update_task(ctx, t["id"], {"status": "done"})
        kr = okrs.create_key_result(
            ctx,
            team["oid"],
            {
                "title": "Portal no ar",
                "kind": "project",
                "project_id": pid,
                "owner_id": team["gp"]["id"],
            },
        )["id"]
        r = okrs.check_in(ctx, kr, 999, "on_track", "", TZ)  # valor digitado é ignorado
    assert r["key_result"]["progress"] == 25
    assert r["key_result"]["current_value"] == 25
    # Quem não enxerga o projeto vê o progresso, mas não o nome nem o link.
    k = next(
        k
        for k in _okrs(team["membro"], team["ws"])["objectives"][0]["key_results"]
        if k["id"] == kr
    )
    assert k["progress"] == 25 and k["project_name"] is None and k["project_id"] is None
    k = next(
        k for k in _okrs(team["gp"], team["ws"])["objectives"][0]["key_results"] if k["id"] == kr
    )
    assert k["project_name"] == "Portal"


def test_so_quem_gere_cria_e_edita(team):
    for who in ("membro", "leitor"):
        with pytest.raises(ForbiddenError), uow(team[who]["id"]) as ctx:
            okrs.create_objective(ctx, team["ws"], "Outro", team["period"])
        with pytest.raises(ForbiddenError), uow(team[who]["id"]) as ctx:
            okrs.update_key_result(ctx, team["kr"], {"target_value": 5})
        with pytest.raises(ForbiddenError), uow(team[who]["id"]) as ctx:
            okrs.delete_objective(ctx, team["oid"])
    with uow(team["gestor"]["id"]) as ctx:
        okrs.update_objective(ctx, team["oid"], {"title": "Atender melhor"})
    assert _okrs(team["gp"], team["ws"])["objectives"][0]["title"] == "Atender melhor"


def test_checkin_e_do_dono_ou_de_quem_gere(team):
    with pytest.raises(ForbiddenError), uow(team["leitor"]["id"]) as ctx:
        okrs.check_in(ctx, team["kr"], 25, "on_track", "", TZ)
    with uow(team["gp"]["id"]) as ctx:  # quem gere registra no lugar do dono
        okrs.check_in(ctx, team["kr"], 25, "on_track", "", TZ)
    with pytest.raises(BadRequestError), uow(team["membro"]["id"]) as ctx:
        okrs.check_in(ctx, team["kr"], None, "on_track", "", TZ)


def test_acesso_cruzado(team):
    outro = make_team(team["fora"], "Outra equipe")
    calls = (
        lambda ctx: okrs.list_okrs(ctx, team["ws"], TZ),
        lambda ctx: okrs.my_okrs(ctx, team["ws"], TZ),
        lambda ctx: okrs.list_checkins(ctx, team["kr"]),
        lambda ctx: okrs.check_in(ctx, team["kr"], 1, "on_track", "", TZ),
        lambda ctx: okrs.update_objective(ctx, team["oid"], {"title": "x x x"}),
        lambda ctx: okrs.delete_key_result(ctx, team["kr"]),
        lambda ctx: okrs.create_key_result(ctx, team["oid"], {"title": "Invasor"}),
    )
    for fn in calls:
        with pytest.raises(ForbiddenError), uow(team["fora"]["id"]) as ctx:
            fn(ctx)
    # Quem gere em outro espaço não usa pessoa nem projeto deste.
    with pytest.raises(BadRequestError), uow(team["gp"]["id"]) as ctx:
        okrs.create_key_result(
            ctx, team["oid"], {"title": "Dono de fora", "owner_id": team["fora"]["id"]}
        )
    pid_fora = make_project(team["fora"], outro, "Alheio")
    with pytest.raises(ForbiddenError), uow(team["gp"]["id"]) as ctx:
        okrs.create_key_result(
            ctx, team["oid"], {"title": "Projeto alheio", "kind": "project", "project_id": pid_fora}
        )


def test_validacoes(team):
    with pytest.raises(BadRequestError), uow(team["gp"]["id"]) as ctx:
        okrs.create_objective(ctx, team["ws"], "Objetivo", "2026-Q4")
    with pytest.raises(BadRequestError), uow(team["gp"]["id"]) as ctx:
        okrs.create_key_result(
            ctx, team["oid"], {"title": "Meta igual", "start_value": 5, "target_value": 5}
        )
    with pytest.raises(BadRequestError), uow(team["gp"]["id"]) as ctx:
        okrs.create_key_result(ctx, team["oid"], {"title": "Sem projeto", "kind": "project"})


def test_meus_krs_pendentes_e_sequencia(team):
    with uow(team["membro"]["id"]) as ctx:
        mine = okrs.my_okrs(ctx, team["ws"], TZ)
    assert [k["id"] for k in mine["key_results"]] == [team["kr"]]
    assert mine["pending"] == 1 and mine["streak_weeks"] == 0
    with uow(team["membro"]["id"]) as ctx:
        okrs.check_in(ctx, team["kr"], 28, "on_track", "", TZ)
        ctx.run(
            "INSERT INTO okr_checkins(key_result_id, author_id, value, progress, confidence, created_at) "
            "VALUES (%s, %s, 29, 5, 'on_track', %s)",
            (team["kr"], team["membro"]["id"], datetime.now(UTC) - timedelta(days=7)),
        )
        mine = okrs.my_okrs(ctx, team["ws"], TZ)
    assert mine["pending"] == 0 and mine["streak_weeks"] == 2 and mine["checkins_this_week"] == 1
    assert mine["key_results"][0]["objective_title"] == "Atender o cidadão mais rápido"


def test_sequencia_conta_semanas_seguidas():
    hoje = date(2026, 11, 25)  # quarta
    assert okrs.streak_weeks([date(2026, 11, 17), date(2026, 11, 10)], hoje) == 2  # esta ainda não
    assert okrs.streak_weeks([date(2026, 11, 24), date(2026, 11, 10)], hoje) == 1  # buraco
    assert okrs.streak_weeks([], hoje) == 0


def test_ritmo_do_trimestre():
    assert okrs.elapsed_pct("2026-T4", date(2026, 11, 15)) == 50
    assert okrs.elapsed_pct("2026-T3", date(2026, 11, 15)) is None
    assert okrs.quarter_bounds("2026-T1") == (date(2026, 1, 1), date(2026, 3, 31))


def test_matriz_concede_okr_manage_ao_gerente_por_padrao(team):
    with uow(team["gp"]["id"]) as ctx:
        assert okrs.list_okrs(ctx, team["ws"], TZ)["can_manage"] is True


def test_api_fluxo_completo(team, monkeypatch):
    from projeta.identity import auth

    c = TestClient(app)
    c.headers["x-requested-with"] = "projeta-web"
    monkeypatch.setattr(auth, "user_from_token", lambda ctx, tok: team["membro"] | {"timezone": TZ})
    r = c.get("/api/v1/okrs/mine", params={"workspace_id": team["ws"]})
    assert r.status_code == 200 and r.json()["pending"] == 1
    r = c.post(
        f"/api/v1/key-results/{team['kr']}/checkins", json={"value": 20, "confidence": "on_track"}
    )
    assert r.status_code == 201 and r.json()["key_result"]["progress"] == 50
    r = c.post(
        "/api/v1/objectives",
        json={"workspace_id": team["ws"], "title": "Não pode", "period": team["period"]},
    )
    assert r.status_code == 403


def test_custo_do_kr_soma_no_painel_e_pode_ser_limpo(team):
    with uow(team["gp"]["id"]) as ctx:
        okrs.update_key_result(ctx, team["kr"], {"cost": 40000})
        outro = okrs.create_key_result(
            ctx, team["oid"], {"title": "Satisfação", "target_value": 5, "cost": 0}
        )["id"]
        for ruim in (-1, 10**12):
            with pytest.raises(BadRequestError):
                okrs.update_key_result(ctx, outro, {"cost": ruim})
    b = _okrs(team["leitor"], team["ws"])
    custos = {k["id"]: k["cost"] for k in b["objectives"][0]["key_results"]}
    assert custos == {team["kr"]: 40000, outro: 0}
    assert b["summary"]["cost"] == 40000
    # Só quem gere define o custo; o dono do KR não.
    with uow(team["membro"]["id"]) as ctx, pytest.raises(ForbiddenError):
        okrs.update_key_result(ctx, team["kr"], {"cost": 1})
    with uow(team["gp"]["id"]) as ctx:
        okrs.update_key_result(ctx, team["kr"], {"cost": None})
    assert _okrs(team["leitor"], team["ws"])["objectives"][0]["key_results"][0]["cost"] is None
