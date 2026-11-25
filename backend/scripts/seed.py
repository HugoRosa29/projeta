"""Dados de demonstração (100% fictícios). Uso: python scripts/seed.py [--reset]

Cria 3 pessoas em 2 espaços, projetos, tarefas com prazos relativos a hoje, uma dependência
bloqueada e um projeto parado — o suficiente para exercitar Hoje, quadro, agenda e assistente.
As contas demo não têm senha: entram só pelo GIA (ou por sessão de scripts/dev_session.py). As contas demo têm matrículas fictícias (DEMO-ANA...);
para entrar e ver os dados, passe a sua matrícula real: python scripts/seed.py --matricula M123
(ela assume o lugar da Ana). Sem isso, o seed serve apenas a testes e consultas ao banco.
"""

import sys
from datetime import date, timedelta

from projeta import db
from projeta.db import uow
from projeta.identity import auth, workspaces
from projeta.work import okrs, projects, tasks

NOBODY = "00000000-0000-0000-0000-000000000000"


def d(offset: int) -> str:
    return (date.today() + timedelta(days=offset)).isoformat()


def _arg(name: str) -> str | None:
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else None


def main() -> None:
    db.migrate()
    with db.transaction() as conn:
        if "--reset" in sys.argv:
            conn.execute("TRUNCATE users, workspaces, assistant_usage RESTART IDENTITY CASCADE")
        if conn.execute("SELECT 1 FROM users WHERE email='ana@demo.projeta.test'").fetchone():
            print("Dados de demonstração já existem (use --reset para recriar).")
            return

    users = {}
    for key, name in (("ana", "Ana Souza"), ("bruno", "Bruno Lima"), ("carla", "Carla Reis")):
        matricula = (_arg("--matricula") if key == "ana" else None) or f"DEMO-{key.upper()}"
        with uow(NOBODY) as ctx:
            users[key] = auth.provision_user(ctx, matricula, name, f"{key}@demo.projeta.test")
    ana, bruno, carla = users["ana"], users["bruno"], users["carla"]

    with uow(ana["id"]) as ctx:
        ws = workspaces.create_team_workspace(ctx, "Estúdio Aurora (demo)")["id"]
        inv_b = workspaces.create_invitation(ctx, ws, bruno["email"], "member")
        inv_c = workspaces.create_invitation(ctx, ws, carla["email"], "viewer")
    with uow(bruno["id"]) as ctx:
        workspaces.accept_invitation(ctx, bruno, inv_b["token"])
    with uow(carla["id"]) as ctx:
        workspaces.accept_invitation(ctx, carla, inv_c["token"])

    with uow(ana["id"]) as ctx:
        site = projects.create_project(
            ctx, ws, "Site institucional", "Redesenho do site do cliente Aurora."
        )["id"]
        mig = projects.create_project(
            ctx, ws, "Migração Joomla → WordPress", "Portal legado para WordPress."
        )["id"]
        old = projects.create_project(
            ctx, ws, "Manual de marca (pausado)", "Aguardando retorno do cliente."
        )["id"]
        for pid in (site, mig, old):
            projects.add_project_member(ctx, pid, bruno["id"])
            projects.add_project_member(ctx, pid, carla["id"])

        T = lambda pid, title, **kw: tasks.create_task(ctx, ws, pid, {"title": title, **kw})  # noqa: E731
        a = T(
            site,
            "Definir arquitetura de informação",
            status="done",
            due_date=d(-6),
            assignee_id=ana["id"],
        )
        b = T(
            site,
            "Wireframes das páginas principais",
            status="doing",
            due_date=d(-1),
            assignee_id=bruno["id"],
            priority="high",
        )
        c = T(
            site,
            "Aprovação do cliente",
            status="blocked",
            due_date=d(2),
            assignee_id=ana["id"],
            priority="high",
        )
        e = T(site, "Desenvolver templates", due_date=d(9), assignee_id=bruno["id"])
        T(
            site,
            "Redigir textos institucionais",
            due_date=d(0),
            assignee_id=ana["id"],
            priority="high",
        )
        T(site, "Entrega e treinamento", is_milestone=True, due_date=d(20))
        tasks.add_dependency(ctx, e["id"], c["id"])
        tasks.add_dependency(ctx, c["id"], b["id"])
        T(
            mig,
            "Inventariar conteúdo do Joomla",
            status="doing",
            due_date=d(1),
            assignee_id=ana["id"],
        )
        T(mig, "Configurar redirecionamentos 301", due_date=d(6))
        T(mig, "Migração de conteúdo", due_date=d(10), assignee_id=bruno["id"])
        T(
            site, "Migração de conteúdo", due_date=d(12)
        )  # nome repetido de propósito (teste de desambiguação)
        T(old, "Receber logotipo vetorial", due_date=d(-20))
        T(None, "Renovar domínio do estúdio", due_date=d(3), priority="high")
        T(None, "Revisar acessos dos servidores", due_date=d(0))
        T(None, "Enviar nota fiscal do mês", due_date=d(-2))
        _ = a
        ctx.run(
            "UPDATE activity SET created_at = now() - interval '25 days' WHERE project_id = %s",
            (old,),
        )

        # OKRs do trimestre: Ana gere, Bruno é dono de KRs (um em dia, um pedindo check-in).
        period = okrs.quarter_of(date.today())
        o1 = okrs.create_objective(
            ctx, ws, "Entregar presença digital que encante o cliente", period, owner_id=ana["id"]
        )["id"]
        k1 = okrs.create_key_result(
            ctx,
            o1,
            {
                "title": "Site institucional no ar",
                "kind": "project",
                "project_id": site,
                "owner_id": ana["id"],
            },
        )["id"]
        k2 = okrs.create_key_result(
            ctx,
            o1,
            {
                "title": "Reduzir o tempo de carregamento da home",
                "start_value": 6,
                "target_value": 2,
                "unit": "s",
                "owner_id": bruno["id"],
            },
        )["id"]
        o2 = okrs.create_objective(
            ctx, ws, "Aposentar o portal legado sem perder audiência", period
        )["id"]
        okrs.create_key_result(
            ctx,
            o2,
            {
                "title": "Páginas migradas",
                "start_value": 0,
                "target_value": 120,
                "unit": "páginas",
                "owner_id": bruno["id"],
            },
        )
        okrs.check_in(ctx, k1, None, "at_risk", "Aprovação do cliente travando os templates.")
        okrs.check_in(ctx, k2, 4.5, "on_track", "Imagens otimizadas.")
    print(
        "Demonstração criada. O login é pelo GIA: para ver estes dados, rode o seed com "
        "--matricula <sua matrícula> (--reset recria)."
    )


if __name__ == "__main__":
    try:
        main()
    finally:
        db.close_pool()
