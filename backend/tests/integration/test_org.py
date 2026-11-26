"""Organograma: espaço da lotação = unidade; projetos sobem um nível por vez, sempre só leitura."""

from datetime import date
from pathlib import Path

import pytest

from helpers import NOBODY, make_project, make_team, make_user
from projeta import db
from projeta.db import uow
from projeta.errors import BadRequestError, ForbiddenError
from projeta.identity import auth, workspaces
from projeta.identity.access import project_access
from projeta.work import comments, formal, okrs, org, projects, tasks

# Titulares da planilha (migração 019), como estão lá.
HEADS = {
    "DISID": "Romildo Ribeiro dos Santos",
    "DIRAU": "Daniel Reis Santos",
    "COTIN": "Júlio Cézar Schettini Henriques",
    "COINT": "Luiz Cláudio de Freitas",
    "GEPES": "Juracir Santos Júnior",
}


MIGRATIONS = Path(__file__).resolve().parents[2] / "migrations"


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


def test_organograma_inteiro_vem_com_a_unidade_de_cima_de_cada_uma(org_tree):
    with uow(org_tree["disid"]["id"]) as ctx:
        tree = {u["sigla"]: u for u in org.org_view(ctx, org_tree["ws_disid"])["tree"]}
    assert tree["DISID"]["parent"] == "COTIN" and tree["DISID"]["has_space"]
    assert tree["COTIN"]["parent"] == "COINT"
    assert tree["PRESIDENCIA"]["parent"] is None


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


def test_mesma_sigla_com_lotacao_escrita_diferente_cai_no_mesmo_espaco_oficial():
    a = make_user("um", allotment="DISEG")
    b = make_user("dois", allotment="COTIN/DISEG")
    # Formato que o GIA devolve em produção: sigla, sigla de novo e o nome por extenso.
    c = make_user("tres", allotment="DISEG - DISEG - DIVISÃO DE SEGURANÇA DA INFORMAÇÃO")
    assert _unit_ws(a) == _unit_ws(b) == _unit_ws(c)
    with uow(c["id"]) as ctx:
        assert org.org_view(ctx, _unit_ws(c))["unit"] == "DISEG"


def test_lotacao_do_gia_por_extenso_vincula_o_titular_a_unidade():
    lotado = make_user("dirau2", allotment="DIRAU")
    titular = make_user(
        "dirau1",
        allotment="DIRAU - DIRAU - DIVISÃO DE INFRAESTRUT DE REDES E ATEND AO USUARIO",
        full_name=HEADS["DIRAU"],
    )
    ws = _unit_ws(lotado)
    assert _role(titular, ws) == "admin"
    assert _role(lotado, ws) == "manager"


def test_lotacao_sem_sigla_conhecida_fica_fora_da_organizacao():
    a = make_user("um", allotment="SETOR INEXISTENTE")
    b = make_user("dois", allotment="setor inexistente")
    assert _unit_ws(a) == _unit_ws(b)
    with uow(a["id"]) as ctx:
        assert org.org_view(ctx, _unit_ws(a))["unit"] is None


def test_migracao_vincula_quem_ja_tinha_conta_sem_novo_login():
    lotado = make_user("dirau2", allotment="DIRAU")
    ws = _unit_ws(lotado)
    titular = make_user("dirau1", allotment="DIRAU", full_name=HEADS["DIRAU"])
    # Simula a conta de antes da correção: lotada na DIRAU, mas fora do espaço oficial.
    with uow(NOBODY) as ctx:
        ctx.run("DELETE FROM workspace_members WHERE workspace_id = %s", (ws,))
    sql = (MIGRATIONS / "023_link_existing_users_to_unit.sql").read_text(encoding="utf-8")
    with db.transaction() as conn:
        conn.execute(sql)
    assert _role(lotado, ws) == "manager"
    assert _role(titular, ws) == "admin"


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


def _official(sigla: str) -> str | None:
    with uow(NOBODY) as ctx:
        row = ctx.one("SELECT id FROM workspaces WHERE org_unit = %s", (sigla,))
    return row["id"] if row else None


def test_titular_ganha_o_espaco_da_unidade_mesmo_sem_ninguem_lotado_nela():
    # Lotação do titular no GIA sem a sigla da unidade que ele chefia.
    titular = make_user("dirau1", allotment="SETOR SEM SIGLA", full_name=HEADS["DIRAU"])
    ws = _official("DIRAU")
    assert ws and _role(titular, ws) == "admin"
    lotado = make_user("dirau2", allotment="DIRAU - DIRAU - DIVISÃO DE INFRAESTRUT")
    assert _unit_ws(lotado) == ws and _role(lotado, ws) == "manager"


