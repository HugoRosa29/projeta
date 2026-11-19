"""Provedor OpenAI via Responses API (servidor). A chave nunca sai do backend.

Validação real pendente: este módulo só foi exercitado com um cliente falso nos testes
(não havia credencial no ambiente de desenvolvimento).
"""

from __future__ import annotations

import json
import logging
from typing import Any

import openai

from ...errors import UpstreamError
from .base import HistoryMessage, LLMResult, ToolExecutor

logger = logging.getLogger(__name__)
TIMEOUT_S = 45.0


class OpenAIResponsesLLM:
    def __init__(self, api_key: str, model: str, client: Any | None = None):
        self.model = model
        self.client = client or openai.OpenAI(api_key=api_key, timeout=TIMEOUT_S, max_retries=1)

    def run(
        self,
        instructions: str,
        history: list[HistoryMessage],
        tools: list[dict],
        execute: ToolExecutor,
        max_rounds: int,
    ) -> LLMResult:
        items: list[Any] = [{"role": m.role, "content": m.content} for m in history]
        in_tok = out_tok = rounds = 0
        try:
            while True:
                resp = self.client.responses.create(
                    model=self.model,
                    instructions=instructions,
                    input=items,
                    tools=tools,
                    store=False,  # não guarda a conversa no provedor
                    include=["reasoning.encrypted_content"],
                )
                if getattr(resp, "usage", None):
                    in_tok += resp.usage.input_tokens
                    out_tok += resp.usage.output_tokens
                calls = [o for o in resp.output if o.type == "function_call"]
                if not calls:
                    return LLMResult(resp.output_text or "", in_tok, out_tok, rounds)
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
                            "output": json.dumps(out, ensure_ascii=False, default=str),
                        }
                    )
        except openai.OpenAIError as e:
            # Log operacional sem conteúdo da conversa: só o tipo do erro.
            logger.warning("Falha no provedor de modelo: %s", type(e).__name__)
            raise UpstreamError(
                "O assistente está indisponível no momento. Tente de novo em instantes — "
                "o trabalho manual continua funcionando normalmente."
            ) from e
