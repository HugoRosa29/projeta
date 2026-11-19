# Projeta

Aplicação de gestão de projetos em português do Brasil, com backend FastAPI e PostgreSQL e frontend React + Vite. O assistente consulta dados e prepara propostas; alterações só são executadas após confirmação.

## Informações do projeto

Em **Visão geral → Sobre o projeto → Editar informações**, administradores e gerentes com acesso podem editar nome, resumo (até 280 caracteres), descrição detalhada, responsável, demandante/relator e referência de origem. O resumo aparece nos cartões e no cabeçalho; descrições longas podem ser expandidas na ficha. Responsável e demandante são textos informativos; o acesso continua sendo controlado pelos membros do projeto. Prazos, prioridades e progresso das entregas ficam nas tarefas. O campo opcional **% concluído informado** funciona como o "% Terminado" do Redmine: preenchido, ele é o percentual exibido no projeto, na lista e no portfólio, ao lado da contagem de tarefas concluídas; vazio, o percentual é calculado pelas tarefas concluídas.

As tarefas exibem etiquetas de prioridade (BAIXA, MÉDIA ou ALTA) nas listas e no quadro. Ao abrir uma tarefa, é possível mudar sua prioridade, marcar URGENTE e cadastrar tags separadas por vírgulas. As tags são salvas junto com a tarefa.

Na mesma ficha ficam as **subtarefas** e os **comentários**. Subtarefas têm um nível só: a tarefa-mãe mostra quantas já foram concluídas (ex.: 3/5), e a lista e o quadro exibem cada subtarefa ligada à sua mãe. Uma tarefa existente vira subtarefa em "Mais detalhes → Tarefa-mãe". Excluir a mãe não apaga as subtarefas: elas voltam a ser tarefas principais. Comentários registram andamento e decisões em texto puro. Quem pode editar a tarefa comenta; quem só lê, lê. Cada pessoa edita e remove os próprios comentários, e o gerente do projeto pode remover qualquer um. O histórico do projeto registra que houve comentário, mas não guarda o texto.

Em **Editar informações**, a seção **Campos do portfólio** aceita campos livres de nome e valor, como Complexidade, PDTI ou Custo estimado, até 20 por projeto. Não há cadastro prévio: os nomes e valores já usados no espaço aparecem como sugestão. No **Portfólio**, os campos aparecem no cartão e servem de filtro (campo e valor), combinado com o filtro de situação.

A home (**Hoje**) abre com um **Panorama** dos projetos ativos que a pessoa pode ver no espaço. Ele mostra indicadores (projetos, conclusão média, tarefas abertas, atrasadas e bloqueadas) e gráficos: situação dos projetos, tarefas por estado, progresso por projeto, atrasadas por projeto, projetos formais por fase e projetos agrupados por um campo do portfólio. Clicar numa situação ou escolher campo e valor filtra todos os gráficos de uma vez. Os números vêm da mesma consulta do Portfólio, com o mesmo recorte de acesso feito no servidor. Sem projetos ativos, o panorama não aparece.

Logo abaixo dos indicadores fica a **Esteira dos projetos**, que vale para qualquer espaço. As etapas são as fases do projeto (00 Sem fase definida, 01 Iniciação … 05 Encerramento). Cada etapa mostra quantos projetos estão nela e um alerta com quantos têm prazo vencido ou ritmo abaixo do previsto. Os nomes ficam na **Timeline de prazos**, num cartão logo abaixo. Cinco contadores classificam os prazos: **Prazo vencido** (data prevista passou sem chegar a 100%), **Ritmo abaixo do previsto** (o tempo decorrido passa o % concluído em mais de 25 pontos), **Termina em até 30 dias**, **No prazo** e **Sem prazo definido**. A **timeline** desenha cada projeto do início ao término, com a parte concluída preenchida, a linha de hoje e o atraso tracejado. Clicar numa etapa ou num contador filtra a timeline. As datas vêm, nesta ordem, dos campos do portfólio com nome de data (ex.: "Início", "Data prevista", "Término"; sem diferenciar acento ou maiúscula; formatos dd/mm/aaaa ou aaaa-mm-dd), do TAP e dos prazos das tarefas; sem nenhuma delas, o início é a data de criação do projeto.

## Tudo no Docker (um comando)

```bash
docker compose up --build -d --wait   # ou: make up
```

Sobe PostgreSQL, API (migrações aplicadas na partida) e interface (nginx) e deixa o app em <http://localhost:5173>. O assistente fica em modo `mock`; para o real, copie `.env.example` para `.env` na raiz e defina `ASSISTANT_PROVIDER=openai` e `OPENAI_API_KEY`. O login por matrícula exige o GIA acessível em `GIA_SERVICE`; o cadastro e o login por e-mail e senha funcionam sem ele. Dados de demonstração (opcional, só em desenvolvimento): `docker compose exec api python scripts/seed.py`. `docker compose down` derruba tudo; os dados ficam no volume `projeta-pgdata`.

## Desenvolvimento local

Para abrir a versão já instalada e compilada no Windows, execute na raiz:

```powershell
.\scripts\start.cmd
```

O comando inicia o banco pelo Docker Compose e serve API e interface juntas em <http://127.0.0.1:5173>. Mantenha o Docker Desktop aberto. Se o servidor já estiver respondendo, informa o endereço sem iniciar outra instância. Ctrl+C encerra o servidor iniciado no terminal; o banco permanece ligado. Esse modo usa `frontend/dist`: alterações na interface exigem novo build. Para desenvolvimento com recarga automática, use os comandos abaixo.