def _run_migration(name: str) -> None:
    with db.transaction() as conn:
        conn.execute((MIGRATIONS / name).read_text(encoding="utf-8"))


def test_migracao_cria_o_espaco_da_unidade_para_titular_que_ja_tinha_conta():
    titular = make_user("dirau1", full_name=HEADS["DIRAU"])
    # Estado de antes da correção: titular com conta e nenhum espaço oficial da DIRAU.
    with uow(NOBODY) as ctx:
        ctx.run("DELETE FROM workspaces WHERE org_unit = 'DIRAU'")
    assert _official("DIRAU") is None
    _run_migration("024_unit_heads_get_official_space.sql")
    ws = _official("DIRAU")
    assert ws and _role(titular, ws) == "admin"


def test_migracao_adota_espaco_comum_antigo_da_lotacao_como_oficial():
    lotado = make_user("dirau2", allotment="DIRAU - DIRAU - DIVISÃO DE INFRAESTRUT")
    antigo = _unit_ws(lotado)
    with uow(NOBODY) as ctx:
        ctx.run("UPDATE workspaces SET org_unit = NULL WHERE id = %s", (antigo,))
    _run_migration("024_unit_heads_get_official_space.sql")
    assert _official("DIRAU") == antigo


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


def _via(user: dict, ws: str, pid: str):
    with uow(user["id"]) as ctx:
        return {r["id"]: r for r in formal.portfolio(ctx, ws)}[pid]["via_unit"]


def test_cada_nivel_ve_o_projeto_pela_unidade_filha_direta(org_tree):
    """A COTIN agrupa por DISID; a COINT, pela COTIN (não pela DISID): só os filhos diretos."""
    t = org_tree
    with uow(t["disid"]["id"]) as ctx:
        org.share_up(ctx, t["ws_disid"], t["pid"])
    with uow(t["cotin"]["id"]) as ctx:
        org.share_up(ctx, t["ws_cotin"], t["pid"])
    assert _via(t["cotin"], t["ws_cotin"], t["pid"]) == {"sigla": "DISID", "label": "DISID"}
    assert _via(t["coint"], t["ws_coint"], t["pid"]) == {"sigla": "COTIN", "label": "COTIN"}
    assert _via(t["disid"], t["ws_disid"], t["pid"]) is None  # projeto do próprio espaço


def test_direto_de_fora_da_linha_fica_sem_unidade_filha(lateral):
    t = lateral
    with uow(t["disid"]["id"]) as ctx:
        org.share_direct(ctx, t["ws_disid"], t["pid"], "GEPES")
    assert _via(t["gepes"], t["ws_gepes"], t["pid"]) is None  # a interface usa o espaço de origem


# ---------- OKRs sobem como os projetos: um nível por vez, repassáveis, só leitura ----------

TZ = "America/Sao_Paulo"


@pytest.fixture
def okr_tree(org_tree):
    t = org_tree
    t["period"] = okrs.quarter_of(date.today())
    with uow(t["disid"]["id"]) as ctx:
        t["oid"] = okrs.create_objective(ctx, t["ws_disid"], "Rede estável", t["period"])["id"]
        t["kr"] = okrs.create_key_result(
            ctx,
            t["oid"],
            {"title": "Disponibilidade", "owner_id": t["disid"]["id"], "target_value": 99},
        )["id"]
        okrs.check_in(ctx, t["kr"], 50, "at_risk", "Troca de switch", TZ)
    return t


def _received(user: dict, ws: str) -> list[dict]:
    with uow(user["id"]) as ctx:
        return okrs.list_okrs(ctx, ws, TZ)["received"]["objectives"]


def _ids(user: dict, ws: str) -> set[str]:
    return {o["id"] for o in _received(user, ws)}


def test_okr_nada_sobe_sem_compartilhar(okr_tree):
    t = okr_tree
    assert _ids(t["cotin"], t["ws_cotin"]) == set()
    with uow(t["cotin"]["id"]) as ctx, pytest.raises(ForbiddenError):
        okrs.list_checkins(ctx, t["kr"])


