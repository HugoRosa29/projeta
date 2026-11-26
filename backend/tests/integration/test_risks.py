"""Registro de riscos do projeto (PMBOK): identificar, analisar, responder e monitorar."""

import pytest
from fastapi.testclient import TestClient

from projeta.api.app import app
from projeta.db import uow
from projeta.errors import BadRequestError, ConflictError, ForbiddenError
from projeta.work import risks
from tests.helpers import install_fake_gia, join, make_project, make_team, make_user


@pytest.fixture
def setup():
    gp, membro, leitor = make_user("gp"), make_user("membro"), make_user("leitor")
    ws = make_team(gp)
    join(gp, ws, membro, "member")
    join(gp, ws, leitor, "viewer")
    pid = make_project(gp, ws, "Portal", members=(membro, leitor))
    return {"gp": gp, "membro": membro, "leitor": leitor, "ws": ws, "pid": pid}


def _new(ctx, pid: str, **extra) -> dict:
    return risks.create_risk(
        ctx, pid, {"title": "Atraso do fornecedor", "probability": 3, "impact": 4, **extra}
    )


def test_registra_com_codigo_sequencial_e_pontuacao(setup):
    s = setup
    with uow(s["membro"]["id"]) as ctx:
        r1 = _new(
            ctx,
            s["pid"],
            cause="  Fornecedor único  ",
            effect="Entrega da obra escorrega",
            category="commercial",
            affects=["cost", "schedule", "cost"],
            strategy="mitigate",
            owner_id=s["gp"]["id"],
            response_due="2026-12-10",
        )
        assert (r1["number"], r1["score"], r1["kind"], r1["status"]) == (1, 12, "threat", "open")
        assert r1["cause"] == "Fornecedor único"
        assert r1["affects"] == ["schedule", "cost"]  # sem repetição, na ordem da tela
        assert (r1["owner_name"], r1["response_due"]) == ("gp", "2026-12-10")
        r2 = _new(ctx, s["pid"], kind="opportunity", strategy="exploit")
        assert r2["number"] == 2

        # Excluir não reaproveita o código: "R-02" continua sendo o mesmo risco nas atas.
    with uow(s["gp"]["id"]) as ctx:
        risks.delete_risk(ctx, s["pid"], r2["id"])
        assert _new(ctx, s["pid"])["number"] == 3
        kinds = [
            r["kind"] for r in ctx.all("SELECT kind FROM activity WHERE project_id=%s", (s["pid"],))
        ]
        assert kinds.count("risk.created") == 3 and kinds.count("risk.deleted") == 1


def test_estrategia_tem_que_valer_para_o_tipo(setup):
    s = setup
    with uow(s["gp"]["id"]) as ctx, pytest.raises(BadRequestError, match="estratégia"):
        _new(ctx, s["pid"], strategy="exploit")  # explorar é para oportunidade
    with uow(s["gp"]["id"]) as ctx, pytest.raises(BadRequestError, match="estratégia"):
        _new(ctx, s["pid"], kind="opportunity", strategy="avoid")
    with uow(s["gp"]["id"]) as ctx:
        r = _new(ctx, s["pid"], strategy="mitigate")
        # Virar oportunidade descarta a estratégia que só vale para ameaça.
        r = risks.update_risk(ctx, s["pid"], r["id"], {"kind": "opportunity"})
        assert (r["kind"], r["strategy"]) == ("opportunity", None)
        # "Aceitar" vale para os dois tipos e sobrevive à troca.
        r = risks.update_risk(ctx, s["pid"], r["id"], {"strategy": "accept"})
        r = risks.update_risk(ctx, s["pid"], r["id"], {"kind": "threat"})
        assert r["strategy"] == "accept"


def test_validacoes(setup):
    s = setup
    with uow(s["gp"]["id"]) as ctx, pytest.raises(BadRequestError, match="1 \\(muito baixa\\)"):
        _new(ctx, s["pid"], probability=6)
    with uow(s["gp"]["id"]) as ctx, pytest.raises(BadRequestError, match="evento"):
        risks.create_risk(ctx, s["pid"], {"title": "   ", "probability": 1, "impact": 1})
    with uow(s["gp"]["id"]) as ctx, pytest.raises(BadRequestError, match="membro do projeto"):
        _new(ctx, s["pid"], owner_id=make_user("estranho")["id"])
    with uow(s["gp"]["id"]) as ctx, pytest.raises(BadRequestError, match="Prazo da resposta"):
        _new(ctx, s["pid"], response_due="10/12/2026")
    with uow(s["gp"]["id"]) as ctx, pytest.raises(BadRequestError, match="caracteres"):
        _new(ctx, s["pid"], response="x" * (risks.TEXT_MAX["response"] + 1))


