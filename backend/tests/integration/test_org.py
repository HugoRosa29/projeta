"""Organograma: espaço da lotação = unidade; projetos sobem um nível por vez, sempre só leitura."""

import pytest

from helpers import make_project, make_team, make_user
from projeta.db import uow
from projeta.errors import BadRequestError, ForbiddenError
from projeta.identity import workspaces
from projeta.identity.access import project_access
from projeta.work import comments, formal, org, projects, tasks


def _unit_ws(user: dict) -> str:
    with uow(user["id"]) as ctx:
        return next(w["id"] for w in workspaces.list_my_workspaces(ctx) if w["kind"] == "team")


def _sees(user: dict, ws: str, pid: str) -> bool:
    with uow(user["id"]) as ctx:
        return pid in {p["id"] for p in projects.list_projects(ctx, ws)}


@pytest.fixture
def org_tree():
    """DISID e DIRAU sob COTIN, sob COINT. Primeira pessoa de cada lotação é a Gestora."""
    disid, disid2 = make_user("disid1", allotment="DISID"), make_user("disid2", allotment="disid")
    dirau = make_user("dirau1", allotment="COINT/COTIN/DIRAU")
    cotin, cotin_ger = (
        make_user("cotin1", allotment="COTIN"),
        make_user("cotin2", allotment="COTIN"),
    )
    cotin_leitor = make_user("cotin3", allotment="COTIN")
    coint = make_user("coint1", allotment="COINT")
    t = {
        "disid": disid,
        "disid2": disid2,
        "dirau": dirau,
        "cotin": cotin,
        "cotin_ger": cotin_ger,
        "cotin_leitor": cotin_leitor,
        "coint": coint,
    }
    for k in ("disid", "dirau", "cotin", "coint"):
        t[f"ws_{k}"] = _unit_ws(t[k])
    with uow(cotin["id"]) as ctx:
        workspaces.set_member_role(ctx, t["ws_cotin"], cotin_leitor["id"], "viewer")
    t["pid"] = make_project(disid, t["ws_disid"], "Portal DISID")
    with uow(disid["id"]) as ctx:
        t["tid"] = tasks.create_task(ctx, t["ws_disid"], t["pid"], {"title": "Homologar"})["id"]
    return t


def test_espaco_da_lotacao_e_a_unidade_e_a_primeira_pessoa_e_gestora(org_tree):
    with uow(org_tree["disid"]["id"]) as ctx:
        v = org.org_view(ctx, org_tree["ws_disid"])
        roles = {w["id"]: w["role"] for w in workspaces.list_my_workspaces(ctx)}
    assert v["unit"] == "DISID" and v["parent"] == "COTIN"
    assert [u["sigla"] for u in v["chain"]] == ["DISID", "COTIN", "COINT", "PRESIDENCIA"]
    assert roles[org_tree["ws_disid"]] == "admin"
    with uow(org_tree["disid2"]["id"]) as ctx:
        assert workspaces.list_my_workspaces(ctx)[1]["role"] == "manager"
    # Caminho completo na lotação também encontra a sigla.
    with uow(org_tree["dirau"]["id"]) as ctx:
        assert org.org_view(ctx, org_tree["ws_dirau"])["unit"] == "DIRAU"


def test_nada_sobe_sem_compartilhar(org_tree):
    assert not _sees(org_tree["cotin"], org_tree["ws_cotin"], org_tree["pid"])
    with uow(org_tree["cotin"]["id"]) as ctx, pytest.raises(ForbiddenError):
        project_access(ctx, org_tree["pid"])


def test_compartilhar_com_a_cotin_da_leitura_conforme_a_matriz(org_tree):
    t = org_tree
    with uow(t["disid"]["id"]) as ctx:
        org.share_up(ctx, t["ws_disid"], t["pid"])
    assert _sees(t["cotin"], t["ws_cotin"], t["pid"])
    assert _sees(t["cotin_ger"], t["ws_cotin"], t["pid"])  # Gerente tem org.view_shared
    assert not _sees(t["cotin_leitor"], t["ws_cotin"], t["pid"])  # Leitor não, por padrão
    assert not _sees(t["coint"], t["ws_coint"], t["pid"])  # não pula nível
    with uow(t["cotin"]["id"]) as ctx:
        [p] = [p for p in projects.list_projects(ctx, t["ws_cotin"]) if p["id"] == t["pid"]]
        assert p["shared_from"] == "DISID"
        assert t["pid"] in {r["id"] for r in formal.portfolio(ctx, t["ws_cotin"])}
        a = project_access(ctx, t["pid"])
        assert not (a.can_write or a.can_manage or a.can_comment)
        assert tasks.get_task(ctx, t["tid"])["task"]["title"] == "Homologar"
        with pytest.raises(ForbiddenError):
            tasks.update_task(ctx, t["tid"], {"title": "Mudar"})
        with pytest.raises(ForbiddenError):
            comments.add_comment(ctx, t["tid"], "Da COTIN")
        with pytest.raises(ForbiddenError):
            tasks.create_task(ctx, t["ws_disid"], t["pid"], {"title": "Intrusa"})
    # O Gestor da COTIN libera o Leitor pela matriz.
    with uow(t["cotin"]["id"]) as ctx:
        cur = workspaces.get_permissions(ctx, t["ws_cotin"])["permissions"]
        workspaces.set_permissions(ctx, t["ws_cotin"], {**cur, "viewer": ["org.view_shared"]})
    assert _sees(t["cotin_leitor"], t["ws_cotin"], t["pid"])


