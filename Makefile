# Wrappers finos sobre scripts/. O que importa vive nos scripts, então os comandos
# funcionam igual digitados, rodados pela CI ou por um agente.
.DEFAULT_GOAL := help
.PHONY: help up down setup db migrate seed run front check check-fast fix test

PY := $(shell if [ -x backend/.venv/Scripts/python.exe ]; then echo backend/.venv/Scripts/python.exe; else echo backend/.venv/bin/python; fi)

help: ## Mostra esta ajuda
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

up: ## Sobe tudo no Docker (banco, API e interface) em http://localhost:5173
	docker compose up --build -d --wait
	@echo "Projeta em http://localhost:5173"

down: ## Derruba os contêineres (os dados ficam no volume)
	docker compose down

setup: ## venv + dependências do backend, npm ci no frontend, cria backend/.env
	python -m venv backend/.venv
	$(PY) -m pip install -q -e "backend[dev]"
	@[ -f backend/.env ] || (cp backend/.env.example backend/.env && sed -i 's/ASSISTANT_PROVIDER=openai/ASSISTANT_PROVIDER=mock/' backend/.env && echo "backend/.env criado (assistente em modo mock; configure OPENAI_API_KEY para o real)")
	cd frontend && npm ci

db: ## Sobe o PostgreSQL de desenvolvimento (Docker)
	docker compose up -d db

migrate: ## Aplica as migrações
	cd backend && ../$(PY) -c "from projeta import db; print(db.migrate()); db.close_pool()"

seed: ## Cria dados fictícios (use ARGS="--matricula SUA_MATRICULA" para entrar nelas); --reset recria
	cd backend && ../$(PY) scripts/seed.py $(ARGS)

run: ## API em http://127.0.0.1:8000
	cd backend && ../$(PY) -m uvicorn projeta.api.app:app --reload --port 8000

front: ## Frontend em http://localhost:5173
	cd frontend && npm run dev

check: ## O portão — rode antes de todo push
	@./scripts/check.sh

check-fast: ## O portão sem o build do frontend
	@./scripts/check.sh --fast

fix: ## Aplica formatação e correções automáticas
	cd backend && ../$(PY) -m ruff format src tests scripts && ../$(PY) -m ruff check --fix src tests scripts

test: ## Testes do backend e do frontend
	cd backend && ../$(PY) -m pytest -q
	cd frontend && npx vitest run
