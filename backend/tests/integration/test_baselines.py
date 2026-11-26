"""Linhas de base: a inicial nasce com o projeto e guarda o primeiro plano; as outras são fotos."""

import pytest
from fastapi.testclient import TestClient

from projeta.api.app import app
from projeta.db import uow
from projeta.errors import BadRequestError, ForbiddenError
from projeta.work import baselines, tasks
from tests.helpers import install_fake_gia, join, make_project, make_team, make_user


@pytest.fixture
def setup():
    gp, membro, leitor = make_user("gp"), make_user("membro"), make_user("leitor")
    ws = make_team(gp)
    join(gp, ws, membro, "member")
    join(gp, ws, leitor, "viewer")
    pid = make_project(gp, ws, "Portal", members=(membro, leitor))
    return {"gp": gp, "membro": membro, "leitor": leitor, "ws": ws, "pid": pid}


def _items(ctx, pid: str, bid: str) -> dict[str, tuple]:
    b = baselines.get_baseline(ctx, pid, bid)
    return {t["title"]: (t["start_date"], t["due_date"]) for t in b["tasks"]}


def test_projeto_nasce_com_a_inicial_que_guarda_o_primeiro_plano(setup):
    s = setup
    with uow(s["membro"]["id"]) as ctx:
        listed = baselines.list_baselines(ctx, s["pid"])["baselines"]
        assert [(b["number"], b["name"], b["task_count"]) for b in listed] == [
            (0, "Linha de base inicial", 0)
        ]
        initial = listed[0]["id"]
        a = tasks.create_task(
            ctx,
            s["ws"],
            s["pid"],
            {"title": "A", "start_date": "2026-12-01", "due_date": "2026-12-05"},
        )
        sem_prazo = tasks.create_task(ctx, s["ws"], s["pid"], {"title": "B"})
        assert _items(ctx, s["pid"], initial) == {"A": ("2026-12-01", "2026-12-05")}

        # Replanejar não reescreve o plano original.
        tasks.update_task(ctx, a["id"], {"due_date": "2026-12-09"}, a["version"])
        # A tarefa que ganha prazo depois entra com esse primeiro prazo.
        b = tasks.update_task(
            ctx, sem_prazo["id"], {"due_date": "2026-12-20"}, sem_prazo["version"]
        )
        tasks.update_task(ctx, b["id"], {"due_date": "2026-12-28"}, b["version"])
        assert _items(ctx, s["pid"], initial) == {
            "A": ("2026-12-01", "2026-12-05"),
            "B": (None, "2026-12-20"),
        }


def test_nova_linha_de_base_fotografa_o_atual_e_numera_em_sequencia(setup):
    s = setup
    with uow(s["gp"]["id"]) as ctx:
        a = tasks.create_task(ctx, s["ws"], s["pid"], {"title": "A", "due_date": "2026-12-05"})
        b1 = baselines.create_baseline(ctx, s["pid"], note="Plano aprovado no comitê")
        assert (b1["number"], b1["name"], b1["task_count"]) == (1, "Linha de base 1", 1)
        assert b1["note"] == "Plano aprovado no comitê" and b1["finish"] == "2026-12-05"

        tasks.update_task(ctx, a["id"], {"due_date": "2026-12-15"}, a["version"])
        b2 = baselines.create_baseline(ctx, s["pid"], "  Replanejamento   de janeiro ")
        assert (b2["number"], b2["name"]) == (2, "Replanejamento de janeiro")
        assert _items(ctx, s["pid"], b2["id"]) == {"A": (None, "2026-12-15")}
        assert _items(ctx, s["pid"], b1["id"]) == {"A": (None, "2026-12-05")}

        # Excluir não reaproveita o número: "LB 2" continua sendo a mesma foto para todos.
        baselines.delete_baseline(ctx, s["pid"], b2["id"])
        assert baselines.create_baseline(ctx, s["pid"])["number"] == 2
        kinds = [
            r["kind"] for r in ctx.all("SELECT kind FROM activity WHERE project_id=%s", (s["pid"],))
        ]
        assert kinds.count("baseline.created") == 3 and kinds.count("baseline.deleted") == 1


def test_tarefa_excluida_continua_na_foto(setup):
    s = setup
    with uow(s["gp"]["id"]) as ctx:
        t = tasks.create_task(ctx, s["ws"], s["pid"], {"title": "Some", "due_date": "2026-12-05"})
        b = baselines.create_baseline(ctx, s["pid"])
        tasks.delete_task(ctx, t["id"])
        assert _items(ctx, s["pid"], b["id"]) == {"Some": (None, "2026-12-05")}


