# Projeta

Aplicação de gestão de projetos em português do Brasil, com backend FastAPI e PostgreSQL e frontend React + Vite. O assistente consulta dados e prepara propostas; alterações só são executadas após confirmação.

## Informações do projeto

Em **Visão geral → Sobre o projeto → Editar informações**, administradores e gerentes com acesso podem editar nome, resumo (até 280 caracteres), descrição detalhada, responsável, demandante/relator e referência de origem. O resumo aparece nos cartões e no cabeçalho; descrições longas podem ser expandidas na ficha. Responsável e demandante são textos informativos; o acesso continua sendo controlado pelos membros do projeto. Prazos, prioridades e progresso das entregas ficam nas tarefas. O campo opcional **% concluído informado** funciona como o "% Terminado" do Redmine: preenchido, ele é o percentual exibido no projeto, na lista e no portfólio, ao lado da contagem de tarefas concluídas; vazio, o percentual é calculado pelas tarefas concluídas.

As tarefas exibem etiquetas de prioridade (BAIXA, MÉDIA, ALTA ou URGENTE) nas listas e no quadro. Ao abrir uma tarefa, é possível mudar sua prioridade e cadastrar tags separadas por vírgulas. As tags são salvas junto com a tarefa. Urgentes vêm antes das de prioridade alta em "Hoje" e nas buscas.

## Sprints

Qualquer projeto pode trabalhar em sprints (aba **Sprints**). À esquerda fica o **backlog**: as tarefas sem sprint, numa ordem única que é a prioridade de fato (arraste ou use as setas). À direita ficam as sprints abertas. Cada uma tem uma **meta** em uma frase, datas fixas e, se informada, a **capacidade** da equipe em horas, comparada com a soma das estimativas e com a carga de cada pessoa. A próxima sprint já vem com a mesma duração da anterior (2 semanas na primeira, até 31 dias). Subtarefas acompanham a sprint da tarefa-mãe.

Quem gere o projeto planeja, inicia e encerra. Só há uma sprint em andamento por vez, e ela só começa com meta. Depois do início, as datas ficam fixas. Quem edita tarefas coloca e tira tarefas da sprint. O encerramento nunca é automático: o diálogo mostra o que foi entregue e pergunta se o que ficou aberto vai para a próxima sprint ou volta ao backlog. O relatório da sprint encerrada (comprometido no início, adicionado e retirado no meio, concluído) não muda depois. O Quadro abre na sprint em andamento; Quadro e Lista filtram por sprint. Decisão: [ADR 0006](docs/adr/0006-sprints-no-projeto.md).

Na mesma ficha ficam as **subtarefas** e os **comentários**. Subtarefas têm um nível só: a tarefa-mãe mostra quantas já foram concluídas (ex.: 3/5), e a lista e o quadro exibem cada subtarefa ligada à sua mãe. Uma tarefa existente vira subtarefa em "Mais detalhes → Tarefa-mãe". Excluir a mãe não apaga as subtarefas: elas voltam a ser tarefas principais. Comentários registram andamento e decisões em texto puro. Quem pode editar a tarefa comenta; quem só lê, lê. Cada pessoa edita e remove os próprios comentários, e o gerente do projeto pode remover qualquer um. O histórico do projeto registra que houve comentário, mas não guarda o texto.

Em **Hoje** e em **Minhas tarefas**, cada tarefa aberta tem **ações rápidas** para atualizar sem abrir a ficha: mudar o estado, **adiar** o prazo (amanhã, em 3 dias ou em 1 semana, contados a partir de hoje) e **anotar** o andamento, que vira um comentário da tarefa. Concluir continua sendo a caixa de seleção. Quem não tem permissão recebe a recusa do servidor, como na ficha. Quem prefere escrever usa **Contar ao assistente** na ficha da tarefa: o painel do assistente abre com "Comente na tarefa …:" já preenchido, e o texto só é enviado quando a pessoa envia. Com a conversa vazia, o painel também traz modelos de atualização ("Concluir uma tarefa", "Registrar andamento", "Mudar um prazo") que preenchem o campo sem enviar. Toda alteração pelo assistente continua passando por prévia e confirmação.

