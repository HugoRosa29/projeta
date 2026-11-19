"""Etapa 1 — critérios de saída: colaboração, isolamento entre espaços, persistência, papéis."""

from datetime import UTC, datetime

import pytest

from helpers import join, make_project, make_team, make_user
from projeta.db import uow
from projeta.errors import ConflictError, ForbiddenError, GoneError
from projeta.identity import workspaces
from projeta.work import projects, tasks, today


def test_duas_contas_colaboram_e_terceira_conta_e_negada():
    ana, bia, eva = make_user("Ana"), make_user("Bia"), make_user("Eva")
    ws = make_team(ana)
    join(ana, ws, bia, "member")
    pid = make_project(ana, ws, "Site novo", members=(bia,))

    with uow(ana["id"]) as ctx:
        t = tasks.create_task(ctx, ws, pid, {"title": "Levantar conteúdo"})
    with uow(bia["id"]) as ctx:  # colega vê e edita a tarefa da Ana
        assert tasks.get_task(ctx, t["id"])["task"]["title"] == "Levantar conteúdo"
        tasks.update_task(ctx, t["id"], {"status": "doing"})
        assert [x["id"] for x in tasks.list_project_tasks(ctx, pid)] == [t["id"]]

    # Eva é de outro espaço: mesmo conhecendo IDs, tudo é negado (leitura, escrita, listagens)
    calls = (
        lambda c: tasks.get_task(c, t["id"]),
        lambda c: tasks.update_task(c, t["id"], {"title": "x"}),
        lambda c: tasks.delete_task(c, t["id"]),
        lambda c: tasks.list_project_tasks(c, pid),
        lambda c: tasks.create_task(c, ws, pid, {"title": "intruso"}),
        lambda c: projects.get_project(c, pid),
        lambda c: projects.list_projects(c, ws),
        lambda c: workspaces.list_members(c, ws),
        lambda c: tasks.list_my_tasks(c, ws, "2026-01-01"),
    )
    for call in calls:
        with uow(eva["id"]) as ctx, pytest.raises(ForbiddenError):
            call(ctx)


def test_tarefa_do_quadro_aparece_na_lista_e_persiste():
    ana = make_user("Ana")
    pid = make_project(ana, ana["personal_ws"])
    with uow(ana["id"]) as ctx:
        t = tasks.create_task(
            ctx, ana["personal_ws"], pid, {"title": "Configurar DNS", "status": "doing"}
        )
    with uow(ana["id"]) as ctx:  # nova transação = "recarregar"
        lst = tasks.list_project_tasks(ctx, pid)
        assert [(x["id"], x["status"]) for x in lst] == [(t["id"], "doing")]
        assert tasks.list_project_tasks(ctx, pid, status="todo") == []


def test_papeis():
    adm, mem, lei = make_user("Adm"), make_user("Mem"), make_user("Lei")
    ws = make_team(adm)
    join(adm, ws, mem, "member")
    join(adm, ws, lei, "viewer")
    pid = make_project(adm, ws, members=(mem, lei))
    with uow(mem["id"]) as ctx:
        with pytest.raises(ForbiddenError):  # membro não cria projeto
            projects.create_project(ctx, ws, "Outro")
        with pytest.raises(ForbiddenError):  # nem convida
            workspaces.create_invitation(ctx, ws, "x@y.com", "member")
        tasks.create_task(ctx, ws, pid, {"title": "ok"})
    with uow(lei["id"]) as ctx:
        assert projects.get_project(ctx, pid)["project"]["id"] == pid  # leitor lê
        with pytest.raises(ForbiddenError):
            tasks.create_task(ctx, ws, pid, {"title": "não"})


def test_membro_nao_vinculado_nao_ve_projeto():
    adm, mem = make_user("Adm"), make_user("Mem")
    ws = make_team(adm)
    join(adm, ws, mem, "member")
    pid = make_project(adm, ws)  # mem não está no projeto
    with uow(mem["id"]) as ctx:
        with pytest.raises(ForbiddenError):
            projects.get_project(ctx, pid)
        assert projects.list_projects(ctx, ws) == []


