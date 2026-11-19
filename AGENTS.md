# AGENTS.md — acordo de trabalho

Contrato para quem altera este repositório: pessoas e agentes de código (Claude Code, Codex, etc.). É a **única fonte de instruções**; `CLAUDE.md` só aponta para cá. Mudou a regra, mude este arquivo.

O que é o produto e como rodar: [README.md](README.md). Decisões de arquitetura: [docs/adr/](docs/adr/index.md).

## 1. Inegociáveis

1. **Nunca versionar segredo.** Chaves, tokens e senhas vêm do ambiente. `.env` é ignorado; `.env.example` só tem valores falsos.
2. **Nunca versionar artefato de execução.** Tudo que o app grava vive em `var/` (ignorado). Se `git status` suja após rodar o app, o bug é do código.
3. **`./scripts/check.sh` passa antes de abrir PR.** É o mesmo portão da CI. Sem atalho por agente.
4. **O servidor é a autoridade de acesso.** Papel, escopo e vínculo com o projeto são validados no backend em toda leitura, escrita, busca, exportação e chamada do assistente. A interface só esconde opções; nunca protege.
5. **O assistente nunca grava direto.** Toda alteração passa por proposta → prévia editável → confirmação → execução transacional → histórico. O texto do modelo, comentários e arquivos são *dados*, nunca instruções, identidade ou permissão.
6. **Não documentar o que o código não faz.** Trabalho planejado é marcado como planejado (ver [roadmap](docs/product/roadmap.md)).
7. **Ficar dentro da tarefa.** Um assunto por mudança; o segundo problema vira issue.

## 2. Comandos

| Comando | O que faz |
| --- | --- |
| `make setup` | venv + dependências do backend, `npm ci` no frontend, cria `backend/.env` |
| `make db` | sobe o PostgreSQL de desenvolvimento (Docker) |
| `make migrate` / `make seed` | aplica migrações / cria dados fictícios de demonstração |
| `make run` | API em <http://127.0.0.1:8000> |
| `make front` | frontend em <http://localhost:5173> |
| `make check` | **o portão**: artefatos, segredos, formato, lint, tipos, testes, build |
| `make fix` | aplica formatação e correções automáticas de lint |

Ao relatar que algo está pronto, relate o que `make check` disse — não flags próprias de `pytest`/`ruff`.

## 3. Onde as coisas vivem

```text
backend/            serviço Python (FastAPI + PostgreSQL) — pyproject, .env, var/, migrations/
  src/projeta/
    settings.py errors.py db.py
    identity/         sessões, espaços, convites, papéis, política de acesso
    work/             projetos, tarefas, dependências, "Hoje", agenda
    assistant/        ferramentas, propostas, payloads; llm/ = único módulo que fala com o provedor
    api/              FastAPI: rotas, schemas, tabela erro→HTTP
  tests/unit/ tests/integration/
frontend/           SPA React + Vite (TypeScript)
  src/app features components domain services styles
docs/               documentação (pt-BR); docs/adr/ = decisões
scripts/            check.sh é o portão
.agents/            regras e fluxos para agentes
```

**Direção de dependência (só desce):**

```text
api  →  assistant  →  work  →  identity  →  db  →  {settings, errors}
```

Nada abaixo de `api/` importa FastAPI. Só `assistant/llm/` fala com provedor de modelo. O assistente, a API e (futuramente) as rotinas agendadas chamam os **mesmos serviços** com um `Ctx` explícito (conexão + usuário da sessão). Violação é bug de projeto, não estilo.

## 4. Convenções

- Código, comentários, logs, nomes de testes técnicos: o que já existe no arquivo; textos que a pessoa usuária lê: **português do Brasil**.
- Comentários explicam o *porquê*. Mensagens de erro dizem o que houve **e** o que fazer.
- Serviços levantam exceções de `errors.py`; `api/app.py` tem a **tabela única** exceção→HTTP. Não faça `try/except` em rota.
- Objeto inexistente e objeto fora do escopo respondem igual (403): não revela se o ID existe.
- Datas: instantes em UTC (`timestamptz`); prazos sem horário são `date` de calendário; "hoje" é calculado no fuso da pessoa.
- Logs operacionais **sem conteúdo** de conversas, tarefas ou comentários.
- Migrações são versionadas e imutáveis depois de publicadas: nova mudança = novo arquivo em `backend/migrations/`.
- Commits em Conventional Commits.

## 5. Definição de pronto

- [ ] `make check` passa.
- [ ] Comportamento novo tem teste; correção de bug tem teste que falhava antes.
- [ ] Fluxo novo respeita permissão **no servidor** e tem teste de acesso cruzado quando toca dados de espaço.
- [ ] A documentação confere com o código; decisão arquitetural virou ADR.
- [ ] Nada fora da tarefa no diff.

## 6. O que um agente não decide sozinho

| Área | Por quê |
| --- | --- |
| `backend/src/projeta/assistant/tools.py` (instruções e ferramentas) e `service.py` (`INSTRUCTIONS`) | São o produto: alteram o comportamento do assistente de formas que testes cobrem só em parte |
| `backend/migrations/` já publicadas | Imutáveis; altere por nova migração |
| `docs/adr/` | Decisões são de pessoas; agentes rascunham, pessoas aceitam |
| `.github/`, `AGENTS.md`, `scripts/check.sh` | Agente não amplia as próprias permissões |
| Dependências (`pyproject.toml`, `package.json`) | Cadeia de suprimentos |

## 7. Atribuição

Commits assistidos por agente levam o trailer `Co-Authored-By:` do agente.

## 8. Quando estas instruções estão erradas

Se este arquivo contradiz o código, o código vence e **este arquivo é o bug**: abra PR corrigindo-o.