def test_regras_de_criacao_e_exclusao(setup):
    s = setup
    with uow(s["gp"]["id"]) as ctx, pytest.raises(BadRequestError, match="prazo"):
        baselines.create_baseline(ctx, s["pid"])
    with uow(s["gp"]["id"]) as ctx:
        tasks.create_task(ctx, s["ws"], s["pid"], {"title": "A", "due_date": "2026-12-05"})
        initial = baselines.list_baselines(ctx, s["pid"])["baselines"][0]["id"]
    with uow(s["gp"]["id"]) as ctx, pytest.raises(BadRequestError, match="inicial"):
        baselines.delete_baseline(ctx, s["pid"], initial)
    with uow(s["gp"]["id"]) as ctx, pytest.raises(BadRequestError, match="caracteres"):
        baselines.create_baseline(ctx, s["pid"], "x" * (baselines.NAME_MAX + 1))


def test_so_quem_gerencia_salva_e_exclui_e_quem_le_compara(setup):
    s = setup
    with uow(s["gp"]["id"]) as ctx:
        tasks.create_task(ctx, s["ws"], s["pid"], {"title": "A", "due_date": "2026-12-05"})
        b = baselines.create_baseline(ctx, s["pid"])
    for who in ("membro", "leitor"):
        with uow(s[who]["id"]) as ctx:
            listed = baselines.list_baselines(ctx, s["pid"])
            assert listed["can_manage"] is False and len(listed["baselines"]) == 2
            assert _items(ctx, s["pid"], b["id"]) == {"A": (None, "2026-12-05")}
        with uow(s[who]["id"]) as ctx, pytest.raises(ForbiddenError):
            baselines.create_baseline(ctx, s["pid"])
        with uow(s[who]["id"]) as ctx, pytest.raises(ForbiddenError):
            baselines.delete_baseline(ctx, s["pid"], b["id"])


def test_acesso_cruzado_responde_igual_a_inexistente(setup):
    s = setup
    fora = make_user("fora")
    outro_ws = make_team(fora)
    outro = make_project(fora, outro_ws, "Alheio")
    with uow(s["gp"]["id"]) as ctx:
        tasks.create_task(ctx, s["ws"], s["pid"], {"title": "A", "due_date": "2026-12-05"})
        b = baselines.create_baseline(ctx, s["pid"])
    # Quem é de fora não lista, não lê e não cria no projeto alheio.
    with uow(fora["id"]) as ctx, pytest.raises(ForbiddenError):
        baselines.list_baselines(ctx, s["pid"])
    with uow(fora["id"]) as ctx, pytest.raises(ForbiddenError):
        baselines.get_baseline(ctx, s["pid"], b["id"])
    with uow(fora["id"]) as ctx, pytest.raises(ForbiddenError):
        baselines.create_baseline(ctx, s["pid"])
    # Nem lê a foto alheia passando pelo próprio projeto (ID de outro projeto = inexistente).
    with uow(fora["id"]) as ctx, pytest.raises(ForbiddenError):
        baselines.get_baseline(ctx, outro, b["id"])
    with uow(fora["id"]) as ctx, pytest.raises(ForbiddenError):
        baselines.delete_baseline(ctx, outro, b["id"])
    with uow(s["gp"]["id"]) as ctx, pytest.raises(ForbiddenError):
        baselines.get_baseline(ctx, s["pid"], "nao-e-uuid")


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
    c.post(
        "/api/v1/tasks",
        json={"workspace_id": ws, "project_id": pid, "title": "A", "due_date": "2026-12-05"},
    )

    r = c.post(f"/api/v1/projects/{pid}/baselines", json={"name": "Aprovada"})
    assert r.status_code == 201, r.text
    bid = r.json()["id"]
    listed = c.get(f"/api/v1/projects/{pid}/baselines").json()
    assert [b["name"] for b in listed["baselines"]] == ["Linha de base inicial", "Aprovada"]
    assert listed["can_manage"] is True
    detail = c.get(f"/api/v1/projects/{pid}/baselines/{bid}").json()
    assert detail["tasks"][0]["due_date"] == "2026-12-05"
    assert c.delete(f"/api/v1/projects/{pid}/baselines/{bid}").status_code == 204
    assert c.get(f"/api/v1/projects/{pid}/baselines/{bid}").status_code == 403
