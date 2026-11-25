"""Provedor OpenAI via Responses API (servidor). A chave nunca sai do backend.

Com `on_event`, cada rodada usa `stream=True` e repassa o texto conforme é gerado; o laço de
ferramentas e o resultado final são os mesmos do modo sem streaming.
"""

from __future__ import annotations

import json
import logging
from functools import lru_cache
from typing import Any

import openai

from ...errors import UpstreamError
from .base import EventSink, HistoryMessage, LLMResult, ToolExecutor

logger = logging.getLogger(__name__)
TIMEOUT_S = 45.0
# Chave fixa (sem dado de pessoa): agrupa as chamadas no cache de prompt do provedor, que
# reaproveita o prefixo estável (ferramentas + instruções) e reduz o tempo até o 1º token.
PROMPT_CACHE_KEY = "projeta-assistant"


@lru_cache(maxsize=4)
def _shared_client(api_key: str) -> openai.OpenAI:
    # Um cliente por processo: reaproveita o pool HTTP/TLS em vez de reconectar a cada mensagem.
    return openai.OpenAI(api_key=api_key, timeout=TIMEOUT_S, max_retries=1)


class _StreamFailed(Exception):
    """O provedor encerrou o stream com falha (evento, não exceção HTTP)."""


UNAVAILABLE = (
    "O assistente está indisponível no momento. Tente de novo em instantes — "
    "o trabalho manual continua funcionando normalmente."
)


def _compact(out: Any) -> str:
    # Saída de ferramenta é reenviada ao modelo a cada rodada: JSON sem espaços = menos tokens.
    return json.dumps(out, ensure_ascii=False, default=str, separators=(",", ":"))


class OpenAIResponsesLLM:
    def __init__(
        self,
        api_key: str,
        model: str,
        client: Any | None = None,
        reasoning_effort: str | None = "low",
        text_verbosity: str | None = "low",
    ):
        self.model = model
        self.client = client or _shared_client(api_key)
        self.reasoning_effort = reasoning_effort
        self.text_verbosity = text_verbosity

    def run(
        self,
        instructions: str,
        history: list[HistoryMessage],
        tools: list[dict],
        execute: ToolExecutor,
        max_rounds: int,
        on_event: EventSink | None = None,
    ) -> LLMResult:
        items: list[Any] = [{"role": m.role, "content": m.content} for m in history]
        in_tok = out_tok = rounds = 0
        try:
            while True:
                kw = {
                    "model": self.model,
                    "instructions": instructions,
                    "input": items,
                    "tools": tools,
                    "store": False,  # não guarda a conversa no provedor
                    "include": ["reasoning.encrypted_content"],
                    "prompt_cache_key": PROMPT_CACHE_KEY,
                    **self._tuning(),
                }
                if on_event is None:
                    resp, streamed = self.client.responses.create(**kw), False
                else:
                    resp, streamed = self._stream(kw, on_event)
                if getattr(resp, "usage", None):
                    in_tok += resp.usage.input_tokens
                    out_tok += resp.usage.output_tokens
                calls = [o for o in resp.output if o.type == "function_call"]
                if not calls:
                    return LLMResult(resp.output_text or "", in_tok, out_tok, rounds)
                if streamed and on_event:
                    on_event({"type": "reset"})  # texto antes das ferramentas não é a resposta
                if rounds >= max_rounds:
                    return LLMResult(
                        "Não consegui concluir a consulta dentro do limite de passos. Tente uma pergunta mais específica.",
                        in_tok,
                        out_tok,
                        rounds,
                    )
                rounds += 1
                items += [o.model_dump(exclude_none=True) for o in resp.output]
                for c in calls:
                    try:
                        args = json.loads(c.arguments or "{}")
                        out = execute(c.name, args if isinstance(args, dict) else {})
                    except json.JSONDecodeError:
                        out = {"erro": "argumentos não são JSON válido"}
                    items.append(
                        {
                            "type": "function_call_output",
                            "call_id": c.call_id,
                            "output": _compact(out),
                        }
                    )
        except (openai.OpenAIError, _StreamFailed) as e:
            # Log operacional sem conteúdo da conversa: só o tipo do erro.
            logger.warning("Falha no provedor de modelo: %s", type(e).__name__)
            raise UpstreamError(UNAVAILABLE) from e

    def _stream(self, kw: dict[str, Any], on_event: EventSink) -> tuple[Any, bool]:
        """Repassa os trechos de texto conforme chegam e devolve a resposta completa do fim."""
        final, streamed = None, False
        for ev in self.client.responses.create(**kw, stream=True):
            kind = getattr(ev, "type", "")
            if kind == "response.output_text.delta" and ev.delta:
                on_event({"type": "delta", "text": ev.delta})
                streamed = True
            elif kind in ("response.completed", "response.incomplete"):
                final = ev.response
            elif kind in ("response.failed", "error"):
                raise _StreamFailed(kind)
        if final is None:
            raise _StreamFailed("stream sem resposta final")
        return final, streamed

    def _tuning(self) -> dict[str, Any]:
        kw: dict[str, Any] = {}
        if self.reasoning_effort:
            kw["reasoning"] = {"effort": self.reasoning_effort}
        if self.text_verbosity:
            kw["text"] = {"verbosity": self.text_verbosity}
        return kw