Em **Editar informações**, a seção **Campos do portfólio** aceita campos livres de nome e valor, como Complexidade, PDTI ou Custo estimado, até 20 por projeto. Não há cadastro prévio: os nomes e valores já usados no espaço aparecem como sugestão. No **Portfólio**, os campos aparecem no cartão e servem de filtro (campo e valor), combinado com o filtro de situação.

A home (**Hoje**) é um painel que, no computador, cabe numa tela sem rolar a página: o **Panorama por área** ocupa a coluna principal (rola por dentro) e a coluna lateral reúne o pulso dos OKRs, os resultados-chave da pessoa e as tarefas dela, em abas (Atrasadas, Hoje, Prioridades, 7 dias, Sem prazo). No topo do panorama ficam cinco números (projetos, conclusão média, em risco, atrasados e tarefas atrasadas); clicar em "Em risco" ou "Atrasados" deixa nos blocos só os projetos naquela situação. Abaixo, um bloco por área: os projetos do próprio espaço e um bloco para cada unidade filha direta no organograma. Cada nível vê só os filhos diretos: na COTIN, DIGTI, DISEG, DISID e DIRAU são áreas; na COINT, tudo o que subiu delas fica no bloco COTIN, e cada projeto mostra o setor de origem. Projeto compartilhado direto de fora da própria linha fica junto dos projetos do próprio espaço (no bloco "sem pasta", quando há pastas), sem criar um bloco para o espaço de origem. O setor pode agrupar os próprios projetos em **pastas** (por tema, como "ERP" ou "Imóveis"): quem tem "Gerir projetos" usa **Organizar pastas** no panorama para criar, renomear e excluir pastas e escolher a pasta de cada projeto; aí o bloco do próprio espaço se divide em um bloco por pasta (com ícone de pasta) e um bloco "sem pasta" com o resto. Pastas só organizam a visão: não mudam quem vê ou edita, ficam no espaço dono (quem recebe o projeto pelo organograma não vê a pasta) e excluir uma pasta não apaga projeto. A tela **Projetos** funciona como um explorador de arquivos: um painel de pastas à esquerda ("Projetos" e cada pasta, com a contagem) e, à direita, na raiz, as pastas em cartões e os projetos fora de pasta; clicar numa pasta abre só os projetos dela (o endereço guarda a pasta aberta). Quem gere arrasta um projeto até uma pasta (no painel ou no cartão) para guardá-lo, ou até "Projetos" para tirá-lo da pasta; as pastas que aceitam ficam realçadas durante o arraste e o projeto muda de lugar na hora. O botão direito abre um menu: na pasta, Abrir, Renomear (F2) e Excluir (Delete, com confirmação); no projeto, Abrir, Abrir em nova aba e Mover para outra pasta; no painel, Nova pasta. **Nova pasta** cria "Nova pasta" (ou "Nova pasta (2)"…) já com o nome selecionado para digitar; Enter salva e Esc desiste. O botão **Organizar** faz o mesmo por lista, sem arrastar, e um projeto criado com a pasta aberta já nasce nela. Cada bloco traz o número de projetos, a conclusão média e quantos estão em risco ou atrasados, e lista os projetos com uma barra de progresso na cor da situação (verde em dia, laranja em risco, vermelho atrasado), os atrasados primeiro. As áreas vêm por ordem de atenção: a do próprio espaço, depois as com mais projetos atrasados, depois as com mais em risco. Clicar em qualquer ponto de um bloco **expande a área**: ela ocupa o panorama, com término, tarefas atrasadas e fase em cada projeto, e as demais viram uma coluna estreita ao lado (clicar numa delas troca a área expandida; "Recolher" ou Esc volta ao mosaico). Expandida, o nome da área abre o Portfólio já recortado nela e cada projeto abre o projeto. A troca é animada: blocos e projetos deslizam até a nova posição (View Transitions do navegador); com "reduzir movimento" ligado no sistema, ou em navegador sem suporte, a troca é imediata. No computador, o panorama cabe numa tela sem rolagem: as áreas dividem a largura conforme o número de projetos, cada área escolhe a grade de colunas e linhas que melhor preenche o bloco, e os projetos encolhem (menos texto) para caber; só uma área com dezenas de projetos rola por dentro. O botão **Esconder OKRs e tarefas** recolhe a coluna lateral para o panorama ocupar a largura toda; a escolha fica no navegador. Sem projetos ativos, o panorama não aparece.