def test_reavaliar_conta_como_revisao_e_guarda_a_mudanca_de_pontuacao(setup):
    s = setup
    with uow(s["gp"]["id"]) as ctx:
        r = _new(ctx, s["pid"])
        ctx.run(
            "UPDATE project_risks SET reviewed_at = now() - interval '40 days' WHERE id=%s",
            (r["id"],),
        )
        old = risks.list_risks(ctx, s["pid"])["risks"][0]["reviewed_at"]

        # Mudar só o texto não é revisão.
        r = risks.update_risk(ctx, s["pid"], r["id"], {"response": "Segundo fornecedor"})
        assert r["reviewed_at"] == old

        r = risks.update_risk(ctx, s["pid"], r["id"], {"probability": 1}, r["version"])
        assert (r["score"], r["reviewed_at"] > old) == (4, True)
        data = ctx.one(
            "SELECT data FROM activity WHERE kind='risk.updated' AND data ? 'score_from'"
        )
        assert data and (data["data"]["score_from"], data["data"]["score_to"]) == (12, 4)

        # "Revisado" sem mudança registra a revisão (e nada mais).
        ctx.run(
            "UPDATE project_risks SET reviewed_at = now() - interval '40 days' WHERE id=%s",
            (r["id"],),
        )
        before = risks.list_risks(ctx, s["pid"])["risks"][0]
        after = risks.update_risk(ctx, s["pid"], r["id"], {}, reviewed=True)
        assert after["reviewed_at"] > before["reviewed_at"]
        assert after["version"] == before["version"] + 1

        # Mesma avaliação de novo não gera versão nem atividade.
        same = risks.update_risk(ctx, s["pid"], r["id"], {"probability": 1, "affects": []})
        assert same["version"] == after["version"]


def test_edicao_concorrente_e_recusada(setup):
    s = setup
    with uow(s["gp"]["id"]) as ctx:
        r = _new(ctx, s["pid"])
        risks.update_risk(ctx, s["pid"], r["id"], {"status": "responding"}, r["version"])
    with uow(s["membro"]["id"]) as ctx, pytest.raises(ConflictError, match="outra pessoa"):
        risks.update_risk(ctx, s["pid"], r["id"], {"impact": 1}, r["version"])


def test_time_registra_so_quem_gerencia_exclui_e_leitor_so_le(setup):
    s = setup
    with uow(s["membro"]["id"]) as ctx:
        r = _new(ctx, s["pid"])
        listed = risks.list_risks(ctx, s["pid"])
        assert (listed["can_write"], listed["can_manage"]) == (True, False)
        risks.update_risk(ctx, s["pid"], r["id"], {"status": "closed"})
    with uow(s["membro"]["id"]) as ctx, pytest.raises(ForbiddenError):
        risks.delete_risk(ctx, s["pid"], r["id"])
    with uow(s["leitor"]["id"]) as ctx:
        listed = risks.list_risks(ctx, s["pid"])
        assert listed["can_write"] is False and len(listed["risks"]) == 1
    with uow(s["leitor"]["id"]) as ctx, pytest.raises(ForbiddenError):
        _new(ctx, s["pid"])
    with uow(s["leitor"]["id"]) as ctx, pytest.raises(ForbiddenError):
        risks.update_risk(ctx, s["pid"], r["id"], {"impact": 1})


def test_acesso_cruzado_responde_igual_a_inexistente(setup):
    s = setup
    fora = make_user("fora")
    outro_ws = make_team(fora)
    outro = make_project(fora, outro_ws, "Alheio")
    with uow(s["gp"]["id"]) as ctx:
        r = _new(ctx, s["pid"])
    with uow(fora["id"]) as ctx, pytest.raises(ForbiddenError):
        risks.list_risks(ctx, s["pid"])
    with uow(fora["id"]) as ctx, pytest.raises(ForbiddenError):
        _new(ctx, s["pid"])
    # Nem altera o risco alheio passando pelo próprio projeto (ID de outro projeto = inexistente).
    with uow(fora["id"]) as ctx, pytest.raises(ForbiddenError):
        risks.update_risk(ctx, outro, r["id"], {"impact": 1})
    with uow(fora["id"]) as ctx, pytest.raises(ForbiddenError):
        risks.delete_risk(ctx, outro, r["id"])
    with uow(s["gp"]["id"]) as ctx, pytest.raises(ForbiddenError):
        risks.update_risk(ctx, s["pid"], "nao-e-uuid", {"impact": 1})


def test_rotas_http(monkeypatch):
    gia = install_fake_gia(monkeypatch)
    gia.add("ana", email="ana@ex.com", name="Ana")
    c = TestClient(app, headers={"X-Requested-With": "projeta-web"})
    assert (
        c.post("/api/v1/auth/login", json={"matricula": "ana", "password": "senha-gia"}).status_code
        == 200
    )
    ws = c.get("/api/v1/me").json()["workspaces"][0]["id"]
    pid = c.post("/api/v1/projects", json={"workspace_id": ws, "name": "Obra"}).json()["id"]

    r = c.post(
        f"/api/v1/projects/{pid}/risks",
        json={"title": "Chuva forte", "probability": 4, "impact": 5, "category": "external"},
    )
    assert r.status_code == 201, r.text
    rid = r.json()["id"]
    assert r.json()["score"] == 20
    assert c.post(f"/api/v1/projects/{pid}/risks", json={"title": "x"}).status_code == 422

    p = c.patch(
        f"/api/v1/projects/{pid}/risks/{rid}",
        json={"strategy": "mitigate", "response_due": "", "version": 1},
    )
    assert p.status_code == 200, p.text
    assert (p.json()["strategy"], p.json()["version"]) == ("mitigate", 2)
    assert c.patch(f"/api/v1/projects/{pid}/risks/{rid}", json={"version": 1}).status_code == 409

    listed = c.get(f"/api/v1/projects/{pid}/risks").json()
    assert [x["title"] for x in listed["risks"]] == ["Chuva forte"] and listed["can_manage"]
    assert c.delete(f"/api/v1/projects/{pid}/risks/{rid}").status_code == 204
    assert c.patch(f"/api/v1/projects/{pid}/risks/{rid}", json={"impact": 1}).status_code == 403
