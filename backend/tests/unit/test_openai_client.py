"""Cliente Responses API com um provedor falso: laço de ferramentas, privacidade e falhas."""

from types import SimpleNamespace as NS

import openai
import pytest

from projeta.assistant.llm.base import HistoryMessage
from projeta.assistant.llm.openai_client import OpenAIResponsesLLM
from projeta.errors import UpstreamError


class FakeResponses:
    def __init__(self, script):
        self.script, self.calls = script, []

    def create(self, **kw):
        self.calls.append(kw)
        nxt = self.script.pop(0)
        if isinstance(nxt, Exception):
            raise nxt
        return nxt


def _resp(output, text="", usage=(5, 7)):
    return NS(
        output=output, output_text=text, usage=NS(input_tokens=usage[0], output_tokens=usage[1])
    )


def _call(name, args, cid="c1"):
    out = NS(type="function_call", name=name, arguments=args, call_id=cid)
    out.model_dump = lambda **k: {
        "type": "function_call",
        "name": name,
        "arguments": args,
        "call_id": cid,
    }
    return out


def _client(script):
    fake = NS(responses=FakeResponses(script))
    return OpenAIResponsesLLM("k", "gpt-test", client=fake), fake.responses


def test_laco_de_ferramenta_e_resposta_final():
    llm, responses = _client([_resp([_call("tasks_due", "{}")]), _resp([], "Vencem 2 tarefas.")])
    executed = []
    r = llm.run(
        "sys",
        [HistoryMessage("user", "o que vence hoje?")],
        [{"name": "tasks_due"}],
        lambda n, a: executed.append((n, a)) or {"total": 2},
        max_rounds=4,
    )
    assert r.text == "Vencem 2 tarefas." and r.tool_rounds == 1
    assert (r.input_tokens, r.output_tokens) == (10, 14)
    assert executed == [("tasks_due", {})]
    first, second = responses.calls
    assert first["store"] is False and first["model"] == "gpt-test"  # sem guardar a conversa
    assert second["input"][-1]["type"] == "function_call_output"


def test_argumentos_invalidos_viram_erro_para_o_modelo_e_limite_de_rodadas():
    llm, _ = _client([_resp([_call("x", "{nao json")]), _resp([_call("x", "{}", "c2")])])
    seen = []
    r = llm.run(
        "s", [HistoryMessage("user", "oi")], [], lambda n, a: seen.append(a) or {}, max_rounds=1
    )
    assert "limite de passos" in r.text
    assert seen == []  # JSON inválido nunca chega às ferramentas


@pytest.mark.parametrize(
    "err",
    [
        openai.APIConnectionError(request=NS()),
        openai.RateLimitError(
            "x", response=NS(status_code=429, headers={}, request=NS()), body=None
        ),
    ],
)
def test_falha_do_provedor_vira_erro_recuperavel(err):
    llm, _ = _client([err])
    with pytest.raises(UpstreamError) as e:
        llm.run("s", [HistoryMessage("user", "oi")], [], lambda n, a: {}, 2)
    assert "manual" in e.value.message


def test_parametros_de_latencia_vao_ao_provedor():
    llm, responses = _client([_resp([_call("x", "{}")]), _resp([], "ok")])
    llm.run("s", [HistoryMessage("user", "oi")], [], lambda n, a: {"a": [1, 2]}, 2)
    first, second = responses.calls
    assert first["reasoning"] == {"effort": "low"} and first["text"] == {"verbosity": "low"}
    assert first["prompt_cache_key"] == "projeta-assistant"
    assert second["input"][-1]["output"] == '{"a":[1,2]}'  # JSON compacto: menos tokens


def test_sem_ajuste_de_latencia_nao_envia_parametros():
    fake = NS(responses=FakeResponses([_resp([], "ok")]))
    llm = OpenAIResponsesLLM("k", "m", client=fake, reasoning_effort=None, text_verbosity=None)
    llm.run("s", [HistoryMessage("user", "oi")], [], lambda n, a: {}, 2)
    assert "reasoning" not in fake.responses.calls[0] and "text" not in fake.responses.calls[0]


def _ev(kind, **kw):
    return NS(type=kind, **kw)


def test_streaming_repassa_trechos_e_descarta_preambulo_de_ferramenta():
    tool_round = _resp([_call("my_day", "{}")])
    final = _resp([], "Tudo certo.")
    llm, responses = _client(
        [
            [
                _ev("response.output_text.delta", delta="Vou ver"),
                _ev("response.completed", response=tool_round),
            ],
            [
                _ev("response.output_text.delta", delta="Tudo "),
                _ev("response.output_text.delta", delta="certo."),
                _ev("response.completed", response=final),
            ],
        ]
    )
    events = []
    r = llm.run("s", [HistoryMessage("user", "oi")], [], lambda n, a: {}, 3, events.append)
    assert r.text == "Tudo certo." and r.tool_rounds == 1
    assert events == [
        {"type": "delta", "text": "Vou ver"},
        {"type": "reset"},
        {"type": "delta", "text": "Tudo "},
        {"type": "delta", "text": "certo."},
    ]
    assert all(c["stream"] is True for c in responses.calls)


def test_streaming_com_falha_do_provedor_vira_erro_recuperavel():
    llm, _ = _client([[_ev("response.failed", response=None)]])
    with pytest.raises(UpstreamError):
        llm.run("s", [HistoryMessage("user", "oi")], [], lambda n, a: {}, 2, lambda e: None)
