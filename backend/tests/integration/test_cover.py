"""Capa do projeto: quem vê, quem troca, o que é aceito, e a mesma regra pela API HTTP."""

import pytest
from fastapi.testclient import TestClient

from helpers import install_fake_gia, join, make_project, make_team, make_user
from projeta.api.app import app
from projeta.db import uow
from projeta.errors import BadRequestError, ForbiddenError
from projeta.work import covers, formal, projects

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64
JPG = b"\xff\xd8\xff\xe0" + b"0" * 64
WEBP = b"RIFF\x10\x00\x00\x00WEBPVP8 " + b"0" * 32


@pytest.fixture
def cena():
    ana = make_user("Ana")  # gerente, cria o projeto
    bia = make_user("Bia")  # membro do projeto
    eva = make_user("Eva")  # fora do espaço
    ws = make_team(ana)
    join(ana, ws, bia, "member")
    pid = make_project(ana, ws, "Portal", members=(bia,))
    return {"ana": ana, "bia": bia, "eva": eva, "ws": ws, "pid": pid}


def test_gerente_define_e_membro_le_mas_nao_troca(cena):
    pid = cena["pid"]
    with uow(cena["ana"]["id"]) as ctx:
        v = covers.set_cover(ctx, pid, PNG)["cover_version"]
        assert projects.get_project(ctx, pid)["project"]["cover_version"] == v
        assert covers.get_cover(ctx, pid)["content_type"] == "image/png"
        covers.set_cover(ctx, pid, JPG)  # trocar sobrescreve
        assert covers.get_cover(ctx, pid)["content_type"] == "image/jpeg"
    with uow(cena["bia"]["id"]) as ctx:
        assert bytes(covers.get_cover(ctx, pid)["data"]) == JPG
        with pytest.raises(ForbiddenError):
            covers.set_cover(ctx, pid, PNG)
        with pytest.raises(ForbiddenError):
            covers.delete_cover(ctx, pid)


def test_acesso_cruzado_nega_leitura_e_escrita(cena):
    with uow(cena["ana"]["id"]) as ctx:
        covers.set_cover(ctx, cena["pid"], PNG)
    with uow(cena["eva"]["id"]) as ctx:
        with pytest.raises(ForbiddenError):
            covers.get_cover(ctx, cena["pid"])
        with pytest.raises(ForbiddenError):
            covers.set_cover(ctx, cena["pid"], PNG)
        with pytest.raises(ForbiddenError):
            covers.get_cover(ctx, "00000000-0000-0000-0000-000000000000")  # inexistente = negado


def test_so_aceita_png_jpeg_webp_e_ate_3mb(cena):
    with uow(cena["ana"]["id"]) as ctx:
        assert covers.set_cover(ctx, cena["pid"], WEBP)
        for ruim in (b"", b"<svg onload=alert(1)/>", b"GIF89a" + b"0" * 10, b"%PDF-1.7"):
            with pytest.raises(BadRequestError):
                covers.set_cover(ctx, cena["pid"], ruim)
        with pytest.raises(BadRequestError):
            covers.set_cover(ctx, cena["pid"], PNG + b"0" * covers.MAX_BYTES)


def test_remover_e_listagem(cena):
    with uow(cena["ana"]["id"]) as ctx:
        covers.set_cover(ctx, cena["pid"], PNG)
        assert projects.list_projects(ctx, cena["ws"])[0]["cover_version"] is not None
        assert formal.portfolio(ctx, cena["ws"])[0]["cover_version"] is not None
        covers.delete_cover(ctx, cena["pid"])
        assert covers.get_cover(ctx, cena["pid"]) is None
        assert projects.list_projects(ctx, cena["ws"])[0]["cover_version"] is None


def test_http_put_get_delete_e_terceira_conta(monkeypatch):
    gia = install_fake_gia(monkeypatch)
    h = {"X-Requested-With": "projeta-web"}

    def login(n: str) -> TestClient:
        gia.add(n, email=f"{n}@ex.com", name=n.title())
        c = TestClient(app, headers=h)
        r = c.post("/api/v1/auth/login", json={"matricula": n, "password": "senha-gia"})
        assert r.status_code == 200, r.text
        return c

    ana, eva = login("ana"), login("eva")
    ws = ana.get("/api/v1/me").json()["workspaces"][0]["id"]
    pid = ana.post("/api/v1/projects", json={"workspace_id": ws, "name": "Portal"}).json()["id"]
    url = f"/api/v1/projects/{pid}/cover"
    assert ana.get(url).status_code == 404  # sem capa ainda
    # corpo cru com tipo declarado falso: vale o conteúdo, não o cabeçalho
    r = ana.put(url, content=PNG, headers={"Content-Type": "text/html"})
    assert r.status_code == 200, r.text
    got = ana.get(url)
    assert (got.status_code, got.headers["content-type"], got.content) == (200, "image/png", PNG)
    assert got.headers["x-content-type-options"] == "nosniff"
    assert ana.put(url, content=b"<script>1</script>").status_code == 400
    assert eva.get(url).status_code == 403
    assert eva.put(url, content=PNG).status_code == 403
    assert TestClient(app).put(url, content=PNG).status_code == 403  # sem cabeçalho CSRF
    assert eva.delete(url).status_code == 403
    assert ana.delete(url).status_code == 204
    assert ana.get(url).status_code == 404
