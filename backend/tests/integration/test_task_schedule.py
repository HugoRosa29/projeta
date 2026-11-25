"""Cronograma da tarefa: data de início coerente com o prazo e dependências visíveis na lista."""

import pytest

from projeta import db
from projeta.db import uow
from projeta.errors import BadRequestError, ForbiddenError
from projeta.work import tasks
from tests.helpers import join, make_project, make_team, make_user


@pytest.fixture
def setup():
    gp, membro, leitor = make_user("gp"), make_user("membro"), make_user("leitor")
    ws = make_team(gp)
    join(gp, ws, membro, "member")
    join(gp, ws, leitor, "viewer")
    pid = make_project(gp, ws, "Portal", members=(membro, leitor))
    return {"gp": gp, "membro": membro, "leitor": leitor, "ws": ws, "pid": pid}


def test_inicio_e_prazo_gravam_e_limpam(setup):
    s = setup
    with uow(s["membro"]["id"]) as ctx:
        t = tasks.create_task(
            ctx,
            s["ws"],
            s["pid"],
            {"title": "Levantar requisitos", "start_date": "2026-12-01", "due_date": "2026-12-10"},
        )
        assert (t["start_date"], t["due_date"]) == ("2026-12-01", "2026-12-10")
        t = tasks.update_task(ctx, t["id"], {"start_date": "2026-12-03"}, t["version"])
        assert t["start_date"] == "2026-12-03"
        # "" limpa a data, como nulo; sem início, o prazo pode ir para qualquer dia.
        t = tasks.update_task(ctx, t["id"], {"start_date": ""}, t["version"])
        assert t["start_date"] is None
        t = tasks.update_task(ctx, t["id"], {"due_date": "2026-11-01"}, t["version"])
        assert t["due_date"] == "2026-11-01"


def test_inicio_depois_do_prazo_e_recusado(setup):
    s = setup
    with uow(s["membro"]["id"]) as ctx, pytest.raises(BadRequestError, match="início"):
        tasks.create_task(
            ctx,
            s["ws"],
            s["pid"],
            {"title": "X", "start_date": "2026-12-11", "due_date": "2026-12-10"},
        )
    with uow(s["membro"]["id"]) as ctx:
        t = tasks.create_task(
            ctx,
            s["ws"],
            s["pid"],
            {"title": "Y", "start_date": "2026-12-05", "due_date": "2026-12-10"},
        )
    # Compara com o valor já gravado: mexer só no prazo também é verificado.
    with uow(s["membro"]["id"]) as ctx, pytest.raises(BadRequestError, match="início"):
        tasks.update_task(ctx, t["id"], {"due_date": "2026-12-04"}, t["version"])
    with uow(s["membro"]["id"]) as ctx, pytest.raises(BadRequestError, match="início"):
        tasks.update_task(ctx, t["id"], {"start_date": "2026-12-11"}, t["version"])
    with uow(s["membro"]["id"]) as ctx, pytest.raises(BadRequestError, match="inválida"):
        tasks.update_task(ctx, t["id"], {"start_date": "05/12/2026"}, t["version"])


def test_lista_traz_dependencias_e_ficha_mostra_quem_espera(setup):
    s = setup
    with uow(s["membro"]["id"]) as ctx:
        a, b, c = (tasks.create_task(ctx, s["ws"], s["pid"], {"title": n}) for n in "ABC")
        tasks.add_dependency(ctx, b["id"], a["id"])
        tasks.add_dependency(ctx, c["id"], a["id"])
        rows = {t["title"]: t for t in tasks.list_project_tasks(ctx, s["pid"])}
        assert rows["B"]["depends_on_ids"] == [a["id"]] and rows["A"]["depends_on_ids"] == []
        detail = tasks.get_task(ctx, a["id"])
        assert [x["title"] for x in detail["blocks"]] == ["B", "C"]
        tasks.remove_dependency(ctx, b["id"], a["id"])
        assert tasks.get_task(ctx, b["id"])["task"]["depends_on_ids"] == []


