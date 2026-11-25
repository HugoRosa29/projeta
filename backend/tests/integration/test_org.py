"""Organograma: espaço da lotação = unidade; projetos sobem um nível por vez, sempre só leitura."""

import pytest

from helpers import NOBODY, make_project, make_team, make_user
from projeta.db import uow
from projeta.errors import BadRequestError, ForbiddenError
from projeta.identity import auth, workspaces
from projeta.identity.access import project_access
from projeta.work import comments, formal, org, projects, tasks

# Titulares da planilha (migração 019), como estão lá.
HEADS = {
    "DISID": "Romildo Ribeiro dos Santos",
    "DIRAU": "Daniel Reis Santos",
    "COTIN": "Júlio Cézar Schettini Henriques",
    "COINT": "Luiz Cláudio de Freitas",
    "GEPES": "Juracir Santos Júnior",
}


def _unit_ws(user: dict) -> str:
    with uow(user["id"]) as ctx:
        return next(w["id"] for w in workspaces.list_my_workspaces(ctx) if w["kind"] == "team")


def _sees(user: dict, ws: str, pid: str) -> bool:
    with uow(user["id"]) as ctx:
        return pid in {p["id"] for p in projects.list_projects(ctx, ws)}


@pytest.fixture
def org_tree():
    """DISID e DIRAU sob COTIN, sob COINT. A primeira pessoa de cada lotação é a titular da
    unidade (migração 019), portanto a Gestora."""
    disid = make_user("disid1", allotment="DISID", full_name=HEADS["DISID"])
    disid2 = make_user("disid2", allotment="disid")
    dirau = make_user("dirau1", allotment="COINT/COTIN/DIRAU", full_name=HEADS["DIRAU"])
    cotin = make_user("cotin1", allotment="COTIN", full_name=HEADS["COTIN"])
    cotin_ger = make_user("cotin2", allotment="COTIN")
    cotin_leitor = make_user("cotin3", allotment="COTIN")
    coint = make_user("coint1", allotment="COINT", full_name=HEADS["COINT"])
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


def test_espaco_da_lotacao_e_a_unidade_e_a_titular_e_gestora(org_tree):
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
        # O portfólio diz de qual espaço é cada projeto: a interface separa por área.
        rows = {r["id"]: r for r in formal.portfolio(ctx, t["ws_cotin"])}
        assert rows[t["pid"]]["workspace_id"] == t["ws_disid"]
        assert rows[t["pid"]]["shared_from"] == "DISID"
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


def _role(user: dict, ws: str) -> str | None:
    with uow(user["id"]) as ctx:
        return next((w["role"] for w in workspaces.list_my_workspaces(ctx) if w["id"] == ws), None)


def test_quem_entra_primeiro_nao_vira_gestor_se_a_unidade_tem_titular():
    primeiro = make_user("diseg1", allotment="DISEG")
    ws = _unit_ws(primeiro)
    assert _role(primeiro, ws) == "manager"
    # Espaço sem titular cadastrado mantém a regra antiga (ADR 0004).
    solto = make_user("getin1", allotment="GETIN")
    assert _role(solto, _unit_ws(solto)) == "admin"


def test_titular_vira_gestor_mesmo_entrando_depois_e_com_o_nome_escrito_diferente():
    primeiro = make_user("disid1", allotment="DISID")
    ws = _unit_ws(primeiro)
    # O GIA devolve em maiúsculas, sem acento e com espaço sobrando.
    titular = make_user("romildo", allotment="DISID", full_name="  ROMILDO  RIBEIRO DOS SANTOS ")
    assert _role(titular, ws) == "admin"
    assert _role(primeiro, ws) == "manager"


def test_titular_de_unidade_fora_da_propria_lotacao_vira_gestor_dela():
    # Quem responde pela GEPES está lotado em outra unidade; o espaço da GEPES pode existir
    # antes ou depois da entrada dele.
    titular = make_user("juracir", allotment="DISEG", full_name=HEADS["GEPES"])
    lotado = make_user("gepes1", allotment="GEPES")
    ws_gepes = _unit_ws(lotado)
    assert _role(titular, ws_gepes) == "admin"
    assert _role(lotado, ws_gepes) == "manager"


def test_titular_rebaixado_volta_a_gestor_na_proxima_entrada():
    titular = make_user("cotin1", allotment="COTIN", full_name=HEADS["COTIN"])
    outro = make_user("cotin2", allotment="COTIN")
    ws = _unit_ws(titular)
    with uow(titular["id"]) as ctx:
        workspaces.set_member_role(ctx, ws, outro["id"], "admin")
    with uow(outro["id"]) as ctx:
        workspaces.set_member_role(ctx, ws, titular["id"], "manager")
    make_user("cotin1", allotment="COTIN", full_name=HEADS["COTIN"])
    assert _role(titular, ws) == "admin"


