"""Subtarefas: um nível, mesmo projeto, acesso validado pela tarefa-mãe."""

import pytest

from projeta.db import uow
from projeta.errors import BadRequestError, ForbiddenError
from projeta.work import tasks
from tests.helpers import join, make_project, make_team, make_user


@pytest.fixture
def setup():
    gp, membro, fora = make_user("gp"), make_user("membro"), make_user("fora")
    ws = make_team(gp)
    join(gp, ws, membro, "member")
    pid = make_project(gp, ws, "CNPJ alfanumérico", members=(membro,))
    other = make_project(gp, ws, "Outro")
    with uow(gp["id"]) as ctx:
        mae = tasks.create_task(ctx, ws, pid, {"title": "Adequar sistemas"})["id"]
    return {
        "gp": gp,
        "membro": membro,
        "fora": fora,
        "ws": ws,
        "pid": pid,
        "other": other,
        "mae": mae,
    }


def test_criar_listar_e_desvincular(setup):
    s = setup
    with uow(s["membro"]["id"]) as ctx:
        a = tasks.create_task(ctx, s["ws"], s["pid"], {"title": "GAI", "parent_id": s["mae"]})
        b = tasks.create_task(ctx, s["ws"], s["pid"], {"title": "Portal"})
        b = tasks.update_task(ctx, b["id"], {"parent_id": s["mae"]}, b["version"])
        assert a["parent_id"] == s["mae"] and a["parent_title"] == "Adequar sistemas"
        tasks.update_task(ctx, a["id"], {"status": "done"})
        detail = tasks.get_task(ctx, s["mae"])
        assert [(t["title"], t["status"]) for t in detail["subtasks"]] == [
            ("GAI", "done"),
            ("Portal", "todo"),
        ]
        assert tasks.update_task(ctx, b["id"], {"parent_id": None})["parent_id"] is None
        assert len(tasks.get_task(ctx, s["mae"])["subtasks"]) == 1


def test_texto_vazio_desvincula_como_nulo(setup):
    # Clientes da API mandam "" para "nenhuma tarefa-mãe"; não pode virar erro de uuid no banco.
    s = setup
    with uow(s["gp"]["id"]) as ctx:
        filha = tasks.create_task(ctx, s["ws"], s["pid"], {"title": "Filha", "parent_id": s["mae"]})
        assert tasks.update_task(ctx, filha["id"], {"parent_id": ""})["parent_id"] is None


def test_regras_de_nivel_e_de_projeto(setup):
    s = setup
    with uow(s["gp"]["id"]) as ctx:
        filha = tasks.create_task(ctx, s["ws"], s["pid"], {"title": "Filha", "parent_id": s["mae"]})
        with pytest.raises(BadRequestError, match="já é uma subtarefa"):
            tasks.create_task(ctx, s["ws"], s["pid"], {"title": "Neta", "parent_id": filha["id"]})
        with pytest.raises(BadRequestError, match="tem subtarefas"):
            outra = tasks.create_task(ctx, s["ws"], s["pid"], {"title": "Outra"})
            tasks.update_task(ctx, s["mae"], {"parent_id": outra["id"]})
    with uow(s["gp"]["id"]) as ctx:
        with pytest.raises(BadRequestError, match="mesmo projeto"):
            tasks.create_task(ctx, s["ws"], s["other"], {"title": "X", "parent_id": s["mae"]})
        with pytest.raises(BadRequestError, match="dela mesma"):
            tasks.update_task(ctx, s["mae"], {"parent_id": s["mae"]})
        with pytest.raises(BadRequestError, match="mesmo projeto"):
            tasks.create_task(ctx, s["ws"], None, {"title": "Pessoal", "parent_id": s["mae"]})


def test_acesso_cruzado(setup):
    s = setup
    with pytest.raises(ForbiddenError), uow(s["fora"]["id"]) as ctx:
        tasks.create_task(
            ctx, s["fora"]["personal_ws"], None, {"title": "X", "parent_id": s["mae"]}
        )
    with pytest.raises(ForbiddenError), uow(s["fora"]["id"]) as ctx:
        tasks.get_task(ctx, s["mae"])
    # ID inválido responde como inexistente.
    with pytest.raises(ForbiddenError), uow(s["gp"]["id"]) as ctx:
        tasks.create_task(ctx, s["ws"], s["pid"], {"title": "X", "parent_id": "nao-e-uuid"})


def test_excluir_mae_preserva_subtarefas(setup):
    s = setup
    with uow(s["gp"]["id"]) as ctx:
        filha = tasks.create_task(ctx, s["ws"], s["pid"], {"title": "Filha", "parent_id": s["mae"]})
        tasks.delete_task(ctx, s["mae"])
        assert tasks.get_task(ctx, filha["id"])["task"]["parent_id"] is None


def test_subtarefa_pessoal():
    ana = make_user("ana")
    with uow(ana["id"]) as ctx:
        mae = tasks.create_task(ctx, ana["personal_ws"], None, {"title": "Mudança"})
        filha = tasks.create_task(
            ctx, ana["personal_ws"], None, {"title": "Caixas", "parent_id": mae["id"]}
        )
        assert filha["parent_id"] == mae["id"]
