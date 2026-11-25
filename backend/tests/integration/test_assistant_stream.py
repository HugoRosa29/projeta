"""Resposta do assistente em streaming (NDJSON): mesma autorização e mesmo registro de /chat."""

import json

from fastapi.testclient import TestClient

from helpers import install_fake_gia, make_team, make_user
from projeta.api.app import app
from projeta.assistant import service
from projeta.assistant.llm.base import LLMResult
from projeta.db import uow

H = {"X-Requested-With": "projeta-web"}


def _login(monkeypatch, mat: str) -> tuple[TestClient, str]:
    install_fake_gia(monkeypatch).add(mat, name=f"Pessoa {mat}", email=f"{mat}@ex.com")
    c = TestClient(app, headers=H)
    r = c.post("/api/v1/auth/login", json={"matricula": mat, "password": "senha-gia"})
    assert r.status_code == 200
    return c, c.get("/api/v1/me").json()["workspaces"][0]["id"]


def _events(resp) -> list[dict]:
    return [json.loads(line) for line in resp.text.splitlines() if line.strip()]


class _StreamingLLM:
    """Provedor falso que usa uma ferramenta e emite o texto em trechos, como o real."""

    def run(self, instructions, history, tools, execute, max_rounds, on_event=None):
        execute("my_day", {})
        for part in ("Seu dia ", "está ", "tranquilo."):
            if on_event:
                on_event({"type": "delta", "text": part})
        return LLMResult("Seu dia está tranquilo.", 1, 1, 1)


def test_stream_entrega_ferramenta_trechos_e_mensagem_gravada(monkeypatch):
    c, ws = _login(monkeypatch, "s1")
    monkeypatch.setattr(service, "get_llm", lambda: _StreamingLLM())
    r = c.post("/api/v1/assistant/chat/stream", json={"workspace_id": ws, "message": "meu dia"})
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/x-ndjson")
    assert r.headers["x-accel-buffering"] == "no"
    evs = _events(r)
    assert evs[0] == {"type": "tool", "label": "Consultando sua agenda"}
    assert "".join(e["text"] for e in evs if e["type"] == "delta") == "Seu dia está tranquilo."
    done = evs[-1]
    assert done["type"] == "done" and done["message"]["content"] == "Seu dia está tranquilo."
    # gravada como qualquer resposta: aparece ao recarregar a conversa
    conv = c.get("/api/v1/assistant/conversation", params={"workspace_id": ws}).json()
    assert [m["role"] for m in conv["messages"]] == ["user", "assistant"]


def test_stream_com_provedor_de_teste_sem_trechos_termina_em_done(monkeypatch):
    c, ws = _login(monkeypatch, "s2")
    r = c.post(
        "/api/v1/assistant/chat/stream", json={"workspace_id": ws, "message": "como está meu dia?"}
    )
    evs = _events(r)
    assert evs[-1]["type"] == "done" and evs[-1]["message"]["role"] == "assistant"


def test_stream_em_espaco_alheio_e_negado_antes_de_abrir(monkeypatch):
    c, _ = _login(monkeypatch, "s3")
    alheio = make_team(make_user("Dona"))
    r = c.post("/api/v1/assistant/chat/stream", json={"workspace_id": alheio, "message": "oi"})
    assert r.status_code == 403  # erro HTTP normal, nada de stream
    with uow("00000000-0000-0000-0000-000000000000") as ctx:
        n = ctx.one(
            "SELECT count(*)::int AS n FROM assistant_conversations WHERE workspace_id=%s",
            (alheio,),
        )["n"]
    assert n == 0


def test_falha_do_provedor_no_meio_vira_evento_de_erro_recuperavel(monkeypatch):
    from projeta.errors import UpstreamError

    class Down:
        def run(self, *a, **k):
            raise UpstreamError("O assistente está indisponível no momento.")

    c, ws = _login(monkeypatch, "s4")
    monkeypatch.setattr(service, "get_llm", lambda: Down())
    r = c.post("/api/v1/assistant/chat/stream", json={"workspace_id": ws, "message": "oi"})
    assert r.status_code == 200
    assert _events(r)[-1] == {
        "type": "error",
        "code": "upstream_unavailable",
        "message": "O assistente está indisponível no momento.",
    }
