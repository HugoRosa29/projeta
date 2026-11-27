"""Foto de perfil: cada pessoa só envia e remove a própria; vê a de quem divide espaço com ela;
vale o conteúdo, não o cabeçalho."""

import pytest
from fastapi.testclient import TestClient

from helpers import NOBODY, install_fake_gia, join, make_project, make_team, make_user
from projeta.api.app import app
from projeta.db import uow
from projeta.errors import BadRequestError, ForbiddenError
from projeta.identity import photos, workspaces
from projeta.work import projects

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64
WEBP = b"RIFF\x10\x00\x00\x00WEBPVP8 " + b"0" * 32


def test_envia_troca_e_remove_a_propria_foto_e_o_perfil_traz_a_versao():
    ana = make_user("ana")
    with uow(ana["id"]) as ctx:
        assert workspaces.my_profile(ctx)["photo_version"] is None
        v = photos.set_my_photo(ctx, PNG)["photo_version"]
        assert workspaces.my_profile(ctx)["photo_version"] == v
        photos.set_my_photo(ctx, WEBP)  # trocar sobrescreve
        assert photos.get_my_photo(ctx)["content_type"] == "image/webp"
        photos.delete_my_photo(ctx)
        assert photos.get_my_photo(ctx) is None
        assert workspaces.my_profile(ctx)["photo_version"] is None


def test_foto_de_uma_pessoa_nao_aparece_para_outra():
    ana, beto = make_user("ana"), make_user("beto")
    with uow(ana["id"]) as ctx:
        photos.set_my_photo(ctx, PNG)
    with uow(beto["id"]) as ctx:
        assert photos.get_my_photo(ctx) is None
        photos.delete_my_photo(ctx)  # só alcança a linha de quem está na sessão
    with uow(ana["id"]) as ctx:
        assert bytes(photos.get_my_photo(ctx)["data"]) == PNG


def test_so_aceita_png_jpeg_webp_e_ate_1mb():
    ana = make_user("ana")
    with uow(ana["id"]) as ctx:
        for ruim in (b"", b"<svg onload=alert(1)/>", b"GIF89a" + b"0" * 10, b"%PDF-1.7"):
            with pytest.raises(BadRequestError):
                photos.set_my_photo(ctx, ruim)
        with pytest.raises(BadRequestError):
            photos.set_my_photo(ctx, PNG + b"0" * photos.MAX_BYTES)


def test_http_put_get_delete(monkeypatch):
    gia = install_fake_gia(monkeypatch)
    h = {"X-Requested-With": "projeta-web"}

    def login(n: str) -> TestClient:
        gia.add(n, email=f"{n}@ex.com", name=n.title())
        c = TestClient(app, headers=h)
        r = c.post("/api/v1/auth/login", json={"matricula": n, "password": "senha-gia"})
        assert r.status_code == 200, r.text
        return c

    ana, eva = login("ana"), login("eva")
    url = "/api/v1/me/photo"
    assert ana.get(url).status_code == 404
    r = ana.put(url, content=PNG, headers={"Content-Type": "text/html"})
    assert r.status_code == 200, r.text
    got = ana.get(url)
    assert (got.status_code, got.headers["content-type"], got.content) == (200, "image/png", PNG)
    assert got.headers["x-content-type-options"] == "nosniff"
    assert eva.get(url).status_code == 404  # a rota só serve a foto de quem está na sessão
    assert ana.put(url, content=b"<script>1</script>").status_code == 400
    assert TestClient(app).put(url, content=PNG).status_code == 403  # sem cabeçalho CSRF
    assert ana.delete(url).status_code == 204
    assert ana.get(url).status_code == 404


def test_ve_a_foto_de_quem_divide_espaco_e_so_dela():
    ana, bia, caio = make_user("ana"), make_user("bia"), make_user("caio")
    ws = make_team(ana)
    join(ana, ws, bia, "member")
    with uow(bia["id"]) as ctx:
        photos.set_my_photo(ctx, PNG)
    with uow(caio["id"]) as ctx:
        photos.set_my_photo(ctx, PNG)
    pid = make_project(ana, ws, members=(bia,))
    with uow(ana["id"]) as ctx:
        assert bytes(photos.get_user_photo(ctx, bia["id"])["data"]) == PNG
        assert photos.get_user_photo(ctx, ana["id"]) is None  # a própria, ainda sem foto
        # a equipe do projeto e a lista do espaço trazem a versão para o avatar
        team = {m["id"]: m["photo_version"] for m in projects.get_project(ctx, pid)["members"]}
        assert team[bia["id"]] is not None and team[ana["id"]] is None
        listed = {m["id"]: m["photo_version"] for m in workspaces.list_members(ctx, ws)}
        assert listed[bia["id"]] is not None
        # fora de todos os espaços de Ana, inexistente ou ID inválido: mesma resposta
        for alvo in (caio["id"], NOBODY, "nao-e-uuid"):
            with pytest.raises(ForbiddenError):
                photos.get_user_photo(ctx, alvo)


def test_http_foto_de_colega(monkeypatch):
    gia = install_fake_gia(monkeypatch)
    h = {"X-Requested-With": "projeta-web"}

    def login(n: str) -> tuple[TestClient, str]:
        gia.add(n, email=f"{n}@ex.com", name=n.title(), sg_lotacao="DIRAU")
        c = TestClient(app, headers=h)
        r = c.post("/api/v1/auth/login", json={"matricula": n, "password": "senha-gia"})
        assert r.status_code == 200, r.text
        return c, c.get("/api/v1/me").json()["user"]["id"]

    (ana, _), (eva, eva_id) = login("ana"), login("eva")
    assert eva.put("/api/v1/me/photo", content=PNG).status_code == 200
    got = ana.get(f"/api/v1/users/{eva_id}/photo")  # mesma lotação: mesmo espaço da unidade
    assert (got.status_code, got.content) == (200, PNG)
    assert got.headers["x-content-type-options"] == "nosniff"
    gia.add("zeca", email="zeca@ex.com", name="Zeca", sg_lotacao="OUTRA")
    zeca = TestClient(app, headers=h)
    assert (
        zeca.post(
            "/api/v1/auth/login", json={"matricula": "zeca", "password": "senha-gia"}
        ).status_code
        == 200
    )
    assert zeca.get(f"/api/v1/users/{eva_id}/photo").status_code == 403
    assert zeca.get(f"/api/v1/users/{NOBODY}/photo").status_code == 403