def test_cotin_decide_o_que_sobe_e_desfazer_desce_em_cascata(org_tree):
    t = org_tree
    with uow(t["disid"]["id"]) as ctx:
        org.share_up(ctx, t["ws_disid"], t["pid"])
    with uow(t["cotin"]["id"]) as ctx:
        org.share_up(ctx, t["ws_cotin"], t["pid"])  # repassa à COINT
    assert _sees(t["coint"], t["ws_coint"], t["pid"])
    # A COTIN recolhe: a COINT deixa de ver, a COTIN continua vendo.
    with uow(t["cotin"]["id"]) as ctx:
        org.unshare_up(ctx, t["ws_cotin"], t["pid"])
    assert not _sees(t["coint"], t["ws_coint"], t["pid"])
    assert _sees(t["cotin"], t["ws_cotin"], t["pid"])
    # DISID recolhe tudo, inclusive o que tivesse subido além da COTIN.
    with uow(t["cotin"]["id"]) as ctx:
        org.share_up(ctx, t["ws_cotin"], t["pid"])
    with uow(t["disid"]["id"]) as ctx:
        org.unshare_up(ctx, t["ws_disid"], t["pid"])
    assert not _sees(t["cotin"], t["ws_cotin"], t["pid"])
    assert not _sees(t["coint"], t["ws_coint"], t["pid"])


def test_so_o_gestor_de_quem_tem_o_projeto_compartilha(org_tree):
    t = org_tree
    with uow(t["disid2"]["id"]) as ctx, pytest.raises(ForbiddenError):
        org.share_up(ctx, t["ws_disid"], t["pid"])  # Gerente de DISID não é Gestor
    with uow(t["dirau"]["id"]) as ctx, pytest.raises(ForbiddenError):
        org.share_up(ctx, t["ws_dirau"], t["pid"])  # DIRAU não tem o projeto
    with uow(t["cotin"]["id"]) as ctx, pytest.raises(ForbiddenError):
        org.share_up(ctx, t["ws_cotin"], t["pid"])  # COTIN ainda não recebeu
    with uow(t["coint"]["id"]) as ctx, pytest.raises(ForbiddenError):
        org.unshare_up(ctx, t["ws_coint"], t["pid"])
    with uow(t["dirau"]["id"]) as ctx, pytest.raises(ForbiddenError):
        org.share_up(ctx, t["ws_disid"], t["pid"])  # não é membro do espaço de DISID


def test_espaco_fora_do_organograma_nao_compartilha(org_tree):
    gestor = make_user("solto")
    ws = make_team(gestor, "Equipe solta")
    pid = make_project(gestor, ws, "Projeto solto")
    with uow(gestor["id"]) as ctx:
        assert org.org_view(ctx, ws)["unit"] is None
        with pytest.raises(BadRequestError):
            org.share_up(ctx, ws, pid)


def test_compartilhar_todos(org_tree):
    t = org_tree
    outro = make_project(t["disid"], t["ws_disid"], "Outro")
    with uow(t["disid"]["id"]) as ctx:
        assert org.share_all_up(ctx, t["ws_disid"]) == 2
        assert org.share_all_up(ctx, t["ws_disid"]) == 0
    assert _sees(t["cotin"], t["ws_cotin"], outro)
    with uow(t["cotin"]["id"]) as ctx:
        v = org.org_view(ctx, t["ws_cotin"])
    assert {r["origin_unit"] for r in v["received"]} == {"DISID"}
    assert {c["sigla"] for c in v["children"]} == {"DIGTI", "DISEG", "DISID", "DIRAU"}


def test_mesma_unidade_com_lotacao_escrita_diferente_nao_vira_segundo_espaco_oficial():
    a = make_user("um", allotment="DISEG")
    b = make_user("dois", allotment="COTIN/DISEG")
    with uow(a["id"]) as ctx:
        assert org.org_view(ctx, _unit_ws(a))["unit"] == "DISEG"
    with uow(b["id"]) as ctx:
        assert org.org_view(ctx, _unit_ws(b))["unit"] is None


def test_membro_de_outro_espaco_nao_le_a_organizacao(org_tree):
    with uow(org_tree["coint"]["id"]) as ctx, pytest.raises(ForbiddenError):
        org.org_view(ctx, org_tree["ws_disid"])
