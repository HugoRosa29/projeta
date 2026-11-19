import pytest

from projeta.db import uow
from projeta.errors import BadRequestError, ForbiddenError
from projeta.work import projects
from tests.helpers import join, make_team, make_user


def test_project_details_roundtrip_and_access():
    owner = make_user("owner")
    outsider = make_user("outsider")
    viewer = make_user("viewer")
    ws = make_team(owner)
    join(owner, ws, viewer, "viewer")
    with uow(owner["id"]) as ctx:
        p = projects.create_project(
            ctx,
            ws,
            "Projeto",
            "Detalhes",
            summary=" Resumo ",
            responsible=" Ana ",
            requester="TI",
            external_ref="Jira COMP-1",
        )
        projects.add_project_member(ctx, p["id"], viewer["id"])
        assert p["summary"] == "Resumo"
        assert p["responsible"] == "Ana"
        assert projects.list_projects(ctx, ws)[0]["external_ref"] == "Jira COMP-1"
        changed = projects.update_project(ctx, p["id"], summary="", requester="DIRAU")
        assert changed["summary"] == ""
        assert changed["requester"] == "DIRAU"
        assert changed["description"] == "Detalhes"
        assert changed["responsible"] == "Ana"
    for user in (outsider, viewer):
        with pytest.raises(ForbiddenError), uow(user["id"]) as ctx:
            projects.update_project(ctx, p["id"], summary="Indevido")
    with pytest.raises(ForbiddenError), uow(outsider["id"]) as ctx:
        projects.get_project(ctx, p["id"])


@pytest.mark.parametrize(
    "field,limit",
    [("summary", 280), ("responsible", 120), ("requester", 120), ("external_ref", 80)],
)
def test_details_limits(field, limit):
    owner = make_user("owner")
    with uow(owner["id"]) as ctx:
        p = projects.create_project(ctx, owner["personal_ws"], "Projeto", **{field: "a" * limit})
    with pytest.raises(BadRequestError), uow(owner["id"]) as ctx:
        projects.update_project(ctx, p["id"], **{field: "a" * (limit + 1)})
