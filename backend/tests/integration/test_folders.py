"""Pastas de projetos: o setor agrupa os próprios projetos; só organiza, não muda acesso."""

import pytest

from helpers import join, make_project, make_team, make_user
from projeta.db import uow
from projeta.errors import BadRequestError, ForbiddenError
from projeta.work import folders, formal, projects


@pytest.fixture
def setup():
    gp, gerente, membro = make_user("gp"), make_user("gerente"), make_user("membro")
    ws = make_team(gp)
    join(gp, ws, gerente, "manager")
    join(gp, ws, membro, "member")
    pid = make_project(gp, ws, "Portal", members=(membro,))
    outro = make_project(gp, ws, "ERP")
    return {"gp": gp, "gerente": gerente, "membro": membro, "ws": ws, "pid": pid, "outro": outro}


def _folder_of(user: dict, ws: str) -> dict[str, str | None]:
    with uow(user["id"]) as ctx:
        return {r["name"]: r["folder_id"] for r in formal.portfolio(ctx, ws)}


def test_criar_pasta_e_guardar_projeto_aparece_no_portfolio(setup):
    s = setup
    with uow(s["gp"]["id"]) as ctx:
        f = folders.create_folder(ctx, s["ws"], "  Atendimento   ao cliente ")
        assert (f["name"], f["project_count"]) == ("Atendimento ao cliente", 0)
        folders.set_project_folder(ctx, s["pid"], f["id"])
        listed = folders.list_folders(ctx, s["ws"])
        assert listed["can_manage"] is True
        assert [(x["name"], x["project_count"]) for x in listed["folders"]] == [
            ("Atendimento ao cliente", 1)
        ]
    assert _folder_of(s["gp"], s["ws"]) == {"ERP": None, "Portal": f["id"]}
    # A tela de projetos usa a lista de projetos: a pasta vem nela também.
    with uow(s["gp"]["id"]) as ctx:
        assert {p["name"]: p["folder_id"] for p in projects.list_projects(ctx, s["ws"])} == {
            "ERP": None,
            "Portal": f["id"],
        }
    # Qualquer membro lê a organização (dos projetos que vê), mesmo sem poder mexer nela.
    assert _folder_of(s["membro"], s["ws"]) == {"Portal": f["id"]}
    with uow(s["membro"]["id"]) as ctx:
        assert folders.list_folders(ctx, s["ws"])["can_manage"] is False


def test_excluir_pasta_devolve_os_projetos_sem_apagar(setup):
    s = setup
    with uow(s["gp"]["id"]) as ctx:
        f = folders.create_folder(ctx, s["ws"], "ERP")
        folders.set_project_folder(ctx, s["outro"], f["id"])
        folders.delete_folder(ctx, f["id"])
    assert _folder_of(s["gp"], s["ws"]) == {"ERP": None, "Portal": None}


def test_nome_valido_e_unico_no_espaco(setup):
    s = setup
    with uow(s["gp"]["id"]) as ctx:
        a = folders.create_folder(ctx, s["ws"], "ERP")
        b = folders.create_folder(ctx, s["ws"], "Imóveis")
        with pytest.raises(BadRequestError):
            folders.create_folder(ctx, s["ws"], "erp")
        with pytest.raises(BadRequestError):
            folders.rename_folder(ctx, b["id"], "ERP")
        with pytest.raises(BadRequestError):
            folders.create_folder(ctx, s["ws"], "   ")
        with pytest.raises(BadRequestError):
            folders.create_folder(ctx, s["ws"], "x" * 61)
        # Renomear para o próprio nome (outra grafia) não conflita consigo mesma.
        assert folders.rename_folder(ctx, a["id"], "Erp")["name"] == "Erp"


def test_organizar_exige_gerir_projetos_no_espaco(setup):
    s = setup
    with uow(s["gp"]["id"]) as ctx:
        f = folders.create_folder(ctx, s["ws"], "ERP")
    # Gerente organiza o setor (inclusive projeto do qual não participa, se o vê).
    with uow(s["gerente"]["id"]) as ctx:
        folders.create_folder(ctx, s["ws"], "Imóveis")
        with pytest.raises(ForbiddenError):  # não vê o projeto: sem vínculo nem "ver todos"
            folders.set_project_folder(ctx, s["outro"], f["id"])
    # Membro vê o projeto, mas não organiza.
    with uow(s["membro"]["id"]) as ctx:
        with pytest.raises(ForbiddenError):
            folders.create_folder(ctx, s["ws"], "Outra")
        with pytest.raises(ForbiddenError):
            folders.rename_folder(ctx, f["id"], "Outra")
        with pytest.raises(ForbiddenError):
            folders.delete_folder(ctx, f["id"])
        with pytest.raises(ForbiddenError):
            folders.set_project_folder(ctx, s["pid"], f["id"])


def test_acesso_cruzado_entre_espacos(setup):
    s = setup
    estranho = make_user("estranho")
    ws2 = make_team(estranho, "Outro setor")
    pid2 = make_project(estranho, ws2, "Alheio")
    with uow(s["gp"]["id"]) as ctx:
        f = folders.create_folder(ctx, s["ws"], "ERP")
    with uow(estranho["id"]) as ctx:
        f2 = folders.create_folder(ctx, ws2, "Deles")
        # Quem é de fora não lê, não mexe e não usa a pasta de outro espaço.
        with pytest.raises(ForbiddenError):
            folders.list_folders(ctx, s["ws"])
        with pytest.raises(ForbiddenError):
            folders.rename_folder(ctx, f["id"], "Minha")
        with pytest.raises(ForbiddenError):
            folders.delete_folder(ctx, f["id"])
        with pytest.raises(ForbiddenError):
            folders.set_project_folder(ctx, pid2, f["id"])
        with pytest.raises(ForbiddenError):
            folders.set_project_folder(ctx, s["pid"], f2["id"])
    # Nem o Gestor põe projeto do próprio espaço em pasta de outro.
    with uow(s["gp"]["id"]) as ctx:
        with pytest.raises(ForbiddenError):
            folders.set_project_folder(ctx, s["pid"], f2["id"])
        with pytest.raises(ForbiddenError):
            folders.set_project_folder(ctx, s["pid"], "nao-e-uuid")
