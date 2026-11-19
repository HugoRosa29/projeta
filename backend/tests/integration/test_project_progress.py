"""Percentual concluído informado (como o "% Terminado" do Redmine)."""

import pytest
from fastapi.testclient import TestClient

from helpers import install_fake_gia
from projeta.api.app import app
from projeta.db import uow
from projeta.errors import BadRequestError, ForbiddenError
from projeta.work import formal, projects
from tests.helpers import join, make_team, make_user


def test_informar_manter_e_voltar_ao_calculo():
    gp, leitor = make_user("gp"), make_user("leitor")
    ws = make_team(gp)
    join(gp, ws, leitor, "viewer")
    with uow(gp["id"]) as ctx:
        p = projects.create_project(ctx, ws, "Venda Direta")
        assert p["progress"] is None
        projects.add_project_member(ctx, p["id"], leitor["id"])
        assert projects.update_project(ctx, p["id"], progress=90)["progress"] == 90
        assert projects.update_project(ctx, p["id"], summary="x")["progress"] == 90
        assert projects.list_projects(ctx, ws)[0]["progress"] == 90
        assert formal.portfolio(ctx, ws)[0]["progress"] == 90
        assert projects.update_project(ctx, p["id"], clear_progress=True)["progress"] is None
        kinds = [a["kind"] for a in projects.get_project(ctx, p["id"])["activity"]]
        assert kinds.count("project.progress_set") == 2
        with pytest.raises(BadRequestError):
            projects.update_project(ctx, p["id"], progress=101)
    with pytest.raises(ForbiddenError), uow(leitor["id"]) as ctx:
        projects.update_project(ctx, p["id"], progress=10)


def test_http_null_explicito_limpa_e_ausente_mantem(monkeypatch):
    gia = install_fake_gia(monkeypatch)
    gia.add("ana", email="ana@ex.com", name="Ana")
    c = TestClient(app, headers={"X-Requested-With": "projeta-web"})
    assert (
        c.post("/api/v1/auth/login", json={"matricula": "ana", "password": "senha-gia"}).status_code
        == 200
    )
    ws = c.get("/api/v1/me").json()["workspaces"][0]["id"]
    pid = c.post("/api/v1/projects", json={"workspace_id": ws, "name": "ERP"}).json()["id"]
    assert c.patch(f"/api/v1/projects/{pid}", json={"progress": 60}).json()["progress"] == 60
    assert c.patch(f"/api/v1/projects/{pid}", json={"summary": "s"}).json()["progress"] == 60
    assert c.patch(f"/api/v1/projects/{pid}", json={"progress": None}).json()["progress"] is None
    assert c.patch(f"/api/v1/projects/{pid}", json={"progress": 150}).status_code == 422
