"""Sprints: quem gere planeja, inicia e encerra; quem edita tarefas monta a sprint (ADR 0006)."""

import json
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from projeta.api.app import app
from projeta.db import uow
from projeta.errors import BadRequestError, ConflictError, ForbiddenError
from projeta.work import sprints, tasks, today, transfer
from tests.helpers import join, make_project, make_team, make_user

TODAY = "2026-11-24"


def _d(days: int) -> str:
    return (date.fromisoformat(TODAY) + timedelta(days=days)).isoformat()


@pytest.fixture
def team():
    gestor, gp, membro, leitor, fora = (
        make_user(n) for n in ("gestor", "gp", "membro", "leitor", "fora")
    )
    ws = make_team(gestor)
    join(gestor, ws, gp, "manager")
    join(gestor, ws, membro, "member")
    join(gestor, ws, leitor, "viewer")
    pid = make_project(gestor, ws, "Portal", members=(gp, membro, leitor))
    return {"gestor": gestor, "gp": gp, "membro": membro, "leitor": leitor, "fora": fora,
            "ws": ws, "pid": pid}  # fmt: skip


def _new(user, pid, **fields):
    with uow(user["id"]) as ctx:
        return sprints.create_sprint(ctx, pid, fields, TODAY)


def _task(user, ws, pid, title, **fields):
    with uow(user["id"]) as ctx:
        return tasks.create_task(ctx, ws, pid, {"title": title, **fields})


def _move(user, task_id, sprint_id):
    with uow(user["id"]) as ctx:
        return tasks.update_task(ctx, task_id, {"sprint_id": sprint_id})


def _list(user, pid, today=TODAY):
    with uow(user["id"]) as ctx:
        return sprints.list_sprints(ctx, pid, today)


def test_proxima_sprint_segue_a_cadencia(team):
    s1 = _new(team["gp"], team["pid"])
    assert (s1["name"], s1["start_date"], s1["end_date"]) == ("Sprint 1", TODAY, _d(13))
    s2 = _new(team["gp"], team["pid"])
    assert (s2["name"], s2["start_date"], s2["end_date"]) == ("Sprint 2", _d(14), _d(27))
    curta = _new(team["gp"], team["pid"], start_date=_d(28), end_date=_d(34))
    s4 = _new(team["gp"], team["pid"])
    assert curta["number"] == 3
    assert (s4["start_date"], s4["end_date"]) == (_d(35), _d(41))  # mesma duração da última


def test_datas_sobrepostas_ou_longas_demais_sao_recusadas(team):
    _new(team["gp"], team["pid"])
    with pytest.raises(BadRequestError, match="sobrepõem à Sprint 1"):
        _new(team["gp"], team["pid"], start_date=_d(5), end_date=_d(20))
    with pytest.raises(BadRequestError, match="até 31 dias"):
        _new(team["gp"], team["pid"], start_date=_d(40), end_date=_d(80))
    with pytest.raises(BadRequestError, match="depois"):
        _new(team["gp"], team["pid"], start_date=_d(40), end_date=_d(39))


def test_quem_gere_planeja_e_quem_edita_tarefa_monta_a_sprint(team):
    with pytest.raises(ForbiddenError):
        _new(team["membro"], team["pid"])
    s = _new(team["gp"], team["pid"], goal="Publicar a busca")
    t = _task(team["membro"], team["ws"], team["pid"], "Indexar")
    moved = _move(team["membro"], t["id"], str(s["id"]))
    assert (str(moved["sprint_id"]), moved["sprint_name"]) == (str(s["id"]), "Sprint 1")
    with pytest.raises(ForbiddenError):
        _move(team["leitor"], t["id"], None)
    with uow(team["membro"]["id"]) as ctx, pytest.raises(ForbiddenError):
        sprints.start_sprint(ctx, str(s["id"]), TODAY)
    data = _list(team["leitor"], team["pid"])
    assert data["can_manage"] is False and data["sprints"][0]["stats"]["tasks"] == 1
    with pytest.raises(ForbiddenError):
        _list(team["fora"], team["pid"])


def test_sprint_de_outro_projeto_responde_como_inexistente(team):
    outro = make_project(team["gestor"], team["ws"], "Outro", members=(team["gp"],))
    alheia = _new(team["gp"], outro)
    t = _task(team["gp"], team["ws"], team["pid"], "Tarefa")
    with pytest.raises(ForbiddenError):
        _move(team["gp"], t["id"], str(alheia["id"]))
    with pytest.raises(ForbiddenError):
        _move(team["gp"], t["id"], "00000000-0000-0000-0000-000000000000")
    with uow(team["fora"]["id"]) as ctx, pytest.raises(ForbiddenError):
        sprints.update_sprint(ctx, str(alheia["id"]), {"goal": "x"})