O **Portfólio** abre no modo **Quadro** (os outros modos são Blocos e Lista; a escolha fica no navegador). No topo, cinco números (projetos, conclusão média, em risco, atrasados e tarefas atrasadas); abaixo, os projetos em grupos recolhíveis por situação (padrão), prazo, fase ou um campo do portfólio. O quadro segue o formato de board: cada grupo tem título na sua cor, cabeçalho próprio e uma linha de resumo (média de progresso, período do grupo, tarefas atrasadas). Cada projeto ocupa uma linha com progresso, timeline (período do início ao término, preenchido até hoje), data de término e tarefas atrasadas; a situação aparece como etiqueta colorida quando o agrupamento não é por ela. Situação e prazo usam cores de significado; fase e campo livre, cores de categoria. Clicar em "Em risco" ou "Atrasados", ou escolher campo e valor, filtra o quadro. Home e Portfólio usam a mesma consulta, com o mesmo recorte de acesso feito no servidor.

Os **prazos** são classificados em cinco grupos: **Prazo vencido** (a data prevista passou sem chegar a 100%), **Ritmo abaixo do previsto** (o tempo decorrido passa o % concluído em mais de 25 pontos), **Termina em até 30 dias**, **No prazo** e **Sem prazo definido**. As datas vêm, nesta ordem, dos campos do portfólio com nome de data (ex.: "Início", "Data prevista", "Término"; sem diferenciar acento ou maiúscula; formatos dd/mm/aaaa ou aaaa-mm-dd), do TAP e dos prazos das tarefas; sem nenhuma delas, o início é a data de criação do projeto.

## Relatório do projeto

O botão **Relatório**, no cabeçalho de cada projeto, abre o relatório de andamento numa folha A4 com a identidade da plataforma, pronto para apresentar. **Imprimir ou salvar PDF** abre a janela de impressão do navegador; escolha "Salvar como PDF" para gerar o arquivo (o nome sugerido traz o projeto e a data). A folha é sempre clara, também no modo escuro.

O relatório traz: a ficha resumida (responsável, demandante, fase, abordagem, processo SEI, referência, equipe), o progresso (informado ou pelas tarefas), a situação do prazo com a mesma regra do Portfólio e a linha do tempo do início ao término comparando prazo decorrido e % concluído, a última nota de acompanhamento, as tarefas por estado, a sprint em andamento, o andamento por fase, os pontos de atenção (atrasadas e bloqueadas), as entregas dos próximos 30 dias, as concluídas nos últimos 14 dias, os marcos, os riscos ativos mais graves e os campos do portfólio. Tabelas longas mostram as 10 primeiras linhas e quantas ficaram de fora. Os dados vêm das mesmas leituras das abas do projeto, com o mesmo recorte de acesso feito no servidor: quem pode ler o projeto pode gerar o relatório.

## Riscos