def test_dependencia_exige_escrita_e_acesso_as_duas_tarefas(setup):
    s = setup
    fora = make_user("fora")
    outro_ws = make_team(fora)
    outro = make_project(fora, outro_ws, "Alheio")
    with uow(s["membro"]["id"]) as ctx:
        a, b = (tasks.create_task(ctx, s["ws"], s["pid"], {"title": n}) for n in "AB")
    with uow(fora["id"]) as ctx:
        alheia = tasks.create_task(ctx, outro_ws, outro, {"title": "Alheia"})
    # Leitor enxerga, mas não altera o cronograma.
    with uow(s["leitor"]["id"]) as ctx, pytest.raises(ForbiddenError):
        tasks.add_dependency(ctx, b["id"], a["id"])
    # Quem é de fora não liga a tarefa dele a uma que não enxerga (e vice-versa).
    with uow(fora["id"]) as ctx, pytest.raises(ForbiddenError):
        tasks.add_dependency(ctx, alheia["id"], a["id"])
    with uow(s["membro"]["id"]) as ctx, pytest.raises(ForbiddenError):
        tasks.add_dependency(ctx, a["id"], alheia["id"])


def _dates(ctx, tid: str) -> tuple[str | None, str | None]:
    t = tasks.get_task(ctx, tid)["task"]
    return t["start_date"], t["due_date"]


def test_ligar_dependencia_encadeia_inicio_mantendo_a_duracao(setup):
    s = setup
    with uow(s["membro"]["id"]) as ctx:
        a = tasks.create_task(
            ctx,
            s["ws"],
            s["pid"],
            {"title": "A", "start_date": "2026-12-01", "due_date": "2026-12-05"},
        )
        b = tasks.create_task(
            ctx,
            s["ws"],
            s["pid"],
            {"title": "B", "start_date": "2026-12-01", "due_date": "2026-12-03"},
        )
        tasks.add_dependency(ctx, b["id"], a["id"])
        # B começa no dia seguinte ao prazo de A e mantém os 2 dias de duração.
        assert _dates(ctx, b["id"]) == ("2026-12-06", "2026-12-08")


def test_mudar_prazo_da_anterior_move_a_cadeia_inteira(setup):
    s = setup
    with uow(s["membro"]["id"]) as ctx:
        a = tasks.create_task(ctx, s["ws"], s["pid"], {"title": "A", "due_date": "2026-12-05"})
        b = tasks.create_task(
            ctx,
            s["ws"],
            s["pid"],
            {"title": "B", "start_date": "2026-12-06", "due_date": "2026-12-10"},
        )
        c = tasks.create_task(ctx, s["ws"], s["pid"], {"title": "C", "due_date": "2026-12-20"})
        tasks.add_dependency(ctx, b["id"], a["id"])
        tasks.add_dependency(ctx, c["id"], b["id"])
        assert _dates(ctx, c["id"]) == ("2026-12-11", "2026-12-20")
        a = tasks.get_task(ctx, a["id"])["task"]
        tasks.update_task(ctx, a["id"], {"due_date": "2026-12-08"}, a["version"])
        assert _dates(ctx, b["id"]) == ("2026-12-09", "2026-12-13")
        assert _dates(ctx, c["id"]) == ("2026-12-14", "2026-12-23")
        # Antecipar também puxa a cadeia de volta.
        a = tasks.get_task(ctx, a["id"])["task"]
        tasks.update_task(ctx, a["id"], {"due_date": "2026-12-02"}, a["version"])
        assert _dates(ctx, b["id"]) == ("2026-12-03", "2026-12-07")
        kinds = ctx.all(
            "SELECT kind, data->>'after' AS after FROM activity WHERE task_id=%s ORDER BY created_at",
            (b["id"],),
        )
        assert {"kind": "task.rescheduled", "after": "A"} in kinds


