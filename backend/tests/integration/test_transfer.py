"""Exportar um espaço e importá-lo em outro lugar: conteúdo fiel, IDs novos, acesso no servidor."""

import copy
import json

import pytest
from fastapi.testclient import TestClient

from helpers import install_fake_gia, join, make_project, make_team, make_user
from projeta.api.app import app
from projeta.db import uow
from projeta.errors import BadRequestError, ForbiddenError
from projeta.identity import workspaces
from projeta.work import comments, formal, projects, tasks, transfer

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 32


@pytest.fixture
def origem():
    gestor, ana = make_user("gestor"), make_user("ana")
    ws = make_team(gestor, "DISID")
    join(gestor, ws, ana, "member")
    pid = make_project(gestor, ws, "Portal", members=(ana,))
    with uow(gestor["id"]) as ctx:
        projects.update_project(
            ctx,
            pid,
            summary="Resumo",
            phase="planning",
            attributes=[{"name": "PDTI", "value": "Sim"}],
        )
        formal.save_term(ctx, pid, "tap", {"objetivos": "Modernizar"}, 0)
        formal.add_status_note(ctx, pid, "on_track", done="Kickoff")
        mae = tasks.create_task(
            ctx,
            ws,
            pid,
            {
                "title": "Mãe",
                "start_date": "2026-11-20",
                "due_date": "2026-12-01",
                "assignee_id": ana["id"],
            },
        )["id"]
        filha = tasks.create_task(ctx, ws, pid, {"title": "Filha", "parent_id": mae})["id"]
        outra = tasks.create_task(ctx, ws, pid, {"title": "Outra"})["id"]
        tasks.add_dependency(ctx, outra, mae)
        tasks.create_task(ctx, ws, None, {"title": "Pessoal do gestor"})
        ctx.run(
            "INSERT INTO project_covers(project_id, content_type, data) VALUES (%s,'image/png',%s)",
            (pid, PNG),
        )
    with uow(ana["id"]) as ctx:
        comments.add_comment(ctx, filha, "Comentário da Ana")
        tasks.create_task(ctx, ws, None, {"title": "Pessoal da Ana"})
    return {"gestor": gestor, "ana": ana, "ws": ws, "pid": pid}


def _by(doc: dict, title: str) -> dict:
    return next(t for t in doc["tasks"] if t["title"] == title)


def _export(o) -> bytes:
    with uow(o["gestor"]["id"]) as ctx:
        return json.dumps(transfer.export_workspace(ctx, o["ws"])).encode()


def test_so_o_gestor_exporta(origem):
    with uow(origem["ana"]["id"]) as ctx, pytest.raises(ForbiddenError):
        transfer.export_workspace(ctx, origem["ws"])
    intruso = make_user("intruso")
    with uow(intruso["id"]) as ctx, pytest.raises(ForbiddenError):
        transfer.export_workspace(ctx, origem["ws"])


def test_exportacao_nao_leva_tarefa_pessoal_alheia(origem):
    doc = json.loads(_export(origem))
    titles = {t["title"] for t in doc["tasks"]}
    assert "Pessoal do gestor" in titles
    assert "Pessoal da Ana" not in titles


def test_ida_e_volta_cria_espaco_novo_fiel(origem):
    raw = _export(origem)
    with uow(origem["gestor"]["id"]) as ctx:
        out = transfer.import_workspace(ctx, raw, name="DISID (prod)")
    ws = out["workspace_id"]
    assert ws != origem["ws"]
    assert out["projects"] == 1 and out["tasks"] == 4 and out["comments"] == 1
    with uow(origem["gestor"]["id"]) as ctx:
        mine = next(w for w in workspaces.list_my_workspaces(ctx) if w["id"] == ws)
        assert mine["name"] == "DISID (prod)" and mine["role"] == "admin"
        [p] = projects.list_projects(ctx, ws)
        assert p["id"] != origem["pid"]
        d = projects.get_project(ctx, p["id"])
        assert d["project"]["summary"] == "Resumo" and d["project"]["phase"] == "planning"
        assert d["project"]["attributes"] == [{"name": "PDTI", "value": "Sim"}]
        assert formal.get_term(ctx, p["id"], "tap")["content"] == {"objetivos": "Modernizar"}
        rows = {t["title"]: t for t in tasks.list_project_tasks(ctx, p["id"])}
        assert rows["Filha"]["parent_id"] == rows["Mãe"]["id"]
        assert rows["Mãe"]["due_date"] == "2026-12-01"
        assert rows["Mãe"]["start_date"] == "2026-11-20"
        # Ana existe nesta instalação: volta como membro e responsável.
        assert rows["Mãe"]["assignee_id"] == origem["ana"]["id"]
        deps = tasks.get_task(ctx, rows["Outra"]["id"])["depends_on"]
        assert [x["id"] for x in deps] == [rows["Mãe"]["id"]]
        cover = ctx.one("SELECT data FROM project_covers WHERE project_id=%s", (p["id"],))
        assert bytes(cover["data"]) == PNG
    with uow(origem["ana"]["id"]) as ctx:
        [c] = comments.list_comments(ctx, rows["Filha"]["id"])
        assert c["body"] == "Comentário da Ana" and c["author_id"] == origem["ana"]["id"]


