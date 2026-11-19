"""Matriz de permissões por espaço: o Gestor define o que cada perfil pode; o servidor aplica."""

import pytest
from fastapi.testclient import TestClient

from helpers import install_fake_gia, join, make_project, make_team, make_user
from projeta.api.app import app
from projeta.db import uow
from projeta.errors import BadRequestError, ForbiddenError
from projeta.identity import workspaces
from projeta.identity.access import project_access
from projeta.identity.policy import DEFAULT_PERMISSIONS, PERMISSIONS
from projeta.work import comments, projects, tasks


@pytest.fixture
def team():
    gestor, gerente, membro, leitor = (
        make_user(n) for n in ("gestor", "gerente", "membro", "leitor")
    )
    ws = make_team(gestor)
    join(gestor, ws, gerente, "manager")
    join(gestor, ws, membro, "member")
    join(gestor, ws, leitor, "viewer")
    pid = make_project(gestor, ws, members=(membro, leitor))
    with uow(gestor["id"]) as ctx:
        tid = tasks.create_task(ctx, ws, pid, {"title": "Levantar requisitos"})["id"]
    return {
        "gestor": gestor,
        "gerente": gerente,
        "membro": membro,
        "leitor": leitor,
        "ws": ws,
        "pid": pid,
        "tid": tid,
    }


def _set(user: dict, ws: str, **matrix: list[str]) -> dict:
    with uow(user["id"]) as ctx:
        current = workspaces.get_permissions(ctx, ws)["permissions"]
        return workspaces.set_permissions(ctx, ws, {**current, **matrix})


def test_espaco_novo_tem_a_matriz_padrao_igual_a_politica(team):
    """A migração (DEFAULT do banco) e a política em Python precisam concordar."""
    with uow(team["leitor"]["id"]) as ctx:
        got = workspaces.get_permissions(ctx, team["ws"])
    assert got["permissions"] == DEFAULT_PERMISSIONS
    assert [c["id"] for c in got["catalog"]] == list(PERMISSIONS)
    assert [r["id"] for r in got["roles"]] == ["manager", "member", "viewer"]


def test_so_o_gestor_edita_a_matriz(team):
    for who in ("gerente", "membro", "leitor"):
        with uow(team[who]["id"]) as ctx, pytest.raises(ForbiddenError):
            workspaces.set_permissions(ctx, team["ws"], {"viewer": list(PERMISSIONS)})
    out = _set(team["gestor"], team["ws"], viewer=["comment.write"])
    assert out["permissions"]["viewer"] == ["comment.write"]


def test_matriz_rejeita_perfil_e_permissao_invalidos(team):
    with uow(team["gestor"]["id"]) as ctx:
        with pytest.raises(BadRequestError):
            workspaces.set_permissions(ctx, team["ws"], {"admin": []})
        with pytest.raises(BadRequestError):
            workspaces.set_permissions(ctx, team["ws"], {"member": ["workspace.manage"]})
        with pytest.raises(BadRequestError):
            workspaces.set_permissions(ctx, team["gestor"]["personal_ws"], {"member": []})


def test_gestor_de_outro_espaco_nao_le_nem_edita_a_matriz(team):
    outro = make_user("outro")
    make_team(outro, "Outra equipe")
    with uow(outro["id"]) as ctx:
        with pytest.raises(ForbiddenError):
            workspaces.get_permissions(ctx, team["ws"])
        with pytest.raises(ForbiddenError):
            workspaces.set_permissions(ctx, team["ws"], {"viewer": list(PERMISSIONS)})


def test_comentar_e_editar_sao_permissoes_separadas(team):
    # Padrão: leitor não comenta.
    with uow(team["leitor"]["id"]) as ctx, pytest.raises(ForbiddenError):
        comments.add_comment(ctx, team["tid"], "Posso opinar?")
    _set(team["gestor"], team["ws"], viewer=["comment.write"], member=["task.write"])
    with uow(team["leitor"]["id"]) as ctx:
        c = comments.add_comment(ctx, team["tid"], "Agora posso.")
        detail = tasks.get_task(ctx, team["tid"])
        assert detail["can_comment"] and not detail["can_write"]
        with pytest.raises(ForbiddenError):
            tasks.update_task(ctx, team["tid"], {"title": "Mudar"}, detail["task"]["version"])
    with uow(team["membro"]["id"]) as ctx:
        with pytest.raises(ForbiddenError):
            comments.add_comment(ctx, team["tid"], "Sem permissão de comentar")
        assert tasks.get_task(ctx, team["tid"])["can_write"]
    # Quem perdeu a permissão não edita o próprio comentário antigo.
    _set(team["gestor"], team["ws"], viewer=[])
    with uow(team["leitor"]["id"]) as ctx, pytest.raises(ForbiddenError):
        comments.edit_comment(ctx, c["id"], "Editado")


