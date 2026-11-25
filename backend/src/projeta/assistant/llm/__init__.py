from ...errors import UpstreamError
from ...settings import get_settings
from .base import EventSink, HistoryMessage, LLMClient, LLMResult


def get_llm() -> LLMClient:
    s = get_settings()
    if s.assistant_provider == "mock":
        from .mock import MockLLM

        return MockLLM()
    if not s.openai_api_key:
        raise UpstreamError(
            "O assistente ainda não está configurado neste ambiente (falta a chave do provedor). "
            "Você pode continuar criando e editando tarefas manualmente."
        )
    from .openai_client import OpenAIResponsesLLM

    return OpenAIResponsesLLM(
        s.openai_api_key,
        s.openai_model,
        reasoning_effort=s.openai_reasoning_effort,
        text_verbosity=s.openai_text_verbosity,
    )


__all__ = ["EventSink", "HistoryMessage", "LLMClient", "LLMResult", "get_llm"]