def test_pessoa_sem_conta_vira_convite_e_comentario_fica_com_quem_importa(origem):
    doc = json.loads(_export(origem))
    for p in doc["people"]:
        if p["matricula"] == "ANA":
            p["matricula"] = "NOVA9"
            p["name"] = "Nova Pessoa"
    prod = make_user("prod")
    doc["exporter"] = next(p["ref"] for p in doc["people"] if p["matricula"] == "GESTOR")
    with uow(prod["id"]) as ctx:
        out = transfer.import_workspace(ctx, json.dumps(doc).encode())
    assert out["people_missing"] == ["Nova Pessoa"] and out["people_invited"] == 1
    with uow(prod["id"]) as ctx:
        [p] = projects.list_projects(ctx, out["workspace_id"])
        assert (
            ctx.one("SELECT matricula FROM project_invites WHERE project_id=%s", (p["id"],))[
                "matricula"
            ]
            == "NOVA9"
        )
        filha = next(t for t in tasks.list_project_tasks(ctx, p["id"]) if t["title"] == "Filha")
        [c] = comments.list_comments(ctx, filha["id"])
        assert c["author_id"] == prod["id"]
        assert c["body"].startswith("[Comentário original de Nova Pessoa]")


def test_importar_em_espaco_existente_exige_ser_gestor_de_la(origem):
    raw = _export(origem)
    outro = make_user("outro")
    destino = make_team(outro, "Destino")
    with uow(origem["gestor"]["id"]) as ctx, pytest.raises(ForbiddenError):
        transfer.import_workspace(ctx, raw, workspace_id=destino)
    join(outro, destino, origem["gestor"], "manager")
    with uow(origem["gestor"]["id"]) as ctx, pytest.raises(ForbiddenError):
        transfer.import_workspace(ctx, raw, workspace_id=destino)
    with uow(outro["id"]) as ctx:
        projects.create_project(ctx, destino, "Já existia")
        out = transfer.import_workspace(ctx, raw, workspace_id=destino)
        assert out["workspace_id"] == destino
        names = sorted(p["name"] for p in projects.list_projects(ctx, destino))
    assert names == ["Já existia", "Portal"]


@pytest.mark.parametrize(
    "mutate, msg",
    [
        (lambda d: d.update(format="outra.coisa"), "não é uma exportação"),
        (lambda d: d.update(version=99), "Versão"),
        (lambda d: d["tasks"][0].update(project="p999"), "não existe"),
        (lambda d: _by(d, "Mãe").update(depends_on=[_by(d, "Outra")["ref"]]), "ciclo"),
        (lambda d: d["tasks"][0].update(status="hackeado"), "Status"),
        (lambda d: d["projects"][0].update(cover={"data_base64": "PHN2Zz4="}), "Capa"),
    ],
)
def test_arquivo_adulterado_e_recusado_sem_gravar_nada(origem, mutate, msg):
    doc = json.loads(_export(origem))
    bad = copy.deepcopy(doc)
    mutate(bad)
    with uow(origem["gestor"]["id"]) as ctx:
        before = len(workspaces.list_my_workspaces(ctx))
    with pytest.raises(BadRequestError, match=msg), uow(origem["gestor"]["id"]) as ctx:
        transfer.import_workspace(ctx, json.dumps(bad).encode())
    with uow(origem["gestor"]["id"]) as ctx:
        assert len(workspaces.list_my_workspaces(ctx)) == before


def test_json_invalido(origem):
    with uow(origem["gestor"]["id"]) as ctx, pytest.raises(BadRequestError, match="JSON"):
        transfer.import_workspace(ctx, b"{nao e json")


def test_rotas_http_de_exportar_e_importar(monkeypatch):
    gia = install_fake_gia(monkeypatch)
    gia.add("ana", email="ana@ex.com", name="Ana")
    c = TestClient(app, headers={"X-Requested-With": "projeta-web"})
    assert (
        c.post("/api/v1/auth/login", json={"matricula": "ana", "password": "senha-gia"}).status_code
        == 200
    )
    ws = c.post("/api/v1/workspaces", json={"name": "DIRAU"}).json()["id"]
    c.post("/api/v1/projects", json={"workspace_id": ws, "name": "Contratos"})
    r = c.get(f"/api/v1/workspaces/{ws}/export")
    assert r.status_code == 200 and "attachment" in r.headers["content-disposition"]
    imp = c.post(
        "/api/v1/workspaces/import",
        params={"name": "DIRAU importado"},
        content=r.content,
        headers={"Content-Type": "application/json"},
    )
    assert imp.status_code == 201, imp.text
    assert imp.json()["projects"] == 1
    bad = c.post(
        "/api/v1/workspaces/import", content=b"[]", headers={"Content-Type": "application/json"}
    )
    assert bad.status_code == 400