Pré-requisitos: Python 3.12 ou superior, Node.js/npm compatíveis com as dependências do frontend, PostgreSQL e Bash. O `Makefile` requer GNU Make e um shell compatível com Bash. O Docker Compose fornecido inicia o banco de desenvolvimento na porta 55432.

```bash
make setup
make db
make migrate
make seed
```

Em dois terminais:

```bash
make run
make front
```

Abra <http://localhost:5173>. A API fica em <http://127.0.0.1:8000>; o Vite encaminha `/api` para ela. O login é só pelo GIA (matrícula e senha), no mesmo serviço e código de sistema do portal-terracap (`GIA_*` em `backend/.env.example`). Não há cadastro nem senha local. A primeira entrada cria a conta e o espaço pessoal, e a lotação devolvida pelo GIA vira um espaço de equipe comum a todos da mesma lotação. O seed cria dados fictícios (Ana, Bruno e Carla, com matrículas `DEMO-*`); para ver esses dados ao entrar, rode `python scripts/seed.py --matricula SUA_MATRICULA`. Execute o seed somente em ambiente de desenvolvimento; a opção `--reset` apaga os dados existentes.

### Windows sem Make

No PowerShell, a partir da raiz:

```powershell
python -m venv backend/.venv
& backend/.venv/Scripts/python.exe -m pip install -e 'backend[dev]'
if (!(Test-Path backend/.env)) { Copy-Item backend/.env.example backend/.env }
docker compose up -d db
cd frontend
npm ci
cd ../backend
& ./.venv/Scripts/python.exe -c 'from projeta import db; print(db.migrate()); db.close_pool()'
& ./.venv/Scripts/python.exe scripts/seed.py
```

Configure `ASSISTANT_PROVIDER=mock` em `backend/.env` para a demonstração sem chamadas externas. Inicie a API dentro de `backend` com `& ./.venv/Scripts/python.exe -m uvicorn projeta.api.app:app --reload --port 8000`. Em outro terminal, execute `npm run dev` dentro de `frontend`.

## Assistente

A configuração está em `backend/.env.example`. O modo `mock` reconhece frases controladas e usa as mesmas ferramentas e serviços de negócio dos testes. Exemplos: “O que vence hoje?”, “Crie tarefa: Revisar acessos” e “Quero migrar um site de Joomla para WordPress”. Não é um modelo de linguagem.

O assistente atua como gerente de projetos da pessoa e enxerga exatamente o que ela enxerga no espaço — as consultas passam pelos mesmos filtros de acesso da interface. Ferramentas de consulta: “meu dia”, prazos por período, busca de tarefas com filtros (projeto, estado, prioridade, responsável, atrasadas/hoje/semana/sem prazo), detalhes da tarefa (descrição, subtarefas, dependências, comentários), portfólio com saúde e campos livres, raio-x do projeto (equipe com funções e carga, ficha, última nota semanal, atividade recente, lacunas), carga por pessoa, atividade recente, projetos parados e bloqueios. Projetos e pessoas podem ser citados pelo nome. Propostas (sempre com prévia e confirmação): criar tarefas, aplicar EAP, mudar estado/prazo/progresso/prioridade/responsável, comentar numa tarefa e publicar a nota semanal. Cada resposta leva no máximo uma proposta. O modelo recebe a data de hoje no fuso da pessoa e o projeto em tela; `ASSISTANT_MAX_TOOL_ROUNDS` (padrão 8) limita as rodadas de consulta por mensagem.

O adaptador real está em `backend/src/projeta/assistant/llm/openai_client.py`; lê `ASSISTANT_PROVIDER=openai`, `OPENAI_API_KEY` e `OPENAI_MODEL` no servidor. Sua integração foi testada com um cliente simulado; chamadas reais ao provedor ainda precisam de validação.

Conversas e propostas ficam no PostgreSQL, separadas por usuário e espaço. A interface permite excluir o histórico da conversa. O adaptador envia instruções, histórico limitado e resultados das ferramentas ao provedor e configura `store=False` na chamada. Não há política automática de expurgo implementada.

Ao editar uma proposta, a tarefa continua intacta até a confirmação. Se ela mudou desde a versão de referência, o servidor retorna a prévia atualizada e exige novo clique. Os testes também cobrem confirmação duplicada, cancelamento, validade, acesso cruzado e indisponibilidade do provedor.

## Validação e continuidade

```bash
make check
```

Esse comando executa `scripts/check.sh`: verificações de arquivos versionados, formato, lint, testes, tipos e build. Os testes do backend usam PostgreSQL real e limpam o banco de teste `projeta_test`; não aponte `TEST_DATABASE_URL` para dados que deseja preservar.

Sem Make, execute o mesmo portão no Git Bash com `bash scripts/check.sh`, ou no PowerShell com `& 'C:/Program Files/Git/bin/bash.exe' scripts/check.sh`.

Veja [o estado de implementação e as pendências](docs/product/roadmap.md) e [o registro desta retomada](docs/product/retomada.md). As regras de contribuição estão em [AGENTS.md](AGENTS.md). Esta cópia de trabalho foi recebida sem `.git`; verificações de segredos e artefatos versionados são ignoradas pelo portão nessa condição.

O ambiente descrito é de desenvolvimento. A configuração de produção no Dokploy (`docker-compose.prod.yml`) está em [docs/guides/deploy.md](docs/guides/deploy.md). O deploy em si, restauração de backups, piloto, revisão de acessibilidade e operação de produção ainda precisam ser validados.
