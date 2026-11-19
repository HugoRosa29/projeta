"""Contrato do provedor de modelo. Só este pacote (llm/) fala com um provedor externo."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol

ToolExecutor = Callable[[str, dict], dict]


@dataclass
class LLMResult:
    text: str
    input_tokens: int = 0
    output_tokens: int = 0
    tool_rounds: int = 0


@dataclass
class HistoryMessage:
    role: str  # "user" | "assistant"
    content: str


class LLMClient(Protocol):
    def run(
        self,
        instructions: str,
        history: list[HistoryMessage],
        tools: list[dict],
        execute: ToolExecutor,
        max_rounds: int,
    ) -> LLMResult:
        """Conduz a conversa (inclusive o laço de ferramentas) e devolve o texto final."""
        ...
