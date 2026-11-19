"""Entrada 100% pelo GIA: identidade por matrícula e espaço comum por lotação."""

import httpx
import pytest
from fastapi.testclient import TestClient

from helpers import NOBODY, install_fake_gia, make_project
from projeta.api.app import app
from projeta.db import uow
from projeta.errors import ForbiddenError
from projeta.identity import workspaces
from projeta.work import projects

H = {"X-Requested-With": "projeta-web"}


@pytest.fixture
def gia(monkeypatch):
    return install_fake_gia(monkeypatch)


def entrar(matricula: str, senha: str = "senha-gia") -> TestClient:
    c = TestClient(app, headers=H)
    r = c.post("/api/v1/auth/login", json={"matricula": matricula, "password": senha})
    c.last = r  # type: ignore[attr-defined]
    return c


def meus_espacos(c: TestClient) -> list[dict]:
    return c.get("/api/v1/me").json()["workspaces"]


def test_primeira_entrada_cria_conta_espaco_pessoal_e_espaco_da_lotacao(gia):
    gia.add("a123", name="Ana Souza", email="Ana@Terracap.df.gov.br", allotment="  GETIN  ")
    c = entrar("a123")
    assert c.last.status_code == 200
    user = c.last.json()["user"]
    assert user["name"] == "Ana Souza"
    assert user["email"] == "ana@terracap.df.gov.br"
    kinds = {(w["kind"], w["name"], w["role"]) for w in meus_espacos(c)}
    assert kinds == {("personal", "Espaço de Ana", "admin"), ("team", "GETIN", "manager")}


def test_chamada_ao_gia_usa_servico_sistema_e_matricula_em_maiusculas(gia):
    gia.add("a123", name="Ana")
    entrar("a123")
    call = gia.calls[0]
    assert call["url"] == "http://gia-api/auth/autenticar"
    assert call["json"]["sistema"] == 653
    assert call["json"]["matricula"] == "A123"
    assert call["json"]["senha"] == "senha-gia"


def test_mesma_lotacao_compartilha_o_espaco_e_outra_lotacao_fica_de_fora(gia):
    gia.add("a1", name="Ana", allotment="GETIN")
    gia.add("b2", name="Bia", allotment="getin")  # caixa diferente = mesma lotação
    gia.add("c3", name="Caio", allotment="ASCOM")
    ana, bia = entrar("a1"), entrar("b2")
    entrar("c3")
    ws_ana = next(w["id"] for w in meus_espacos(ana) if w["kind"] == "team")
    ws_bia = next(w["id"] for w in meus_espacos(bia) if w["kind"] == "team")
    assert ws_ana == ws_bia

    with uow(NOBODY) as ctx:
        ids = {r["matricula"]: r["id"] for r in ctx.all("SELECT id, matricula FROM users")}
    pid = make_project({"id": ids["A1"]}, ws_ana, "Projeto da GETIN", members=({"id": ids["B2"]},))
    with uow(ids["B2"]) as ctx:
        assert projects.get_project(ctx, pid)["project"]["id"] == pid
    # Acesso cruzado: lotação diferente não alcança o projeto nem o espaço, nem por ID.
    with uow(ids["C3"]) as ctx, pytest.raises(ForbiddenError):
        projects.get_project(ctx, pid)
    with uow(ids["C3"]) as ctx, pytest.raises(ForbiddenError):
        workspaces.list_members(ctx, ws_ana)


def test_nova_entrada_atualiza_perfil_sem_duplicar_e_mudar_de_lotacao_entra_no_novo_espaco(gia):
    gia.add("a1", name="Ana", allotment="GETIN")
    entrar("a1")
    gia.add("a1", name="Ana Maria Souza", allotment="ASCOM")
    c = entrar("a1")
    assert c.last.json()["user"]["name"] == "Ana Maria Souza"
    assert {w["name"] for w in meus_espacos(c) if w["kind"] == "team"} == {"GETIN", "ASCOM"}
    with uow(NOBODY) as ctx:
        assert ctx.one("SELECT count(*)::int AS n FROM users")["n"] == 1


def test_sem_lotacao_so_tem_espaco_pessoal(gia):
    gia.add("a1", name="Ana")
    c = entrar("a1")
    assert [w["kind"] for w in meus_espacos(c)] == ["personal"]