def test_ver_todos_os_projetos_da_so_leitura(team):
    with uow(team["gerente"]["id"]) as ctx:
        with pytest.raises(ForbiddenError):
            project_access(ctx, team["pid"])
        assert projects.list_projects(ctx, team["ws"]) == []
    _set(team["gestor"], team["ws"], manager=[*DEFAULT_PERMISSIONS["manager"], "project.view_all"])
    with uow(team["gerente"]["id"]) as ctx:
        assert [p["id"] for p in projects.list_projects(ctx, team["ws"])] == [team["pid"]]
        a = project_access(ctx, team["pid"])
        assert not (a.can_write or a.can_manage or a.can_comment)
        with pytest.raises(ForbiddenError):
            tasks.create_task(ctx, team["ws"], team["pid"], {"title": "Intrusa"})
        with pytest.raises(ForbiddenError):
            projects.update_project(ctx, team["pid"], status="archived")
        assert tasks.get_task(ctx, team["tid"])["task"]["title"] == "Levantar requisitos"


def test_criar_projeto_segue_a_matriz(team):
    with uow(team["membro"]["id"]) as ctx, pytest.raises(ForbiddenError):
        projects.create_project(ctx, team["ws"], "Do membro")
    _set(team["gestor"], team["ws"], member=["project.create"], manager=[])
    with uow(team["membro"]["id"]) as ctx:
        assert projects.create_project(ctx, team["ws"], "Do membro")["id"]
    with uow(team["gerente"]["id"]) as ctx, pytest.raises(ForbiddenError):
        projects.create_project(ctx, team["ws"], "Do gerente")


def test_gestor_continua_podendo_tudo_com_a_matriz_vazia(team):
    _set(team["gestor"], team["ws"], manager=[], member=[], viewer=[])
    with uow(team["gestor"]["id"]) as ctx:
        assert projects.create_project(ctx, team["ws"], "Novo")["id"]
        a = project_access(ctx, team["pid"])
        assert a.can_write and a.can_manage and a.can_comment
        comments.add_comment(ctx, team["tid"], "Ok")


def test_minhas_permissoes_aparecem_na_lista_de_espacos(team):
    with uow(team["membro"]["id"]) as ctx:
        mine = next(w for w in workspaces.list_my_workspaces(ctx) if w["id"] == team["ws"])
    assert mine["permissions"] == ["task.write", "comment.write"]
    with uow(team["gestor"]["id"]) as ctx:
        mine = next(w for w in workspaces.list_my_workspaces(ctx) if w["id"] == team["ws"])
    assert mine["permissions"] == list(PERMISSIONS)


def test_convidar_exige_permissao_e_limita_o_perfil(team):
    with uow(team["membro"]["id"]) as ctx, pytest.raises(ForbiddenError):
        workspaces.create_invitation(ctx, team["ws"], "nova@ex.com", "viewer")
    _set(team["gestor"], team["ws"], member=["workspace.invite"])
    with uow(team["gestor"]["id"]) as ctx:
        do_gestor = workspaces.create_invitation(ctx, team["ws"], "gerente2@ex.com", "manager")
    with uow(team["membro"]["id"]) as ctx:
        for role in ("admin", "manager"):
            with pytest.raises(ForbiddenError):
                workspaces.create_invitation(ctx, team["ws"], "nova@ex.com", role)
        meu = workspaces.create_invitation(ctx, team["ws"], "nova@ex.com", "member")
        # Vê e revoga só os próprios convites; o do Gestor fica intacto.
        assert [i["id"] for i in workspaces.list_invitations(ctx, team["ws"])] == [meu["id"]]
        workspaces.revoke_invitation(ctx, team["ws"], do_gestor["id"])
        workspaces.revoke_invitation(ctx, team["ws"], meu["id"])
    with uow(team["gestor"]["id"]) as ctx:
        assert [i["id"] for i in workspaces.list_invitations(ctx, team["ws"])] == [do_gestor["id"]]


def test_rotas_http_da_matriz(monkeypatch):
    gia = install_fake_gia(monkeypatch)
    clients = {}
    for name in ("ana", "bia"):
        gia.add(name, email=f"{name}@ex.com", name=name.title())
        c = TestClient(app, headers={"X-Requested-With": "projeta-web"})
        assert (
            c.post(
                "/api/v1/auth/login", json={"matricula": name, "password": "senha-gia"}
            ).status_code
            == 200
        )
        clients[name] = c
    ana, bia = clients["ana"], clients["bia"]
    ws = ana.post("/api/v1/workspaces", json={"name": "Equipe"}).json()["id"]
    tok = ana.post(
        f"/api/v1/workspaces/{ws}/invitations", json={"email": "bia@ex.com", "role": "member"}
    )
    bia.post("/api/v1/invitations/accept", json={"token": tok.json()["token"]})

    body = {"permissions": {"manager": [], "member": ["project.create"], "viewer": []}}
    assert bia.put(f"/api/v1/workspaces/{ws}/permissions", json=body).status_code == 403
    r = ana.put(f"/api/v1/workspaces/{ws}/permissions", json=body)
    assert r.status_code == 200 and r.json()["permissions"]["member"] == ["project.create"]
    assert bia.get(f"/api/v1/workspaces/{ws}/permissions").status_code == 200
    me = bia.get("/api/v1/me").json()["workspaces"]
    assert next(w for w in me if w["id"] == ws)["permissions"] == ["project.create"]
    created = bia.post("/api/v1/projects", json={"workspace_id": ws, "name": "Da Bia"})
    assert created.status_code == 201
