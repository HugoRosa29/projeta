"""Campos livres do portfólio: lista de nome e valor, validada no servidor."""

import pytest

from projeta.db import uow
from projeta.errors import BadRequestError, ForbiddenError
from projeta.work import formal, projects
from tests.helpers import join, make_team, make_user


def test_campos_livres_ida_e_volta_e_portfolio():
    gp, leitor, fora = make_user("gp"), make_user("leitor"), make_user("fora")
    ws = make_team(gp)
    join(gp, ws, leitor, "viewer")
    with uow(gp["id"]) as ctx:
        p = projects.create_project(
            ctx,
            ws,
            "ERP",
            attributes=[
                {"name": " Complexidade ", "value": "Alta"},
                {"name": "", "value": ""},  # linha vazia do formulário é ignorada
                {"name": "PDTI", "value": "Sim"},
            ],
        )
        assert p["attributes"] == [
            {"name": "Complexidade", "value": "Alta"},
            {"name": "PDTI", "value": "Sim"},
        ]
        projects.add_project_member(ctx, p["id"], leitor["id"])
        # Nulo mantém; outra edição não apaga os campos.
        assert (
            projects.update_project(ctx, p["id"], summary="Resumo")["attributes"][1]["value"]
            == "Sim"
        )
        changed = projects.update_project(
            ctx, p["id"], attributes=[{"name": "Custo estimado", "value": "R$ 514.710"}]
        )
        assert changed["attributes"] == [{"name": "Custo estimado", "value": "R$ 514.710"}]
        assert projects.list_projects(ctx, ws)[0]["attributes"] == changed["attributes"]
        assert formal.portfolio(ctx, ws)[0]["attributes"] == changed["attributes"]
        assert projects.update_project(ctx, p["id"], attributes=[])["attributes"] == []
    with pytest.raises(ForbiddenError), uow(leitor["id"]) as ctx:
        projects.update_project(ctx, p["id"], attributes=[{"name": "A", "value": "B"}])
    with pytest.raises(ForbiddenError), uow(fora["id"]) as ctx:
        projects.update_project(ctx, p["id"], attributes=[{"name": "A", "value": "B"}])


@pytest.mark.parametrize(
    "attrs,msg",
    [
        ([{"name": "PDTI", "value": "Sim"}, {"name": "pdti", "value": "Não"}], "duas vezes"),
        ([{"name": "", "value": "Alta"}], "sem nome"),
        ([{"name": "Complexidade", "value": " "}], "sem valor"),
        ([{"name": "a" * 41, "value": "x"}], "caracteres"),
        ([{"name": "a", "value": "x" * 201}], "caracteres"),
        ([{"name": f"c{i}", "value": "x"} for i in range(21)], "no máximo"),
    ],
)
def test_validacoes(attrs, msg):
    gp = make_user("gp")
    with uow(gp["id"]) as ctx:
        p = projects.create_project(ctx, gp["personal_ws"], "Projeto")
    with pytest.raises(BadRequestError, match=msg), uow(gp["id"]) as ctx:
        projects.update_project(ctx, p["id"], attributes=attrs)