def test_conta_local_com_o_nome_do_titular_nao_vira_gestor():
    with uow(NOBODY) as ctx:
        falso = auth.register(ctx, HEADS["DISID"], "falso@ex.com", "senha-longa-1")
    lotado = make_user("disid1", allotment="DISID")
    ws = _unit_ws(lotado)
    assert _role(falso, ws) is None


@pytest.fixture
def lateral(org_tree):
    """GEPES (outra diretoria) e o titular dela; DIRAF fica acima da GEPES."""
    t = dict(org_tree)
    t["gepes"] = make_user("juracir", allotment="GEPES", full_name=HEADS["GEPES"])
    t["gepes_ger"] = make_user("gepes2", allotment="GEPES")
    t["diraf"] = make_user("diraf1", allotment="DIRAF", full_name="Kaline Gonzaga Costa")
    t["ws_gepes"], t["ws_diraf"] = _unit_ws(t["gepes"]), _unit_ws(t["diraf"])
    return t


def test_compartilhar_direto_com_setor_fora_da_hierarquia_da_so_leitura(lateral):
    t = lateral
    with uow(t["disid"]["id"]) as ctx:
        org.share_direct(ctx, t["ws_disid"], t["pid"], "GEPES")
        own = org.org_view(ctx, t["ws_disid"])["own"]
    assert next(p for p in own if p["id"] == t["pid"])["direct"] == ["GEPES"]
    assert _sees(t["gepes"], t["ws_gepes"], t["pid"])
    assert _sees(t["gepes_ger"], t["ws_gepes"], t["pid"])  # Gerente tem org.view_shared
    with uow(t["gepes"]["id"]) as ctx:
        a = project_access(ctx, t["pid"])
        assert not (a.can_write or a.can_manage or a.can_comment)
        with pytest.raises(ForbiddenError):
            tasks.update_task(ctx, t["tid"], {"title": "Mudou"})
    # Não sobe pela hierarquia de quem recebeu, nem para a de quem mandou.
    assert not _sees(t["diraf"], t["ws_diraf"], t["pid"])
    assert not _sees(t["cotin"], t["ws_cotin"], t["pid"])


def test_quem_recebeu_direto_nao_repassa(lateral):
    t = lateral
    with uow(t["disid"]["id"]) as ctx:
        org.share_direct(ctx, t["ws_disid"], t["pid"], "GEPES")
    with uow(t["gepes"]["id"]) as ctx:
        received = org.org_view(ctx, t["ws_gepes"])["received"]
        assert [(r["id"], r["can_repass"]) for r in received] == [(t["pid"], False)]
        with pytest.raises(ForbiddenError):
            org.share_up(ctx, t["ws_gepes"], t["pid"])
        with pytest.raises(ForbiddenError):
            org.share_direct(ctx, t["ws_gepes"], t["pid"], "COINT")


def test_so_o_gestor_do_espaco_dono_compartilha_direto(lateral):
    t = lateral
    with uow(t["disid2"]["id"]) as ctx, pytest.raises(ForbiddenError):
        org.share_direct(ctx, t["ws_disid"], t["pid"], "GEPES")  # Gerente, não Gestor
    with uow(t["gepes"]["id"]) as ctx, pytest.raises(ForbiddenError):
        org.share_direct(ctx, t["ws_disid"], t["pid"], "GEPES")  # não é membro de DISID
    with uow(t["gepes"]["id"]) as ctx, pytest.raises(ForbiddenError):
        org.share_direct(ctx, t["ws_gepes"], t["pid"], "COINT")  # projeto de outro espaço
    with uow(t["disid"]["id"]) as ctx:
        for alvo in ("NAOEXISTE", "DISID", "COTIN"):  # inexistente, a própria, a de cima
            with pytest.raises(BadRequestError):
                org.share_direct(ctx, t["ws_disid"], t["pid"], alvo)


def test_direto_e_hierarquia_para_a_mesma_unidade_se_desfazem_separados(lateral):
    t = lateral
    with uow(t["disid"]["id"]) as ctx:
        org.share_direct(ctx, t["ws_disid"], t["pid"], "COINT")  # pula a COTIN
        org.share_up(ctx, t["ws_disid"], t["pid"])
    with uow(t["cotin"]["id"]) as ctx:
        org.share_up(ctx, t["ws_cotin"], t["pid"])  # COINT também recebe pela hierarquia
        org.unshare_up(ctx, t["ws_cotin"], t["pid"])
    assert _sees(t["coint"], t["ws_coint"], t["pid"])  # o direto continua
    with uow(t["disid"]["id"]) as ctx:
        org.unshare_direct(ctx, t["ws_disid"], t["pid"], "COINT")
    assert not _sees(t["coint"], t["ws_coint"], t["pid"])
    assert _sees(t["cotin"], t["ws_cotin"], t["pid"])