def test_subtarefa_acompanha_a_tarefa_mae(team):
    s = _new(team["gp"], team["pid"])
    mae = _task(team["gp"], team["ws"], team["pid"], "Mãe")
    filha = _task(team["gp"], team["ws"], team["pid"], "Filha", parent_id=mae["id"])
    _move(team["gp"], mae["id"], str(s["id"]))
    with uow(team["gp"]["id"]) as ctx:
        assert str(tasks.get_task(ctx, filha["id"])["task"]["sprint_id"]) == str(s["id"])
    with pytest.raises(BadRequestError, match="acompanha a sprint da tarefa-mãe"):
        _move(team["gp"], filha["id"], None)
    # Nova subtarefa nasce na sprint da mãe; tarefa que vira subtarefa também passa para ela.
    neta = _task(team["gp"], team["ws"], team["pid"], "Nova", parent_id=mae["id"])
    assert str(neta["sprint_id"]) == str(s["id"])
    solta = _task(team["gp"], team["ws"], team["pid"], "Solta")
    with uow(team["gp"]["id"]) as ctx:
        virou = tasks.update_task(ctx, solta["id"], {"parent_id": mae["id"]})
    assert str(virou["sprint_id"]) == str(s["id"])


def test_iniciar_exige_meta_e_uma_sprint_ativa_por_vez(team):
    s1 = _new(team["gp"], team["pid"])
    s2 = _new(team["gp"], team["pid"], goal="Depois")
    with uow(team["gp"]["id"]) as ctx, pytest.raises(BadRequestError, match="meta"):
        sprints.start_sprint(ctx, str(s1["id"]), TODAY)
    with uow(team["gp"]["id"]) as ctx:
        sprints.update_sprint(ctx, str(s1["id"]), {"goal": "Publicar a busca"})
        assert sprints.start_sprint(ctx, str(s1["id"]), TODAY)["status"] == "active"
    with uow(team["gp"]["id"]) as ctx, pytest.raises(ConflictError, match="Sprint 1"):
        sprints.start_sprint(ctx, str(s2["id"]), TODAY)
    with uow(team["gp"]["id"]) as ctx, pytest.raises(BadRequestError, match="fixas"):
        sprints.update_sprint(ctx, str(s1["id"]), {"end_date": _d(20)})


def test_encerrar_leva_o_que_sobrou_e_grava_o_relatorio(team):
    s = _new(team["gp"], team["pid"], goal="Publicar a busca", capacity_minutes=600)
    feita = _task(team["gp"], team["ws"], team["pid"], "Feita", estimate_minutes=120)
    aberta = _task(team["gp"], team["ws"], team["pid"], "Aberta", estimate_minutes=240)
    sub = _task(team["gp"], team["ws"], team["pid"], "Sub", parent_id=aberta["id"])
    saiu = _task(team["gp"], team["ws"], team["pid"], "Saiu")
    for t in (feita, aberta, saiu):
        _move(team["gp"], t["id"], str(s["id"]))
    with uow(team["gp"]["id"]) as ctx:
        sprints.start_sprint(ctx, str(s["id"]), TODAY)
    extra = _task(team["membro"], team["ws"], team["pid"], "Entrou no meio", sprint_id=str(s["id"]))
    _move(team["gp"], saiu["id"], None)
    with uow(team["gp"]["id"]) as ctx:
        tasks.update_task(ctx, feita["id"], {"status": "done"})
        r = sprints.close_sprint(ctx, str(s["id"]), "next", _d(9))
    closed, nxt = r["sprint"], r["next"]
    assert closed["status"] == "closed"
    assert closed["end_date"] == _d(9)  # encerrou antes: o fim passa a ser o dia do encerramento
    summ = closed["summary"]
    assert summ["committed"] == {"tasks": 4, "minutes": 360}  # feita, aberta, sub e saiu
    assert summ["added"] == {"tasks": 1, "minutes": 0}
    assert summ["removed"] == 1
    assert summ["done"] == {"tasks": 1, "minutes": 120}
    assert summ["not_done"]["tasks"] == 3
    assert summ["carried"] == {"to": "Sprint 2", "items": [
        {"id": str(aberta["id"]), "title": "Aberta"},
        {"id": str(extra["id"]), "title": "Entrou no meio"},
    ]}  # fmt: skip
    assert nxt["start_date"] == _d(10)
    with uow(team["gp"]["id"]) as ctx:
        for tid, where in (
            (feita["id"], s["id"]),
            (aberta["id"], nxt["id"]),
            (sub["id"], nxt["id"]),
        ):
            assert str(tasks.get_task(ctx, tid)["task"]["sprint_id"]) == str(where)
        with pytest.raises(BadRequestError, match="encerrada"):
            sprints.update_sprint(ctx, str(s["id"]), {"goal": "outra"})
        with pytest.raises(BadRequestError, match="encerrada"):
            tasks.update_task(ctx, saiu["id"], {"sprint_id": str(s["id"])})


