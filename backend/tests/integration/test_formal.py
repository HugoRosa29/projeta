"""Modo projeto formal e convite por matrícula: regras no servidor e acesso cruzado."""

import pytest

from helpers import join, make_project, make_team, make_user
from projeta.db import uow
from projeta.errors import BadRequestError, ConflictError, ForbiddenError
from projeta.work import formal, invites, projects, tasks


@pytest.fixture
def cena():
    ana = make_user("Ana")  # gerente: cria o projeto
    bia = make_user("Bia")
    eva = make_user("Eva")  # fora do espaço
    ws = make_team(ana)
    join(ana, ws, bia, "member")
    pid = make_project(ana, ws, "Portal", members=(bia,))
    return {"ana": ana, "bia": bia, "eva": eva, "ws": ws, "pid": pid}


def test_funcoes_exigem_vinculo_e_respeitam_segregacao(cena):
    a, b, pid = cena["ana"], cena["bia"], cena["pid"]
    with uow(a["id"]) as ctx:
        assert formal.set_member_roles(ctx, pid, b["id"], ["qa", "po", "qa"]) == ["po", "qa"]
        with pytest.raises(BadRequestError):  # QA acumulando com executor
            formal.set_member_roles(ctx, pid, b["id"], ["qa", "ex"])
        with pytest.raises(BadRequestError):  # função inexistente
            formal.set_member_roles(ctx, pid, b["id"], ["chefe"])
        with pytest.raises(BadRequestError):  # Eva não está no projeto
            formal.set_member_roles(ctx, pid, cena["eva"]["id"], ["ex"])
    with uow(b["id"]) as ctx, pytest.raises(ForbiddenError):  # membro comum não gerencia
        formal.set_member_roles(ctx, pid, b["id"], ["ex"])
    with uow(cena["eva"]["id"]) as ctx, pytest.raises(ForbiddenError):
        formal.set_member_roles(ctx, pid, b["id"], ["ex"])


def test_fase_abordagem_e_sei_no_projeto(cena):
    with uow(cena["ana"]["id"]) as ctx:
        p = projects.update_project(
            ctx, cena["pid"], phase="planning", approach="agile", sei_process=" 00111-1/2026-34 "
        )
        assert (p["phase"], p["approach"], p["sei_process"]) == (
            "planning",
            "agile",
            "00111-1/2026-34",
        )
        # nulo mantém; texto vazio limpa o processo SEI
        assert projects.update_project(ctx, cena["pid"], name="Portal 2")["phase"] == "planning"
        assert projects.update_project(ctx, cena["pid"], sei_process="")["sei_process"] is None
        with pytest.raises(BadRequestError):
            projects.update_project(ctx, cena["pid"], phase="vibes")


def test_nota_semanal_rascunho_justificativa_e_acesso(cena):
    a, pid = cena["ana"], cena["pid"]
    with uow(a["id"]) as ctx:
        tasks.create_task(ctx, cena["ws"], pid, {"title": "Atrasada", "due_date": "2020-01-01"})
        d = formal.draft_status_note(ctx, pid)
        assert d["state"] == "late" and "Atrasada" in d["pending"]
        with pytest.raises(BadRequestError):  # atraso sem justificativa
            formal.add_status_note(ctx, pid, "late")
        n = formal.add_status_note(ctx, pid, "late", delay_reason="Fornecedor", pending="- x")
        assert n["state"] == "late"
        assert formal.list_status_notes(ctx, pid)[0]["author_name"] == "Ana"
    with uow(cena["bia"]["id"]) as ctx:
        assert formal.list_status_notes(ctx, pid)  # quem está no projeto lê
        with pytest.raises(ForbiddenError):  # mas não publica
            formal.add_status_note(ctx, pid, "on_track")
    with uow(cena["eva"]["id"]) as ctx:
        for call in (
            lambda: formal.list_status_notes(ctx, pid),
            lambda: formal.draft_status_note(ctx, pid),
            lambda: formal.get_term(ctx, pid, "tap"),
            lambda: formal.draft_tep(ctx, pid),
        ):
            with pytest.raises(ForbiddenError):
                call()


def test_termo_tem_controle_de_versao_e_campos_conhecidos(cena):
    a, pid = cena["ana"], cena["pid"]
    with uow(a["id"]) as ctx:
        assert formal.get_term(ctx, pid, "tap")["version"] == 0
        t = formal.save_term(ctx, pid, "tap", {"justificativa": "Porque sim"}, 0)
        assert t["version"] == 1
        with pytest.raises(ConflictError):  # versão velha
            formal.save_term(ctx, pid, "tap", {"justificativa": "Outra"}, 0)
        with pytest.raises(BadRequestError):
            formal.save_term(ctx, pid, "tap", {"hack": 1}, 1)
        with pytest.raises(BadRequestError):
            formal.get_term(ctx, pid, "xyz")
        tep = formal.draft_tep(ctx, pid)
        assert tep["justificativa"] == "Porque sim"


