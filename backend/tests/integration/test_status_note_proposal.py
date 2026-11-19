"""Proposta do assistente para a nota semanal: nada grava antes da confirmação."""

import pytest

from helpers import join, make_project, make_team, make_user
from projeta.assistant import proposals, service, tools
from projeta.assistant.tools import Session
from projeta.db import uow
from projeta.errors import BadRequestError, ForbiddenError
from projeta.work import formal, tasks


def _session(ctx, user, ws, pid):
    conv = service.get_or_create_conversation(ctx, ws, pid)
    s = Session(ctx, ws, conv, "America/Sao_Paulo")
    s.project_id = pid
    return s


def _notes(user, pid):
    with uow(user["id"]) as ctx:
        return formal.list_status_notes(ctx, pid)


def test_proposta_exige_justificativa_do_usuario_e_so_grava_ao_confirmar():
    ana = make_user("Ana")
    ws = make_team(ana)
    pid = make_project(ana, ws, "Portal")
    with uow(ana["id"]) as ctx:
        tasks.create_task(ctx, ws, pid, {"title": "Atrasada", "due_date": "2020-01-01"})
        s = _session(ctx, ana, ws, pid)
        # atraso sem justificativa: o assistente não inventa; pede ao usuário
        r = tools.execute(s, "propose_status_note", {})
        assert "justificativa" in r["erro"] and s.proposal is None
        r = tools.execute(s, "propose_status_note", {"delay_reason": "Fornecedor atrasou"})
        assert r["proposta_criada"] and s.proposal["kind"] == "status_note"
        prop = s.proposal
    assert _notes(ana, pid) == []  # nada gravado antes da confirmação

    # edição pelo usuário e confirmação; confirmar de novo não duplica
    payload = prop["payload"] | {"pending": "- revisado pela Ana"}
    with uow(ana["id"]) as ctx:
        proposals.edit_proposal(ctx, prop["id"], payload)
    with uow(ana["id"]) as ctx:
        assert proposals.confirm_proposal(ctx, prop["id"])["status"] == "confirmed"
    with uow(ana["id"]) as ctx:
        assert proposals.confirm_proposal(ctx, prop["id"])["status"] == "already_confirmed"
    notes = _notes(ana, pid)
    assert len(notes) == 1 and notes[0]["pending"] == "- revisado pela Ana"


def test_edicao_nao_pode_remover_a_justificativa_de_atraso():
    ana = make_user("Ana")
    ws = make_team(ana)
    pid = make_project(ana, ws)
    with uow(ana["id"]) as ctx:
        s = _session(ctx, ana, ws, pid)
        tools.execute(s, "propose_status_note", {})
        prop = s.proposal
        with pytest.raises(BadRequestError):
            proposals.edit_proposal(ctx, prop["id"], prop["payload"] | {"state": "late"})


def test_quem_nao_gerencia_o_projeto_nao_recebe_proposta():
    ana, bia, eva = make_user("Ana"), make_user("Bia"), make_user("Eva")
    ws = make_team(ana)
    join(ana, ws, bia, "member")
    pid = make_project(ana, ws, members=(bia,))
    for outsider in (bia, eva):  # membro comum e pessoa de fora do espaço
        with uow(outsider["id"]) as ctx:
            conv = service.get_or_create_conversation(ctx, outsider["personal_ws"], None)
            s = Session(ctx, outsider["personal_ws"], conv, "America/Sao_Paulo")
            r = tools.execute(s, "propose_status_note", {"project_id": pid})
            assert "erro" in r and s.proposal is None
        with uow(outsider["id"]) as ctx, pytest.raises(ForbiddenError):
            proposals.create_proposal(
                ctx,
                service.get_or_create_conversation(ctx, outsider["personal_ws"], None),
                outsider["personal_ws"],
                "status_note",
                {"project_id": pid, "state": "on_track"},
            )