def test_encerrar_para_o_backlog_e_excluir_planejada(team):
    s = _new(team["gp"], team["pid"], goal="Meta")
    t = _task(team["gp"], team["ws"], team["pid"], "Aberta", sprint_id=str(s["id"]))
    with uow(team["gp"]["id"]) as ctx:
        sprints.start_sprint(ctx, str(s["id"]), TODAY)
        with pytest.raises(BadRequestError, match="planejada"):
            sprints.delete_sprint(ctx, str(s["id"]))
        r = sprints.close_sprint(ctx, str(s["id"]), "backlog", _d(13))
        assert r["next"] is None and r["sprint"]["summary"]["carried"]["to"] is None
        assert tasks.get_task(ctx, t["id"])["task"]["sprint_id"] is None
        p = sprints.create_sprint(ctx, team["pid"], {}, TODAY)
        tasks.update_task(ctx, t["id"], {"sprint_id": str(p["id"])})
        sprints.delete_sprint(ctx, str(p["id"]))
        assert tasks.get_task(ctx, t["id"])["task"]["sprint_id"] is None


def test_lista_traz_calendario_e_carga_por_pessoa(team):
    s = _new(team["gp"], team["pid"], goal="Meta")
    _task(team["gp"], team["ws"], team["pid"], "A", sprint_id=str(s["id"]),
          assignee_id=team["membro"]["id"], estimate_minutes=90)  # fmt: skip
    _task(team["gp"], team["ws"], team["pid"], "B", sprint_id=str(s["id"]))
    _task(team["gp"], team["ws"], team["pid"], "No backlog")
    with uow(team["gp"]["id"]) as ctx:
        sprints.start_sprint(ctx, str(s["id"]), TODAY)
    data = _list(team["gp"], team["pid"], _d(4))
    sp = data["sprints"][0]
    assert (sp["days_total"], sp["days_elapsed"], sp["days_left"]) == (14, 5, 9)
    assert sp["stats"] == {
        "tasks": 2,
        "done": 0,
        "minutes": 90,
        "done_minutes": 0,
        "unestimated": 1,
    }
    assert sp["load"][0]["name"] == "membro" and sp["load"][0]["open_minutes"] == 90
    assert data["backlog_open"] == 1
    assert _list(team["gp"], team["pid"], _d(20))["sprints"][0]["overdue"] is True


def test_prioridade_urgente_vem_antes_da_alta(team):
    with uow(team["membro"]["id"]) as ctx:
        tasks.create_task(ctx, team["ws"], None, {"title": "Alta", "priority": "high"})
        tasks.create_task(ctx, team["ws"], None, {"title": "Urgente", "priority": "urgent"})
        d = today.get_today(ctx, team["ws"], "America/Sao_Paulo")
    assert [t["title"] for t in d["priorities"]] == ["Urgente", "Alta"]


def test_exportar_e_importar_levam_as_sprints(team):
    s = _new(team["gp"], team["pid"], goal="Meta", capacity_minutes=300)
    mae = _task(team["gp"], team["ws"], team["pid"], "Mãe", sprint_id=str(s["id"]))
    _task(team["gp"], team["ws"], team["pid"], "Filha", parent_id=mae["id"])
    with uow(team["gp"]["id"]) as ctx:
        sprints.start_sprint(ctx, str(s["id"]), TODAY)
    with uow(team["gestor"]["id"]) as ctx:
        raw = json.dumps(transfer.export_workspace(ctx, team["ws"]), default=str).encode()
        out = transfer.import_workspace(ctx, raw, name="Cópia")
    assert out["sprints"] == 1
    with uow(team["gestor"]["id"]) as ctx:
        pid = ctx.one("SELECT id FROM projects WHERE workspace_id=%s", (out["workspace_id"],))["id"]
        data = sprints.list_sprints(ctx, str(pid), TODAY)
    sp = data["sprints"][0]
    assert (sp["status"], sp["goal"], sp["capacity_minutes"]) == ("active", "Meta", 300)
    assert sp["stats"]["tasks"] == 2  # a filha acompanha a mãe


def test_rotas_http(team, monkeypatch):
    from projeta.identity import auth

    c = TestClient(app)
    c.headers["x-requested-with"] = "projeta-web"
    tz = {"timezone": "America/Sao_Paulo"}
    monkeypatch.setattr(auth, "user_from_token", lambda ctx, tok: team["gp"] | tz)
    r = c.post(f"/api/v1/projects/{team['pid']}/sprints", json={"goal": "Meta"})
    assert r.status_code == 201, r.text
    sid = r.json()["id"]
    assert c.post(f"/api/v1/sprints/{sid}/start").status_code == 200
    listed = c.get(f"/api/v1/projects/{team['pid']}/sprints").json()
    assert listed["sprints"][0]["status"] == "active"
    assert c.post(f"/api/v1/sprints/{sid}/close", json={"carry_to": "lixo"}).status_code == 422
    r = c.post(f"/api/v1/sprints/{sid}/close", json={"carry_to": "backlog"})
    assert r.status_code == 200 and r.json()["sprint"]["status"] == "closed"
    monkeypatch.setattr(auth, "user_from_token", lambda ctx, tok: team["membro"] | tz)
    assert c.post(f"/api/v1/projects/{team['pid']}/sprints", json={}).status_code == 403
