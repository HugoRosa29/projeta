"""Configuração vinda somente do ambiente. Nenhum segredo é logado."""

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql://projeta:projeta@127.0.0.1:55432/projeta"
    cookie_secure: bool = False
    session_ttl_days: int = 30

    # GIA: mesmo serviço e mesmo código de sistema do portal-terracap.
    gia_service: str = "http://gia-api"
    gia_endpoint: str = "/auth/autenticar"
    gia_system_id: int = 653
    gia_timeout_s: int = 15
    gia_verify_ssl: bool = True
    gia_email_domain: str = "gia.local"

    assistant_provider: Literal["openai", "mock"] = "openai"
    openai_api_key: str = ""
    openai_model: str = "gpt-5-mini"
    assistant_max_tool_rounds: int = 8
    assistant_max_input_chars: int = 2000
    assistant_rate_limit_per_hour: int = 60
    assistant_proposal_ttl_min: int = 30
    inactivity_days: int = 7


@lru_cache
def get_settings() -> Settings:
    return Settings()