Cada projeto tem uma aba **Riscos** com o registro de riscos no formato do PMBOK ([ADR 0011](docs/adr/0011-registro-de-riscos-do-projeto.md)). **Novo risco** abre um formulário em três passos. **Identificar**: ameaça ou oportunidade, o evento ("o que pode acontecer"), a causa e o efeito (a tela monta a frase "Porque…, pode ocorrer: … Efeito: …"), a categoria (técnico, gerenciamento, comercial ou externo) e os objetivos afetados (prazo, custo, escopo, qualidade). **Analisar**: probabilidade e impacto de 1 a 5, escolhidos clicando numa célula da matriz ou nas listas; a pontuação é o produto (1–25) e define o nível: baixo (até 4), moderado (5–9), alto (10–14) ou crítico (15 ou mais). **Planejar a resposta**: a estratégia do tipo (ameaça: evitar, mitigar, transferir, aceitar ou escalar; oportunidade: explorar, melhorar, compartilhar, aceitar ou escalar), o plano de resposta, o plano de contingência, o gatilho, o responsável (membro do projeto) e o prazo da resposta. Ao editar, o passo **Monitorar** traz a situação (identificado, em tratamento, ocorreu, encerrado) e a data da última revisão, com o botão **Revisado, sem mudança**; mudar probabilidade, impacto ou situação também conta como revisão.

No topo da aba, uma faixa fina de indicadores: riscos ativos (identificados e em tratamento), quantos são críticos ou altos, quantos moderados ou piores estão sem estratégia, quantos estão há mais de 30 dias sem revisão e quantos têm a resposta atrasada. Abaixo, o **registro de riscos** ocupa a área principal; ao lado ficam a **matriz de probabilidade × impacto** (número de riscos em cada célula) e um gráfico de rosca com abas: por nível, por categoria ou por situação. No computador a aba cabe na tela sem rolar a página: o registro e a coluna lateral rolam por dentro. Clicar num indicador, numa célula ou numa fatia (ou no item da legenda) filtra o registro; clicar de novo limpa. O registro lista os riscos com código (R-01, R-02…), nível e pontuação, categoria, estratégia, responsável e situação, os ativos primeiro e os mais graves no topo. O código não é reaproveitado depois de uma exclusão.

Na **Visão geral** do projeto, o cartão **Riscos do projeto** (no lugar das antigas "Próximas entregas", que continuam contadas no indicador "Vencem em 7 dias") mostra uma barra com quantos riscos ativos há em cada nível e os três mais graves, só com nível e título; clicar num risco abre a ficha dele na aba Riscos, e "Ver todos" ou "+ N outros riscos" abre a aba.

Quem lê o projeto lê os riscos. Quem edita tarefas no projeto registra e atualiza riscos; só quem gere o projeto exclui (o caminho normal é marcar como encerrado). O histórico do projeto registra criação, alteração, revisão e exclusão, só com código e título.

## Metas (OKRs)

O menu **Metas** organiza os OKRs do espaço por trimestre. Cada **objetivo** diz aonde o time quer chegar e reúne **resultados-chave** mensuráveis. Um resultado-chave tem responsável e vai de um valor de partida até uma meta (pode ser decrescente, como reduzir de 30 para 10 dias) ou acompanha o % de um projeto do espaço. O progresso do objetivo é a média dos resultados-chave. A barra marca o ritmo esperado, isto é, quanto do trimestre já passou.

O responsável faz o **check-in**: informa o valor atual, a confiança (no caminho, em risco, fora do caminho) e, se quiser, uma nota. A janela mostra o avanço antes de salvar e, depois, oferece o próximo resultado-chave pendente. Um resultado-chave fica "pedindo atualização" depois de 7 dias sem check-in. O histórico de cada um guarda valor, confiança, nota e autor.

A tela muda conforme o papel. Quem gere (Gestor, ou perfil com "Criar e editar OKRs" ou "Gerir projetos" na matriz) abre a home no **pulso dos OKRs** e no panorama, e Metas no painel: indicadores, progresso por objetivo, quem precisa atualizar e edição. Quem executa abre a home em **Meus resultados-chave**, com as pendências e a sequência de semanas atualizando, e vê o panorama com um clique. Criar e editar OKRs exige a permissão "Criar e editar objetivos e resultados-chave"; o check-in é do responsável ou de quem gere. O servidor confere tudo. Decisão em rascunho: [ADR 0005](docs/adr/0005-okrs-e-telas-por-papel.md).

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

