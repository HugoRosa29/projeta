"""Perfil: cada pessoa vê os próprios dados, inclusive a unidade e os espaços de que participa."""

from fastapi.testclient import TestClient

from projeta.api.app import app
from projeta.db import uow
from projeta.identity import auth, workspaces
from tests.helpers import NOBODY, make_user

DIRAU_HEAD = "Daniel Reis Santos"
GIA_DIRAU = "DIRAU - DIRAU - DIVISÃO DE INFRAESTRUT DE REDES E ATEND AO USUARIO"


def _profile(user: dict) -> dict:
    with uow(user["id"]) as ctx:
        return workspaces.my_profile(ctx)


def test_perfil_mostra_lotacao_unidade_e_papel_no_espaco_oficial():
    p = _profile(make_user("dirau1", allotment=GIA_DIRAU, full_name=DIRAU_HEAD))
    assert p["matricula"] == "DIRAU1"
    assert p["name"] == DIRAU_HEAD
    assert p["allotment"] == GIA_DIRAU
    assert p["origin"] == "gia"
    assert p["unit"] == {"sigla": "DIRAU", "label": "DIRAU"}
    assert p["heads_of"] == [{"sigla": "DIRAU", "label": "DIRAU"}]
    official = next(w for w in p["workspaces"] if w["org_unit"] == "DIRAU")
    assert official["role"] == "admin"
    assert {"gia_code", "password_hash"}.isdisjoint(p)


def test_perfil_de_conta_local_sem_lotacao_nem_titularidade():
    with uow(NOBODY) as ctx:
        local = auth.register(ctx, DIRAU_HEAD, "daniel@ex.com", "senha-forte-1")
    p = _profile(local)
    assert p["origin"] == "local"
    assert p["matricula"] is None and p["unit"] is None
    # Nome igual ao do titular não basta sem matrícula do GIA (ADR 0007).
    assert p["heads_of"] == []
    assert [w["kind"] for w in p["workspaces"]] == ["personal"]


def test_rota_devolve_so_o_perfil_de_quem_esta_na_sessao(monkeypatch):
    ana = make_user("ana", allotment="DISID")
    make_user("beto", allotment="DISID")
    monkeypatch.setattr(auth, "user_from_token", lambda ctx, tok: ana)
    c = TestClient(app)
    c.headers["x-requested-with"] = "projeta-web"
    r = c.get("/api/v1/me/profile")
    assert r.status_code == 200, r.text
    assert r.json()["matricula"] == "ANA"
    monkeypatch.setattr(auth, "user_from_token", lambda ctx, tok: None)
    assert c.get("/api/v1/me/profile").status_code == 401