def test_okr_cotin_ve_em_leitura_conforme_a_matriz(okr_tree):
    t = okr_tree
    with uow(t["disid"]["id"]) as ctx:
        org.share_objective_up(ctx, t["ws_disid"], t["oid"])
        v = org.org_view(ctx, t["ws_disid"])
    assert [o["shared_up"] for o in v["own_objectives"] if o["id"] == t["oid"]] == [True]
    [o] = _received(t["cotin"], t["ws_cotin"])
    assert o["shared_from"] == "DISID" and o["progress"] == 51
    [k] = o["key_results"]
    assert k["can_checkin"] is False
    assert t["oid"] in _ids(t["cotin_ger"], t["ws_cotin"])  # Gerente tem org.view_shared
    assert _ids(t["cotin_leitor"], t["ws_cotin"]) == set()  # Leitor não, por padrão
    assert _ids(t["coint"], t["ws_coint"]) == set()  # não pula nível
    with uow(t["cotin"]["id"]) as ctx:
        board = okrs.list_okrs(ctx, t["ws_cotin"], TZ)
        assert board["objectives"] == [] and board["summary"]["objectives"] == 0
        assert [c["note"] for c in okrs.list_checkins(ctx, t["kr"])] == ["Troca de switch"]
        with pytest.raises(ForbiddenError):
            okrs.check_in(ctx, t["kr"], 60, "on_track")
        with pytest.raises(ForbiddenError):
            okrs.update_objective(ctx, t["oid"], {"title": "Mudar"})
        with pytest.raises(ForbiddenError):
            okrs.create_key_result(ctx, t["oid"], {"title": "Intruso"})
        with pytest.raises(ForbiddenError):
            okrs.delete_key_result(ctx, t["kr"])
    with uow(t["coint"]["id"]) as ctx, pytest.raises(ForbiddenError):
        okrs.list_checkins(ctx, t["kr"])


def test_okr_cotin_repassa_e_desfazer_desce_em_cascata(okr_tree):
    t = okr_tree
    with uow(t["disid"]["id"]) as ctx:
        org.share_objective_up(ctx, t["ws_disid"], t["oid"])
    with uow(t["cotin"]["id"]) as ctx:
        org.share_objective_up(ctx, t["ws_cotin"], t["oid"])  # repassa à COINT
        [r] = org.org_view(ctx, t["ws_cotin"])["received_objectives"]
        assert r["origin_unit"] == "DISID" and r["shared_up"]
    assert t["oid"] in _ids(t["coint"], t["ws_coint"])
    with uow(t["cotin"]["id"]) as ctx:
        org.unshare_objective_up(ctx, t["ws_cotin"], t["oid"])
    assert _ids(t["coint"], t["ws_coint"]) == set()
    assert t["oid"] in _ids(t["cotin"], t["ws_cotin"])
    with uow(t["cotin"]["id"]) as ctx:
        org.share_objective_up(ctx, t["ws_cotin"], t["oid"])
    with uow(t["disid"]["id"]) as ctx:
        org.unshare_objective_up(ctx, t["ws_disid"], t["oid"])
    assert _ids(t["cotin"], t["ws_cotin"]) == set()
    assert _ids(t["coint"], t["ws_coint"]) == set()


def test_so_o_gestor_de_quem_tem_o_objetivo_compartilha(okr_tree):
    t = okr_tree
    with uow(t["disid2"]["id"]) as ctx, pytest.raises(ForbiddenError):
        org.share_objective_up(ctx, t["ws_disid"], t["oid"])  # Gerente não é Gestor
    with uow(t["dirau"]["id"]) as ctx, pytest.raises(ForbiddenError):
        org.share_objective_up(ctx, t["ws_dirau"], t["oid"])  # DIRAU não tem o objetivo
    with uow(t["cotin"]["id"]) as ctx, pytest.raises(ForbiddenError):
        org.share_objective_up(ctx, t["ws_cotin"], t["oid"])  # COTIN ainda não recebeu
    with uow(t["dirau"]["id"]) as ctx, pytest.raises(ForbiddenError):
        org.share_objective_up(ctx, t["ws_disid"], t["oid"])  # não é membro de DISID
    with uow(t["disid"]["id"]) as ctx, pytest.raises(ForbiddenError):
        org.share_objective_up(ctx, t["ws_disid"], "nao-e-uuid")


def test_rota_compartilha_objetivo(okr_tree, monkeypatch):
    from fastapi.testclient import TestClient

    from projeta.api.app import app
    from projeta.identity import auth

    t = okr_tree
    c = TestClient(app)
    c.headers["x-requested-with"] = "projeta-web"
    monkeypatch.setattr(auth, "user_from_token", lambda ctx, tok: t["disid"] | {"timezone": TZ})
    base = f"/api/v1/workspaces/{t['ws_disid']}/org/objective-shares"
    assert c.post(base, json={"objective_id": t["oid"]}).status_code == 204
    assert t["oid"] in _ids(t["cotin"], t["ws_cotin"])
    assert c.delete(f"{base}/{t['oid']}").status_code == 204
    assert _ids(t["cotin"], t["ws_cotin"]) == set()
