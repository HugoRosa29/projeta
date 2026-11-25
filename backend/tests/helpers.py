import httpx

from projeta.db import uow
from projeta.identity import auth, workspaces
from projeta.work import projects

NOBODY = "00000000-0000-0000-0000-000000000000"


def make_user(
    name: str, email: str | None = None, allotment: str = "", full_name: str = ""
) -> dict:
    """Cria a pessoa como o login pelo GIA faria (sem rede); a matrícula é o nome em maiúsculas.

    `full_name` é o nome que o GIA devolveria (padrão: o próprio `name`); serve para casar com
    o titular da unidade em `org_unit_heads`.
    """
    with uow(NOBODY) as ctx:
        u = auth.provision_user(
            ctx, name, full_name or name, email or f"{name.lower()}@ex.com", allotment=allotment
        )
    with uow(u["id"]) as ctx:
        u["personal_ws"] = workspaces.list_my_workspaces(ctx)[0]["id"]
    return u


def make_team(owner: dict, name: str = "Equipe") -> str:
    with uow(owner["id"]) as ctx:
        return workspaces.create_team_workspace(ctx, name)["id"]


def join(owner: dict, ws: str, user: dict, role: str) -> None:
    with uow(owner["id"]) as ctx:
        inv = workspaces.create_invitation(ctx, ws, user["email"], role)
    with uow(user["id"]) as ctx:
        workspaces.accept_invitation(ctx, user, inv["token"])


def make_project(
    owner: dict, ws: str, name: str = "Projeto", members: tuple[dict, ...] = ()
) -> str:
    with uow(owner["id"]) as ctx:
        pid = projects.create_project(ctx, ws, name)["id"]
        for m in members:
            projects.add_project_member(ctx, pid, m["id"])
    return pid


class FakeGia:
    """GIA simulado: troca `httpx.post` e guarda as chamadas para os testes inspecionarem."""

    def __init__(self) -> None:
        self.accounts: dict[str, dict] = {}
        self.calls: list[dict] = []
        self.down: Exception | None = None
        self.status: int | None = None  # força um HTTP fixo (ex.: 500)

    def add(self, matricula: str, password: str = "senha-gia", **profile) -> None:  # noqa: S107
        self.accounts[matricula.upper()] = {"password": password, "profile": profile}

    def post(self, url: str, json: dict, **kwargs) -> httpx.Response:
        self.calls.append({"url": url, "json": json, **kwargs})
        req = httpx.Request("POST", url)
        if self.down:
            raise self.down
        if self.status:
            return httpx.Response(self.status, json={"erro": "falha"}, request=req)
        acc = self.accounts.get(json["matricula"])
        if not acc or acc["password"] != json["senha"]:
            return httpx.Response(401, json={"erro": "Usuário ou senha inválidos."}, request=req)
        return httpx.Response(
            200, json={"cd_usuario": 1000 + len(self.calls), **acc["profile"]}, request=req
        )


def install_fake_gia(monkeypatch) -> FakeGia:
    fake = FakeGia()
    monkeypatch.setattr(httpx, "post", fake.post)
    return fake
