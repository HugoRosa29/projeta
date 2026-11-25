"""Cronograma da tarefa: data de início coerente com o prazo e dependências visíveis na lista."""

import pytest

from projeta.db import uow
from projeta.errors import BadRequestError, ForbiddenError
from projeta.work import tasks
from tests.helpers import join, make_project, make_team, make_user


@pytest.fixture
def setup():
    gp, membro, leitor = make_user("gp"), make_user("membro"), make_user("leitor")
    ws = make_team(gp)
    join(gp, ws, membro, "member")
    join(gp, ws, leitor, "viewer")
    pid = make_project(gp, ws, "Portal", members=(membro, leitor))
    return {"gp": gp, "membro": membro, "leitor": leitor, "ws": ws, "pid": pid}


def test_inicio_e_prazo_gravam_e_limpam(setup):
    s = setup
    with uow(s["membro"]["id"]) as ctx:
        t = tasks.create_task(
            ctx,
            s["ws"],
            s["pid"],
            {"title": "Levantar requisitos", "start_date": "2026-12-01", "due_date": "2026-12-10"},
        )
        assert (t["start_date"], t["due_date"]) == ("2026-12-01", "2026-12-10")
        t = tasks.update_task(ctx, t["id"], {"start_date": "2026-12-03"}, t["version"])
        assert t["start_date"] == "2026-12-03"
        # "" limpa a data, como nulo; sem início, o prazo pode ir para qualquer dia.
        t = tasks.update_task(ctx, t["id"], {"start_date": ""}, t["version"])
        assert t["start_date"] is None
        t = tasks.update_task(ctx, t["id"], {"due_date": "2026-11-01"}, t["version"])
        assert t["due_date"] == "2026-11-01"


def test_inicio_depois_do_prazo_e_recusado(setup):
    s = setup
    with uow(s["membro"]["id"]) as ctx, pytest.raises(BadRequestError, match="início"):
        tasks.create_task(
            ctx,
            s["ws"],
            s["pid"],
            {"title": "X", "start_date": "2026-12-11", "due_date": "2026-12-10"},
        )
    with uow(s["membro"]["id"]) as ctx:
        t = tasks.create_task(
            ctx,
            s["ws"],
            s["pid"],
            {"title": "Y", "start_date": "2026-12-05", "due_date": "2026-12-10"},
        )
    # Compara com o valor já gravado: mexer só no prazo também é verificado.
    with uow(s["membro"]["id"]) as ctx, pytest.raises(BadRequestError, match="início"):
        tasks.update_task(ctx, t["id"], {"due_date": "2026-12-04"}, t["version"])
    with uow(s["membro"]["id"]) as ctx, pytest.raises(BadRequestError, match="início"):
        tasks.update_task(ctx, t["id"], {"start_date": "2026-12-11"}, t["version"])
    with uow(s["membro"]["id"]) as ctx, pytest.raises(BadRequestError, match="inválida"):
        tasks.update_task(ctx, t["id"], {"start_date": "05/12/2026"}, t["version"])


def test_lista_traz_dependencias_e_ficha_mostra_quem_espera(setup):
    s = setup
    with uow(s["membro"]["id"]) as ctx:
        a, b, c = (tasks.create_task(ctx, s["ws"], s["pid"], {"title": n}) for n in "ABC")
        tasks.add_dependency(ctx, b["id"], a["id"])
        tasks.add_dependency(ctx, c["id"], a["id"])
        rows = {t["title"]: t for t in tasks.list_project_tasks(ctx, s["pid"])}
        assert rows["B"]["depends_on_ids"] == [a["id"]] and rows["A"]["depends_on_ids"] == []
        detail = tasks.get_task(ctx, a["id"])
        assert [x["title"] for x in detail["blocks"]] == ["B", "C"]
        tasks.remove_dependency(ctx, b["id"], a["id"])
        assert tasks.get_task(ctx, b["id"])["task"]["depends_on_ids"] == []


def test_dependencia_exige_escrita_e_acesso_as_duas_tarefas(setup):
    s = setup
    fora = make_user("fora")
    outro_ws = make_team(fora)
    outro = make_project(fora, outro_ws, "Alheio")
    with uow(s["membro"]["id"]) as ctx:
        a, b = (tasks.create_task(ctx, s["ws"], s["pid"], {"title": n}) for n in "AB")
    with uow(fora["id"]) as ctx:
        alheia = tasks.create_task(ctx, outro_ws, outro, {"title": "Alheia"})
    # Leitor enxerga, mas não altera o cronograma.
    with uow(s["leitor"]["id"]) as ctx, pytest.raises(ForbiddenError):
        tasks.add_dependency(ctx, b["id"], a["id"])
    # Quem é de fora não liga a tarefa dele a uma que não enxerga (e vice-versa).
    with uow(fora["id"]) as ctx, pytest.raises(ForbiddenError):
        tasks.add_dependency(ctx, alheia["id"], a["id"])
    with uow(s["membro"]["id"]) as ctx, pytest.raises(ForbiddenError):
        tasks.add_dependency(ctx, a["id"], alheia["id"])