def test_tarefa_pessoal_e_privada_ate_para_admin():
    adm, mem = make_user("Adm"), make_user("Mem")
    ws = make_team(adm)
    join(adm, ws, mem, "member")
    with uow(mem["id"]) as ctx:
        t = tasks.create_task(ctx, ws, None, {"title": "Pessoal da Mem"})
    with uow(adm["id"]) as ctx:
        with pytest.raises(ForbiddenError):
            tasks.get_task(ctx, t["id"])
        assert tasks.list_my_tasks(ctx, ws, "2026-01-01") == []
    with uow(mem["id"]) as ctx:
        assert [x["id"] for x in tasks.list_my_tasks(ctx, ws, "2026-01-01")] == [t["id"]]


def test_edicao_concorrente_retorna_conflito():
    ana = make_user("Ana")
    pid = make_project(ana, ana["personal_ws"])
    with uow(ana["id"]) as ctx:
        t = tasks.create_task(ctx, ana["personal_ws"], pid, {"title": "A"})
        tasks.update_task(ctx, t["id"], {"title": "B"}, expected_version=t["version"])
    with uow(ana["id"]) as ctx, pytest.raises(ConflictError):
        tasks.update_task(ctx, t["id"], {"title": "C"}, expected_version=t["version"])


def test_dependencia_com_ciclo_e_bloqueada():
    ana = make_user("Ana")
    pid = make_project(ana, ana["personal_ws"])
    with uow(ana["id"]) as ctx:
        a, b, c = (tasks.create_task(ctx, ana["personal_ws"], pid, {"title": n}) for n in "ABC")
        tasks.add_dependency(ctx, b["id"], a["id"])
        tasks.add_dependency(ctx, c["id"], b["id"])
    with uow(ana["id"]) as ctx, pytest.raises(ConflictError):
        tasks.add_dependency(ctx, a["id"], c["id"])  # A->C->B->A


def test_hoje_usa_fuso_do_usuario():
    ana = make_user("Ana")
    ws = ana["personal_ws"]
    with uow(ana["id"]) as ctx:
        tasks.create_task(ctx, ws, None, {"title": "Hoje", "due_date": "2026-03-10"})
        tasks.create_task(ctx, ws, None, {"title": "Atrasada", "due_date": "2026-03-09"})
        tasks.create_task(ctx, ws, None, {"title": "Em breve", "due_date": "2026-03-12"})
        # 01:00 UTC de 11/03 ainda é 10/03 em São Paulo (UTC-3)
        v = today.get_today(ctx, ws, "America/Sao_Paulo", datetime(2026, 3, 11, 1, 0, tzinfo=UTC))
    assert v["today"] == "2026-03-10"
    assert [t["title"] for t in v["due_today"]] == ["Hoje"]
    assert [t["title"] for t in v["overdue"]] == ["Atrasada"]
    assert [t["title"] for t in v["upcoming"]] == ["Em breve"]


def test_convite_so_vale_para_o_email_convidado_e_uma_vez():
    adm, bia, eva = make_user("Adm"), make_user("Bia"), make_user("Eva")
    ws = make_team(adm)
    with uow(adm["id"]) as ctx:
        inv = workspaces.create_invitation(ctx, ws, bia["email"], "member")
    with uow(eva["id"]) as ctx, pytest.raises(ForbiddenError):
        workspaces.accept_invitation(ctx, eva, inv["token"])
    with uow(bia["id"]) as ctx:
        workspaces.accept_invitation(ctx, bia, inv["token"])
    with uow(bia["id"]) as ctx, pytest.raises(GoneError):
        workspaces.accept_invitation(ctx, bia, inv["token"])


def test_nao_remove_ultimo_admin():
    adm = make_user("Adm")
    ws = make_team(adm)
    with uow(adm["id"]) as ctx, pytest.raises(ConflictError):
        workspaces.set_member_role(ctx, ws, adm["id"], "member")


def test_tarefa_so_com_titulo_aparece_em_hoje():
    ana = make_user("Ana")
    ws = ana["personal_ws"]
    with uow(ana["id"]) as ctx:
        tasks.create_task(ctx, ws, None, {"title": "Só o título"})
        v = today.get_today(ctx, ws, "America/Sao_Paulo")
    assert [t["title"] for t in v["inbox"]] == ["Só o título"]
