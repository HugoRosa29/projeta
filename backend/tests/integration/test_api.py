"""A mesma jornada pela API HTTP: cookie de sessão, CSRF e acesso negado por ID conhecido."""

import pytest
from fastapi.testclient import TestClient

from helpers import install_fake_gia
from projeta.api.app import app

H = {"X-Requested-With": "projeta-web"}


@pytest.fixture
def make_client(monkeypatch):
    clients: list[TestClient] = []
    gia = install_fake_gia(monkeypatch)

    def _make(name: str) -> TestClient:
        gia.add(name, email=f"{name}@ex.com", name=name.title())
        c = TestClient(app, headers=H)
        r = c.post("/api/v1/auth/login", json={"matricula": name, "password": "senha-gia"})
        assert r.status_code == 200, r.text
        clients.append(c)
        return c

    yield _make


def personal_ws(c: TestClient) -> str:
    return c.get("/api/v1/me").json()["workspaces"][0]["id"]


def test_csrf_e_sessao_obrigatorios(monkeypatch):
    install_fake_gia(monkeypatch)
    c = TestClient(app)
    assert c.post("/api/v1/auth/login", json={"matricula": "a", "password": "x"}).status_code == 403
    c = TestClient(app, headers=H)
    assert c.get("/api/v1/me").status_code == 401
    assert c.post("/api/v1/auth/login", json={"matricula": "a", "password": "x"}).status_code == 401


def test_jornada_http_com_terceira_conta_negada(make_client):
    ana, bia, eva = make_client("ana"), make_client("bia"), make_client("eva")
    # Ana cria espaço de equipe, convida Bia, cria projeto e tarefa
    ws = ana.post("/api/v1/workspaces", json={"name": "Agência"}).json()["id"]
    inv = ana.post(
        f"/api/v1/workspaces/{ws}/invitations", json={"email": "bia@ex.com", "role": "member"}
    )
    assert inv.status_code == 201
    assert (
        bia.post("/api/v1/invitations/accept", json={"token": inv.json()["token"]}).status_code
        == 200
    )
    pid = ana.post("/api/v1/projects", json={"workspace_id": ws, "name": "Site"}).json()["id"]
    bia_id = bia.get("/api/v1/me").json()["user"]["id"]
    assert ana.post(f"/api/v1/projects/{pid}/members", json={"user_id": bia_id}).status_code == 204

    t = ana.post("/api/v1/tasks", json={"workspace_id": ws, "project_id": pid, "title": "Briefing"})
    assert t.status_code == 201
    tid = t.json()["id"]

    # Bia vê e move no quadro
    assert bia.patch(f"/api/v1/tasks/{tid}", json={"status": "doing"}).json()["status"] == "doing"
    lst = ana.get(f"/api/v1/projects/{pid}/tasks").json()["tasks"]
    assert [(x["title"], x["status"]) for x in lst] == [("Briefing", "doing")]

    # Eva (outro espaço) conhece os IDs e é negada em tudo
    for method, url, body in (
        ("get", f"/api/v1/tasks/{tid}", None),
        ("patch", f"/api/v1/tasks/{tid}", {"title": "x"}),
        ("delete", f"/api/v1/tasks/{tid}", None),
        ("get", f"/api/v1/projects/{pid}", None),
        ("get", f"/api/v1/projects/{pid}/tasks", None),
        ("get", f"/api/v1/projects?workspace_id={ws}", None),
        ("get", f"/api/v1/workspaces/{ws}/members", None),
        ("get", f"/api/v1/today?workspace_id={ws}", None),
    ):
        r = eva.request(method, url, json=body)
        assert r.status_code == 403, (method, url, r.status_code)


def test_conflito_de_versao_retorna_409_e_data_sem_horario(make_client):
    ana = make_client("ana")
    ws = personal_ws(ana)
    t = ana.post(
        "/api/v1/tasks", json={"workspace_id": ws, "title": "Pessoal", "due_date": "2026-05-01"}
    ).json()
    assert t["due_date"] == "2026-05-01"
    ok = ana.patch(
        f"/api/v1/tasks/{t['id']}", json={"title": "B", "expected_version": t["version"]}
    )
    assert ok.status_code == 200
    stale = ana.patch(
        f"/api/v1/tasks/{t['id']}", json={"title": "C", "expected_version": t["version"]}
    )
    assert stale.status_code == 409
    assert stale.json()["error"]["details"]["current"]["title"] == "B"
    # limpar prazo com null
    cleared = ana.patch(f"/api/v1/tasks/{t['id']}", json={"due_date": None}).json()
    assert cleared["due_date"] is None