def test_varias_anteriores_vale_a_que_termina_por_ultimo(setup):
    s = setup
    with uow(s["membro"]["id"]) as ctx:
        a = tasks.create_task(ctx, s["ws"], s["pid"], {"title": "A", "due_date": "2026-12-05"})
        b = tasks.create_task(ctx, s["ws"], s["pid"], {"title": "B", "due_date": "2026-12-09"})
        c = tasks.create_task(ctx, s["ws"], s["pid"], {"title": "C"})
        tasks.add_dependency(ctx, c["id"], a["id"])
        tasks.add_dependency(ctx, c["id"], b["id"])
        assert _dates(ctx, c["id"]) == ("2026-12-10", None)
        tasks.remove_dependency(ctx, c["id"], b["id"])
        assert _dates(ctx, c["id"]) == ("2026-12-06", None)
        # Sem anteriores, a data fica onde estava e volta a ser livre.
        tasks.remove_dependency(ctx, c["id"], a["id"])
        c = tasks.get_task(ctx, c["id"])["task"]
        assert c["start_date"] == "2026-12-06"
        c = tasks.update_task(ctx, c["id"], {"start_date": "2026-12-01"}, c["version"])
        assert c["start_date"] == "2026-12-01"


def test_inicio_encadeado_nao_se_edita_a_mao(setup):
    s = setup
    with uow(s["membro"]["id"]) as ctx:
        a = tasks.create_task(ctx, s["ws"], s["pid"], {"title": "A", "due_date": "2026-12-05"})
        b = tasks.create_task(ctx, s["ws"], s["pid"], {"title": "B", "due_date": "2026-12-10"})
        tasks.add_dependency(ctx, b["id"], a["id"])
        b = tasks.get_task(ctx, b["id"])["task"]
    with (
        uow(s["membro"]["id"]) as ctx,
        pytest.raises(BadRequestError, match="segue as dependências"),
    ):
        tasks.update_task(ctx, b["id"], {"start_date": "2026-12-01"}, b["version"])
    # O prazo continua livre, desde que não fique antes do início encadeado.
    with uow(s["membro"]["id"]) as ctx, pytest.raises(BadRequestError, match="início"):
        tasks.update_task(ctx, b["id"], {"due_date": "2026-12-04"}, b["version"])


def test_minhas_tarefas_mostram_o_que_aguardam_e_quantas_esperam(setup):
    s = setup
    with uow(s["gp"]["id"]) as ctx:
        a = tasks.create_task(
            ctx, s["ws"], s["pid"], {"title": "Contratar", "due_date": "2026-12-05"}
        )
        b = tasks.create_task(
            ctx, s["ws"], s["pid"], {"title": "Implantar", "assignee_id": s["membro"]["id"]}
        )
        tasks.add_dependency(ctx, b["id"], a["id"])
        a = tasks.update_task(ctx, a["id"], {"assignee_id": s["membro"]["id"]}, None)
    with uow(s["membro"]["id"]) as ctx:
        rows = {t["title"]: t for t in tasks.list_my_tasks(ctx, s["ws"], "2026-11-25")}
    assert rows["Implantar"]["waiting_on"] == [
        {"id": a["id"], "title": "Contratar", "status": "todo", "due_date": "2026-12-05"}
    ]
    assert rows["Contratar"]["blocking_count"] == 1 and rows["Contratar"]["waiting_on"] == []


def test_migracao_encadeia_dependencias_antigas(setup):
    """Dependências gravadas antes da regra (ex.: EAP aplicada antes) ganham as datas encadeadas."""
    s = setup
    sql = (db.MIGRATIONS_DIR / "022_chain_existing_dependencies.sql").read_text(encoding="utf-8")
    with uow(s["membro"]["id"]) as ctx:
        a = tasks.create_task(ctx, s["ws"], s["pid"], {"title": "A", "due_date": "2026-12-05"})
        b = tasks.create_task(
            ctx,
            s["ws"],
            s["pid"],
            {"title": "B", "start_date": "2026-12-01", "due_date": "2026-12-03"},
        )
        c = tasks.create_task(ctx, s["ws"], s["pid"], {"title": "C", "due_date": "2026-12-04"})
        # Como era antes: a ligação existe, as datas não seguem.
        ctx.run(
            "INSERT INTO task_dependencies(task_id, depends_on_id) VALUES (%s,%s), (%s,%s)",
            (b["id"], a["id"], c["id"], b["id"]),
        )
        ctx.run(sql)
        assert _dates(ctx, b["id"]) == ("2026-12-06", "2026-12-08")  # mantém 2 dias
        assert _dates(ctx, c["id"]) == ("2026-12-09", "2026-12-09")  # sem início: não inverte
        assert _dates(ctx, a["id"]) == (None, "2026-12-05")