Abra <http://localhost:5173>. A API fica em <http://127.0.0.1:8000>; o Vite encaminha `/api` para ela. O login é só pelo GIA (matrícula e senha), no mesmo serviço e código de sistema do portal-terracap (`GIA_*` em `backend/.env.example`). Não há cadastro nem senha local. A primeira entrada cria a conta e o espaço pessoal, e a lotação devolvida pelo GIA leva ao espaço da unidade: vale só a sigla do organograma (`DIRAU - DIRAU - DIVISÃO DE ...` cai no espaço da DIRAU). Os dados da conta, a unidade e os espaços aparecem em **Perfil** (`/perfil`), onde a pessoa também põe, troca ou remove a própria foto (PNG, JPEG ou WebP; o navegador recorta em quadrado antes de enviar). O seed cria dados fictícios (Ana, Bruno e Carla, com matrículas `DEMO-*`); para ver esses dados ao entrar, rode `python scripts/seed.py --matricula SUA_MATRICULA`. Execute o seed somente em ambiente de desenvolvimento; a opção `--reset` apaga os dados existentes.

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

O assistente atua como gerente de projetos da pessoa e enxerga exatamente o que ela enxerga no espaço — as consultas passam pelos mesmos filtros de acesso da interface. Ferramentas de consulta: “meu dia”, prazos por período, busca de tarefas com filtros (projeto, estado, prioridade, responsável, atrasadas/hoje/semana/sem prazo), detalhes da tarefa (descrição, subtarefas, dependências, comentários), portfólio com saúde e campos livres, raio-x do projeto (equipe com funções e carga, ficha, última nota semanal, atividade recente, lacunas), carga por pessoa, atividade recente, projetos parados e bloqueios. Projetos e pessoas podem ser citados pelo nome. Também consulta pessoas e convites, fases, sprints, linhas de base, riscos, OKRs e check-ins, TAP/TEP, organograma e configurações. Propostas (sempre com prévia e confirmação): criar tarefas, aplicar EAP, mudar estado/prazo/progresso/prioridade/responsável, comentar numa tarefa, publicar a nota semanal e um **plano de ações** com até 20 passos que cobre o restante da plataforma — projetos (dados, fase, arquivar, equipe, funções, convites, pastas, compartilhamento), tarefas (todos os campos, sprint, subtarefas, dependências, exclusão), comentários, fases, sprints, linhas de base, riscos, TAP/TEP, OKRs e check-ins, membros, convites e permissões do espaço e as próprias preferências ([ADR 0012](docs/adr/0012-assistente-com-alcance-total.md)). Mudanças iguais em muitas tarefas (até 200, filtradas por fase, estado, responsável, sprint, prazo ou título — ex.: "adie em uma semana o que vence este mês") ocupam um único passo, com a lista de tarefas afetada congelada na prévia. O plano é simulado antes da prévia, executado tudo ou nada e destaca ações irreversíveis. Ficam de fora enviar arquivos, exportar, entrar/sair e aceitar convite. Cada resposta leva no máximo uma proposta. O modelo recebe a data de hoje no fuso da pessoa e o projeto em tela; `ASSISTANT_MAX_TOOL_ROUNDS` (padrão 8) limita as rodadas de consulta por mensagem.

O adaptador real está em `backend/src/projeta/assistant/llm/openai_client.py`; lê `ASSISTANT_PROVIDER=openai`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_REASONING_EFFORT` e `OPENAI_TEXT_VERBOSITY` no servidor. A interface usa `POST /api/v1/assistant/chat/stream`, que devolve a resposta em NDJSON conforme é gerada (trechos de texto, ferramenta em uso e a mensagem final já gravada); `POST /api/v1/assistant/chat` continua respondendo de uma vez. Validação, permissão e limite rodam antes do stream abrir. Os testes usam um cliente simulado; o streaming foi conferido também contra a API real.

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
