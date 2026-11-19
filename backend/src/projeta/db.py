"""Acesso ao PostgreSQL: pool, migrações versionadas e unidade de trabalho por requisição."""

from __future__ import annotations

import logging
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg.types.string import TextLoader
from psycopg_pool import ConnectionPool

from .settings import get_settings

logger = logging.getLogger(__name__)

# uuid -> str em todas as conexões; evita converter cada coluna na mão.
psycopg.adapters.register_loader("uuid", TextLoader)

MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "migrations"
_pool: ConnectionPool | None = None


def get_pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        _pool = ConnectionPool(
            get_settings().database_url,
            min_size=1,
            max_size=10,
            kwargs={"row_factory": dict_row},
            open=True,
        )
    return _pool


def close_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


@dataclass
class Ctx:
    """Contexto explícito: conexão (transação) + usuário vindo da sessão autenticada.

    Interface, assistente e rotinas agendadas chamam os mesmos serviços com um Ctx.
    """

    conn: psycopg.Connection
    user_id: str

    def all(self, sql: str, params: Any = None) -> list[dict]:
        return self.conn.execute(sql, params).fetchall()

    def one(self, sql: str, params: Any = None) -> dict | None:
        return self.conn.execute(sql, params).fetchone()

    def run(self, sql: str, params: Any = None) -> None:
        self.conn.execute(sql, params)


@contextmanager
def transaction() -> Iterator[psycopg.Connection]:
    """Uma transação: confirma ao sair, desfaz se houver exceção."""
    with get_pool().connection() as conn:
        yield conn


@contextmanager
def uow(user_id: str) -> Iterator[Ctx]:
    with transaction() as conn:
        yield Ctx(conn, user_id)


def run_migrations(conn: psycopg.Connection) -> list[str]:
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_migrations "
        "(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
    )
    conn.execute("SELECT pg_advisory_xact_lock(727274)")  # um processo migra por vez
    done = {r["name"] for r in conn.execute("SELECT name FROM schema_migrations").fetchall()}
    applied: list[str] = []
    for f in sorted(MIGRATIONS_DIR.glob("*.sql")):
        if f.name in done:
            continue
        conn.execute(f.read_text(encoding="utf-8"))
        conn.execute("INSERT INTO schema_migrations(name) VALUES (%s)", (f.name,))
        applied.append(f.name)
        logger.info("Migração aplicada: %s", f.name)
    return applied


def migrate() -> list[str]:
    with transaction() as conn:
        return run_migrations(conn)
