"""Retirar pessoa da equipe do projeto: só quem gerencia; as tarefas dela ficam sem responsável."""

import pytest

from helpers import join, make_project, make_team, make_user
from projeta.db import uow
from projeta.errors import ForbiddenError
from projeta.work import projects, tasks


def test_gestor_retira_pessoa_e_as_tarefas_dela_ficam_sem_responsavel():
    ana, bia = make_user("ana"), make_user("bia")
    ws = make_team(ana)
    join(ana, ws, bia, "member")
    pid = make_project(ana, ws, members=(bia,))
    with uow(ana["id"]) as ctx:
        t = tasks.create_task(ctx, ws, pid, {"title": "Relatório", "assignee_id": bia["id"]})
        projects.remove_project_member(ctx, pid, bia["id"])
        assert bia["id"] not in {m["id"] for m in projects.get_project(ctx, pid)["members"]}
        row = ctx.one("SELECT assignee_id FROM tasks WHERE id=%s", (t["id"],))
        assert row["assignee_id"] is None


def test_quem_nao_gerencia_nao_retira_ninguem():
    ana, bia, caio = make_user("ana"), make_user("bia"), make_user("caio")
    ws = make_team(ana)
    join(ana, ws, bia, "member")
    pid = make_project(ana, ws, members=(bia,))
    with uow(bia["id"]) as ctx, pytest.raises(ForbiddenError):
        projects.remove_project_member(ctx, pid, ana["id"])
    with uow(caio["id"]) as ctx, pytest.raises(ForbiddenError):  # de fora do espaço
        projects.remove_project_member(ctx, pid, bia["id"])
