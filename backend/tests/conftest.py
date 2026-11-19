"""Fixtures: PostgreSQL real (contêiner de dev) em um banco separado, limpo a cada teste."""

import os

import psycopg
import pytest

ADMIN_URL = os.environ.get(
    "TEST_ADMIN_URL", "postgresql://projeta:projeta@127.0.0.1:55432/postgres"
)
TEST_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql://projeta:projeta@127.0.0.1:55432/projeta_test"
)

os.environ["DATABASE_URL"] = TEST_URL
os.environ["ASSISTANT_PROVIDER"] = "mock"
os.environ["OPENAI_API_KEY"] = ""


def _ensure_db() -> None:
    with psycopg.connect(ADMIN_URL, autocommit=True) as c:
        exists = c.execute("SELECT 1 FROM pg_database WHERE datname='projeta_test'").fetchone()
        if not exists:
            c.execute("CREATE DATABASE projeta_test")


@pytest.fixture(scope="session", autouse=True)
def _database():
    from projeta import db

    _ensure_db()
    db.migrate()
    yield
    db.close_pool()


@pytest.fixture(autouse=True)
def _clean(_database):
    from projeta import db

    with db.transaction() as conn:
        conn.execute("TRUNCATE users, workspaces, assistant_usage RESTART IDENTITY CASCADE")
    yield
