"""Empacotamento das migrações: diretório vazio ou errado precisa falhar na partida."""

import pytest

from projeta import db


def test_migration_files_found_in_source_tree():
    names = [f.name for f in db.migration_files()]
    assert names[0] == "001_core.sql"
    assert names == sorted(names)


def test_no_sql_files_fails_with_clear_message(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "MIGRATIONS_DIR", tmp_path)

    class _NoConn:
        def execute(self, *_a, **_k):
            raise AssertionError("não deve tocar o banco sem migrações")

    with pytest.raises(RuntimeError, match="Nenhuma migração SQL encontrada"):
        db.run_migrations(_NoConn())  # type: ignore[arg-type]
