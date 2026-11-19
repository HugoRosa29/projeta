"""Pessoa fictícia + sessão para desenvolvimento local, sem passar pelo GIA.

Uso: python scripts/dev_session.py [--matricula DEV-TESTE] [--nome "Pessoa Teste"]

Não existe rota nem flag que dispense o GIA: este script grava a sessão direto no banco local
(mesmo caminho que `login` usa depois que o GIA confirma) e imprime o token. Cole-o no cookie
`projeta_session` do navegador (DevTools > Application > Cookies > localhost) e recarregue.
Só funciona com acesso ao banco, então não abre brecha em ambiente publicado.
"""

import sys

from projeta import db
from projeta.db import uow
from projeta.identity import auth

NOBODY = "00000000-0000-0000-0000-000000000000"
COOKIE = "projeta_session"


def _arg(name: str, default: str) -> str:
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


def main() -> None:
    matricula = _arg("--matricula", "DEV-TESTE")
    nome = _arg("--nome", "Pessoa Teste")
    db.migrate()
    with uow(NOBODY) as ctx:
        user = auth.provision_user(ctx, matricula, nome, f"{matricula.lower()}@dev.projeta.test")
        token, expires = auth.create_session(ctx, user["id"])
    print(f"Pessoa: {user['name']} <{user['email']}> (matrícula {matricula.upper()})")
    print(f"Sessão válida até {expires:%Y-%m-%d %H:%M} UTC.")
    print(f"Cookie: {COOKIE}={token}")


if __name__ == "__main__":
    try:
        main()
    finally:
        db.close_pool()