def test_portfolio_so_mostra_o_que_a_pessoa_enxerga(cena):
    with uow(cena["ana"]["id"]) as ctx:
        projects.update_project(ctx, cena["pid"], phase="execution")
        rows = formal.portfolio(ctx, cena["ws"])
        assert [r["name"] for r in rows] == ["Portal"]
        assert rows[0]["note_stale"] is True  # formal sem nota
    with uow(cena["eva"]["id"]) as ctx, pytest.raises(ForbiddenError):
        formal.portfolio(ctx, cena["ws"])


def test_portfolio_conta_tarefas_por_estado_para_o_panorama(cena):
    with uow(cena["ana"]["id"]) as ctx:
        for title, status in [
            ("A", "todo"),
            ("B", "doing"),
            ("C", "doing"),
            ("D", "blocked"),
            ("E", "done"),
        ]:
            tasks.create_task(ctx, cena["ws"], cena["pid"], {"title": title, "status": status})
        r = formal.portfolio(ctx, cena["ws"])[0]
    counts = (r["task_count"], r["done_count"], r["doing_count"], r["blocked_count"])
    assert counts == (5, 1, 2, 1)
    # Bia, membro do projeto, vê os mesmos números; o recorte é o do servidor.
    with uow(cena["bia"]["id"]) as ctx:
        assert formal.portfolio(ctx, cena["ws"])[0]["doing_count"] == 2


def test_portfolio_traz_datas_para_a_esteira(cena):
    with uow(cena["ana"]["id"]) as ctx:
        r = formal.portfolio(ctx, cena["ws"])[0]
        assert (r["first_due"], r["last_due"], r["tap_start"], r["tap_end"]) == (None,) * 4
        assert r["created_on"] is not None
        for title, due in [("A", "2026-03-10"), ("B", "2026-09-30"), ("C", None)]:
            tasks.create_task(ctx, cena["ws"], cena["pid"], {"title": title, "due_date": due})
        formal.save_term(
            ctx, cena["pid"], "tap", {"data_inicio": "02/03/2026", "data_termino": "31/12/2026"}, 0
        )
        r = formal.portfolio(ctx, cena["ws"])[0]
    assert (str(r["first_due"]), str(r["last_due"])) == ("2026-03-10", "2026-09-30")
    assert (r["tap_start"], r["tap_end"]) == ("02/03/2026", "31/12/2026")


def test_convite_por_matricula_de_quem_ja_tem_conta(cena):
    caio = make_user("Caio")
    with uow(cena["ana"]["id"]) as ctx:
        r = invites.invite_by_matricula(ctx, cena["pid"], " caio ")
        assert r["matricula"] == "CAIO"
        assert invites.list_pending(ctx, cena["pid"]) == []
    with uow(caio["id"]) as ctx:
        assert [p["name"] for p in projects.list_projects(ctx, cena["ws"])] == ["Portal"]
        # entra como membro do espaço: não cria projeto
        with pytest.raises(ForbiddenError):
            projects.create_project(ctx, cena["ws"], "Meu")


def test_convite_pendente_e_resgatado_no_primeiro_login(cena):
    with uow(cena["ana"]["id"]) as ctx:
        resp = invites.invite_by_matricula(ctx, cena["pid"], "dora")
        assert [i["matricula"] for i in invites.list_pending(ctx, cena["pid"])] == ["DORA"]
        # mesma resposta de quem já tem conta: não revela quem usou o sistema
        assert resp["message"] == invites.invite_by_matricula(ctx, cena["pid"], "ana")["message"]
    dora = make_user("Dora")  # primeira entrada pelo GIA
    with uow(dora["id"]) as ctx:
        assert [p["name"] for p in projects.list_projects(ctx, cena["ws"])] == ["Portal"]
    with uow(cena["ana"]["id"]) as ctx:
        assert invites.list_pending(ctx, cena["pid"]) == []


def test_convite_exige_gestao_validade_e_pode_ser_revogado(cena):
    pid = cena["pid"]
    with uow(cena["bia"]["id"]) as ctx, pytest.raises(ForbiddenError):
        invites.invite_by_matricula(ctx, pid, "FULANO")
    with uow(cena["eva"]["id"]) as ctx, pytest.raises(ForbiddenError):
        invites.invite_by_matricula(ctx, pid, "FULANO")
    with uow(cena["ana"]["id"]) as ctx:
        with pytest.raises(BadRequestError):
            invites.invite_by_matricula(ctx, pid, "com espaço")
        invites.invite_by_matricula(ctx, pid, "fulano")
        invites.revoke(ctx, pid, "FULANO")
        assert invites.list_pending(ctx, pid) == []
    fulano = make_user("Fulano")  # convite revogado não vincula
    with uow(fulano["id"]) as ctx, pytest.raises(ForbiddenError):
        projects.get_project(ctx, pid)