def test_email_ja_usado_por_outra_matricula_cai_no_email_de_reserva(gia):
    gia.add("a1", name="Ana", email="mesmo@x.gov.br")
    gia.add("b2", name="Bia", email="mesmo@x.gov.br")
    entrar("a1")
    c = entrar("b2")
    assert c.last.json()["user"]["email"] == "b2@gia.local"


def test_senha_errada_nao_cria_conta_nem_sessao(gia):
    gia.add("a1", name="Ana")
    c = entrar("a1", "errada")
    assert c.last.status_code == 401
    assert c.get("/api/v1/me").status_code == 401
    with uow(NOBODY) as ctx:
        assert ctx.one("SELECT count(*)::int AS n FROM users")["n"] == 0


def test_resposta_de_sucesso_sem_cd_usuario_nao_autentica(gia, monkeypatch):
    def vazio(url, json, **kw):
        return httpx.Response(200, json={"ok": True}, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx, "post", vazio)
    assert entrar("a1").last.status_code == 401


@pytest.mark.parametrize("falha", ["rede", "http500"])
def test_gia_fora_do_ar_responde_503_e_nao_existe_login_local(gia, falha):
    gia.add("a1", name="Ana")
    entrar("a1")  # a conta existe localmente, mas isso não vale como senha
    if falha == "rede":
        gia.down = httpx.ConnectError("sem rota")
    else:
        gia.status = 500
    c = entrar("a1")
    assert c.last.status_code == 503
    assert c.last.json()["error"]["code"] == "upstream_unavailable"
    assert c.get("/api/v1/me").status_code == 401


def test_login_do_gia_nao_aceita_corpo_com_email_e_nunca_chama_o_gia_sem_matricula(gia):
    c = TestClient(app, headers=H)
    r = c.post("/api/v1/auth/login", json={"email": "a@b.com", "password": "x"})
    assert r.status_code == 422
    assert gia.calls == []


def cadastrar(c: TestClient, email="ze@x.com", senha="senha-longa", nome="Zé Lima"):
    return c.post("/api/v1/auth/register", json={"name": nome, "email": email, "password": senha})


def test_cadastro_local_cria_conta_espaco_pessoal_e_sessao_sem_chamar_o_gia(gia):
    c = TestClient(app, headers=H)
    r = cadastrar(c, email="Ze@X.com")
    assert r.status_code == 200
    assert r.json()["user"]["email"] == "ze@x.com"
    assert [(w["kind"], w["role"]) for w in meus_espacos(c)] == [("personal", "admin")]
    assert gia.calls == []


def test_login_local_funciona_com_gia_fora_do_ar(gia):
    cadastrar(TestClient(app, headers=H))
    gia.down = httpx.ConnectError("sem rota")
    c = TestClient(app, headers=H)
    r = c.post("/api/v1/auth/login-local", json={"email": "ZE@x.com", "password": "senha-longa"})
    assert r.status_code == 200
    assert c.get("/api/v1/me").status_code == 200


def test_login_local_recusa_senha_errada_e_email_inexistente_com_a_mesma_resposta(gia):
    cadastrar(TestClient(app, headers=H))
    c = TestClient(app, headers=H)
    erradas = [("ze@x.com", "outra-senha"), ("nao@x.com", "senha-longa")]
    respostas = [
        c.post("/api/v1/auth/login-local", json={"email": e, "password": s}) for e, s in erradas
    ]
    assert [r.status_code for r in respostas] == [401, 401]
    assert respostas[0].json() == respostas[1].json()
    assert c.get("/api/v1/me").status_code == 401


def test_cadastro_recusa_email_repetido_senha_curta_e_email_invalido(gia):
    cadastrar(TestClient(app, headers=H))
    c = TestClient(app, headers=H)
    assert cadastrar(c).status_code == 409
    assert cadastrar(c, email="novo@x.com", senha="curta").status_code == 400
    assert cadastrar(c, email="sem-arroba").status_code == 400
    assert c.get("/api/v1/me").status_code == 401


def test_conta_do_gia_nao_tem_senha_local(gia):
    gia.add("a1", name="Ana", email="ana@x.com")
    entrar("a1")
    c = TestClient(app, headers=H)
    r = c.post("/api/v1/auth/login-local", json={"email": "ana@x.com", "password": "senha-gia"})
    assert r.status_code == 401
    assert cadastrar(c, email="ana@x.com").status_code == 409
