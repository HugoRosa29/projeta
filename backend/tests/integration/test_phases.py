"""Fases do projeto: lista editável que agrupa as tarefas, em sincronia com `tasks.phase`."""

import pytest

from helpers import join, make_project, make_team, make_user
from projeta.db import uow
from projeta.errors import BadRequestError, ConflictError, ForbiddenError
from projeta.work import phases, tasks


@pytest.fixture
def setup():
    gp, membro, leitor, fora = (
        make_user("gp"),
        make_user("membro"),
        make_user("leitor"),
        make_user("fora"),
    )
    ws = make_team(gp)
    join(gp, ws, membro, "member")
    join(gp, ws, leitor, "viewer")
    pid = make_project(gp, ws, "Portal", members=(membro, leitor))
    return {"gp": gp, "membro": membro, "leitor": leitor, "fora": fora, "ws": ws, "pid": pid}


def _task(user: dict, s: dict, title: str, **fields) -> dict:
    with uow(user["id"]) as ctx:
        return tasks.create_task(ctx, s["ws"], s["pid"], {"title": title, **fields})


def _phase_of(user: dict, task_id: str) -> str | None:
    with uow(user["id"]) as ctx:
        return tasks.get_task(ctx, task_id)["task"]["phase"]


def test_criar_renomear_reordenar_e_contar(setup):
    s = setup
    with uow(s["membro"]["id"]) as ctx:
        a = phases.create_phase(ctx, s["pid"], "  Iniciação ")
        b = phases.create_phase(ctx, s["pid"], "Execução")
        assert a["name"] == "Iniciação"
    t = _task(s["membro"], s, "Termo de abertura", phase="iniciação")
    # Grafia diferente cai na fase registrada.
    assert t["phase"] == "Iniciação"
    _task(s["membro"], s, "Contratar", phase="Execução", status="done")
    with uow(s["membro"]["id"]) as ctx:
        listed = phases.list_phases(ctx, s["pid"])
        assert listed["can_write"] is True
        assert [(p["name"], p["task_count"], p["done_count"]) for p in listed["phases"]] == [
            ("Iniciação", 1, 0),
            ("Execução", 1, 1),
        ]
        phases.rename_phase(ctx, a["id"], "Abertura")
        out = phases.reorder_phases(ctx, s["pid"], [b["id"], a["id"]])
        assert [p["name"] for p in out["phases"]] == ["Execução", "Abertura"]
    # Renomear leva as tarefas junto.
    assert _phase_of(s["membro"], t["id"]) == "Abertura"


def test_renomear_sobe_versao_da_tarefa(setup):
    s = setup
    t = _task(s["membro"], s, "Termo", phase="Iniciação")
    with uow(s["membro"]["id"]) as ctx:
        ph = phases.list_phases(ctx, s["pid"])["phases"][0]
        phases.rename_phase(ctx, ph["id"], "Abertura")
    with uow(s["membro"]["id"]) as ctx, pytest.raises(ConflictError):
        tasks.update_task(ctx, t["id"], {"title": "Termo v2"}, expected_version=t["version"])


def test_excluir_fase_deixa_tarefas_sem_fase(setup):
    s = setup
    t = _task(s["membro"], s, "Termo", phase="Iniciação")
    with uow(s["membro"]["id"]) as ctx:
        ph = phases.list_phases(ctx, s["pid"])["phases"][0]
        phases.delete_phase(ctx, ph["id"])
        assert phases.list_phases(ctx, s["pid"])["phases"] == []
    assert _phase_of(s["membro"], t["id"]) is None


def test_mover_tarefa_de_fase_registra_e_leva_subtarefas(setup):
    s = setup
    mae = _task(s["membro"], s, "Licitação", phase="Planejamento")
    sub = _task(s["membro"], s, "Edital", parent_id=mae["id"], phase="Outra qualquer")
    # Subtarefa acompanha a mãe, seja qual for a fase enviada.
    assert sub["phase"] == "Planejamento"
    with uow(s["membro"]["id"]) as ctx:
        tasks.update_task(ctx, mae["id"], {"phase": "Execução"})
        # Fase nova citada na tarefa entra na lista do projeto.
        assert [p["name"] for p in phases.list_phases(ctx, s["pid"])["phases"]] == [
            "Planejamento",
            "Execução",
        ]
    assert _phase_of(s["membro"], sub["id"]) == "Execução"
    with uow(s["membro"]["id"]) as ctx:
        tasks.update_task(ctx, mae["id"], {"phase": ""})
    assert _phase_of(s["membro"], mae["id"]) is None
    assert _phase_of(s["membro"], sub["id"]) is None


def test_nome_valido_e_unico_no_projeto(setup):
    s = setup
    with uow(s["membro"]["id"]) as ctx:
        a = phases.create_phase(ctx, s["pid"], "Execução")
        b = phases.create_phase(ctx, s["pid"], "Encerramento")
        with pytest.raises(BadRequestError):
            phases.create_phase(ctx, s["pid"], "EXECUÇÃO")
        with pytest.raises(BadRequestError):
            phases.rename_phase(ctx, b["id"], "execução")
        with pytest.raises(BadRequestError):
            phases.create_phase(ctx, s["pid"], "   ")
        with pytest.raises(BadRequestError):
            phases.reorder_phases(ctx, s["pid"], [a["id"]])  # ordem incompleta
        assert phases.rename_phase(ctx, a["id"], "EXECUÇÃO")["name"] == "EXECUÇÃO"


def test_leitor_le_mas_nao_mexe_e_quem_esta_fora_nao_ve(setup):
    s = setup
    with uow(s["membro"]["id"]) as ctx:
        ph = phases.create_phase(ctx, s["pid"], "Execução")
    with uow(s["leitor"]["id"]) as ctx:
        listed = phases.list_phases(ctx, s["pid"])
        assert listed["can_write"] is False and len(listed["phases"]) == 1
    for call in (
        lambda ctx: phases.create_phase(ctx, s["pid"], "Nova"),
        lambda ctx: phases.rename_phase(ctx, ph["id"], "Outra"),
        lambda ctx: phases.delete_phase(ctx, ph["id"]),
        lambda ctx: phases.reorder_phases(ctx, s["pid"], [ph["id"]]),
    ):
        with uow(s["leitor"]["id"]) as ctx, pytest.raises(ForbiddenError):
            call(ctx)
    # Acesso cruzado: pessoa de outro espaço não lê nem mexe (e não descobre se o ID existe).
    for call in (
        lambda ctx: phases.list_phases(ctx, s["pid"]),
        lambda ctx: phases.rename_phase(ctx, ph["id"], "Invadida"),
        lambda ctx: phases.delete_phase(ctx, ph["id"]),
        lambda ctx: phases.rename_phase(ctx, "00000000-0000-0000-0000-000000000000", "X"),
    ):
        with uow(s["fora"]["id"]) as ctx, pytest.raises(ForbiddenError):
            call(ctx)
