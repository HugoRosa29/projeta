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
