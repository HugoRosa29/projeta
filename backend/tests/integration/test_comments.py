"""Comentários na tarefa: leitura segue a tarefa, escrita exige edição, autor e gestão moderam."""

import pytest
from fastapi.testclient import TestClient

from helpers import install_fake_gia
from projeta.api.app import app
from projeta.db import uow
from projeta.errors import BadRequestError, ForbiddenError
from projeta.work import comments, projects, tasks
from tests.helpers import join, make_project, make_team, make_user


@pytest.fixture
def team():
    gp, membro, leitor, fora = (make_user(n) for n in ("gp", "membro", "leitor", "fora"))
    ws = make_team(gp)
    join(gp, ws, membro, "member")
    join(gp, ws, leitor, "viewer")
    pid = make_project(gp, ws, members=(membro, leitor))
    with uow(gp["id"]) as ctx:
        tid = tasks.create_task(ctx, ws, pid, {"title": "Validar integrações"})["id"]
    return {
        "gp": gp,
        "membro": membro,
        "leitor": leitor,
        "fora": fora,
        "ws": ws,
        "pid": pid,
        "tid": tid,
    }


def test_comentar_listar_editar_e_remover(team):
    with uow(team["membro"]["id"]) as ctx:
        c = comments.add_comment(ctx, team["tid"], "  Laesse validou as operações.  ")
        assert c["body"] == "Laesse validou as operações."
        assert c["author_name"]
    with uow(team["membro"]["id"]) as ctx:
        edited = comments.edit_comment(ctx, c["id"], "Laesse validou 3 de 4 operações.")
        assert edited["edited_at"] is not None
    with uow(team["leitor"]["id"]) as ctx:
        rows = comments.list_comments(ctx, team["tid"])
        assert [r["body"] for r in rows] == ["Laesse validou 3 de 4 operações."]
        assert rows[0]["can_edit"] is False and rows[0]["can_delete"] is False
    with uow(team["gp"]["id"]) as ctx:
        assert comments.list_comments(ctx, team["tid"])[0]["can_delete"] is True
        comments.delete_comment(ctx, c["id"])  # gerente modera
        assert comments.list_comments(ctx, team["tid"]) == []
        kinds = [a["kind"] for a in projects.get_project(ctx, team["pid"])["activity"]]
        assert "task.commented" in kinds


def test_historico_nao_guarda_o_texto_do_comentario(team):
    with uow(team["membro"]["id"]) as ctx:
        comments.add_comment(ctx, team["tid"], "conteúdo sensível")
        row = ctx.one("SELECT data FROM activity WHERE kind = 'task.commented'")
        assert "conteúdo sensível" not in str(row["data"])


def test_acesso_cruzado_e_papeis(team):
    with uow(team["membro"]["id"]) as ctx:
        cid = comments.add_comment(ctx, team["tid"], "Do membro")["id"]
    # Leitor lê mas não comenta; quem está fora nem lê, nem toca no comentário pelo ID.
    with pytest.raises(ForbiddenError), uow(team["leitor"]["id"]) as ctx:
        comments.add_comment(ctx, team["tid"], "Leitor tentando")
    for fn in (
        lambda ctx: comments.list_comments(ctx, team["tid"]),
        lambda ctx: comments.add_comment(ctx, team["tid"], "x"),
        lambda ctx: comments.edit_comment(ctx, cid, "x"),
        lambda ctx: comments.delete_comment(ctx, cid),
    ):
        with pytest.raises(ForbiddenError), uow(team["fora"]["id"]) as ctx:
            fn(ctx)
    # Outro membro não edita nem remove comentário alheio.
    with pytest.raises(ForbiddenError), uow(team["leitor"]["id"]) as ctx:
        comments.edit_comment(ctx, cid, "x")
    with pytest.raises(ForbiddenError), uow(team["leitor"]["id"]) as ctx:
        comments.delete_comment(ctx, cid)


def test_projeto_arquivado_fica_so_leitura(team):
    with uow(team["membro"]["id"]) as ctx:
        cid = comments.add_comment(ctx, team["tid"], "Antes de arquivar")["id"]
    with uow(team["gp"]["id"]) as ctx:
        projects.update_project(ctx, team["pid"], status="archived")
    with uow(team["membro"]["id"]) as ctx:
        assert len(comments.list_comments(ctx, team["tid"])) == 1
    with pytest.raises(ForbiddenError), uow(team["membro"]["id"]) as ctx:
        comments.add_comment(ctx, team["tid"], "Depois")
    with pytest.raises(ForbiddenError), uow(team["membro"]["id"]) as ctx:
        comments.edit_comment(ctx, cid, "Depois")


def test_texto_vazio_ou_longo_e_tarefa_pessoal():
    ana, bia = make_user("ana"), make_user("bia")
    with uow(ana["id"]) as ctx:
        tid = tasks.create_task(ctx, ana["personal_ws"], None, {"title": "Pessoal"})["id"]
        with pytest.raises(BadRequestError):
            comments.add_comment(ctx, tid, "   ")
        with pytest.raises(BadRequestError):
            comments.add_comment(ctx, tid, "a" * 5001)
        comments.add_comment(ctx, tid, "Lembrete só meu")
    with pytest.raises(ForbiddenError), uow(bia["id"]) as ctx:
        comments.list_comments(ctx, tid)


def test_excluir_tarefa_remove_comentarios(team):
    with uow(team["membro"]["id"]) as ctx:
        comments.add_comment(ctx, team["tid"], "Some junto")
        tasks.delete_task(ctx, team["tid"])
        assert ctx.one("SELECT count(*) AS n FROM task_comments")["n"] == 0


def test_rotas_http(monkeypatch):
    gia = install_fake_gia(monkeypatch)
    clients = {}
    for name in ("ana", "eva"):
        gia.add(name, email=f"{name}@ex.com", name=name.title())
        c = TestClient(app, headers={"X-Requested-With": "projeta-web"})
        assert (
            c.post(
                "/api/v1/auth/login", json={"matricula": name, "password": "senha-gia"}
            ).status_code
            == 200
        )
        clients[name] = c
    ana, eva = clients["ana"], clients["eva"]
    ws = ana.get("/api/v1/me").json()["workspaces"][0]["id"]
    tid = ana.post("/api/v1/tasks", json={"workspace_id": ws, "title": "Minha"}).json()["id"]
    r = ana.post(f"/api/v1/tasks/{tid}/comments", json={"body": "Primeira nota"})
    assert r.status_code == 201, r.text
    cid = r.json()["id"]
    assert ana.patch(f"/api/v1/comments/{cid}", json={"body": "Nota revista"}).status_code == 200
    assert ana.get(f"/api/v1/tasks/{tid}/comments").json()["comments"][0]["body"] == "Nota revista"
    assert eva.get(f"/api/v1/tasks/{tid}/comments").status_code == 403
    assert eva.delete(f"/api/v1/comments/{cid}").status_code == 403
    assert ana.delete(f"/api/v1/comments/{cid}").status_code == 204
    assert ana.post(f"/api/v1/tasks/{tid}/comments", json={"body": " "}).status_code == 400
