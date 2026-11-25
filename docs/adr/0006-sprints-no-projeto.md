# ADR 0006 — Sprints no projeto

- **Estado:** proposto (rascunho de agente; falta uma pessoa aceitar ou recusar). Em 24/11/2026 a pessoa responsável escolheu cadência por projeto, prioridade "urgente" e estimativa em horas, e pediu a implementação.
- **Contexto de origem:** pedido para organizar as tarefas de um projeto em sprints, com prioridade por tarefa e datas por sprint. O roadmap já listava "sprints/versões" como pendência da fase 5.

## Contexto

Um projeto hoje tem tarefas com estado, prioridade (`low`/`medium`/`high`), prazo, estimativa em minutos, ordem manual (`position`), fase, marco e subtarefas. As visões são Quadro, Lista e Cronograma. O projeto formal já guarda a abordagem (`agile`/`waterfall`, migração 005), mas nada no produto muda quando o projeto é ágil: não há como dizer "isto é o que vamos entregar nas próximas duas semanas e por quê".

### O que as referências dizem

| Fonte | Ideia que aproveitamos |
| --- | --- |
| [Guia do Scrum 2020](https://www.scrumguides.org/scrum-guide.html) | A sprint tem duração fixa de até um mês. O planejamento responde **por quê** (a *meta da sprint*), **o quê** e **como**. O backlog do produto é **ordenado** (não só classificado), e a ordem é responsabilidade de uma pessoa. A meta da sprint é o compromisso; o escopo pode ser renegociado sem abandoná-la ([scrum.org](https://www.scrum.org/resources/blog/sprint-goal-commitment-sprint-backlog)). |
| Mike Cohn, *Agile Estimating and Planning* (2005) e [Capacity-Driven Sprint Planning](https://mountaingoatsoftware.com/blog/why-i-prefer-capacity-driven-sprint-planning) | Planejar pela **capacidade** (horas disponíveis da equipe), puxando itens um a um até encher. Velocidade só confere o plano: varia demais para decidir a sprint. Serve a equipes iniciantes em Scrum. |
| Kenneth Rubin, *Essential Scrum* (2012) | Cadência fixa (mesma duração sempre) torna a sprint previsível; sprint não muda de data depois de começar. |
| [Linear — Cycles](https://linear.app/docs/use-cycles) | Ciclos criados automaticamente na cadência do time; trabalho não concluído **passa para o próximo ciclo**; capacidade sugerida pela média dos três últimos ciclos. |
| Jira — [encerrar sprint](https://confluence.atlassian.com/x/jwG7E) | Ao encerrar, a pessoa escolhe o destino do que ficou aberto: próxima sprint, nova sprint ou backlog. O que está concluído fica na sprint. |
| Ryan Singer, [*Shape Up*](https://basecamp.com/shapeup) (Basecamp, 2019) | Contraponto: o tempo é fixo e o escopo flexível ("apetite"). Duas semanas podem ser pouco para entregas com sentido. Reforça que a **meta** importa mais que a lista. |
| Donald Reinertsen, *The Principles of Product Development Flow* (2009); MoSCoW; RICE ([comparação](https://blog.logrocket.com/product-management/prioritize-user-stories-agile)) | Técnicas de priorização (custo do atraso/WSJF, MoSCoW, RICE). Todas produzem, no fim, uma **ordem**; nenhuma substitui a decisão de quem prioriza. |

Leitura conjunta: o que funciona é (1) backlog em ordem única, (2) sprint curta de datas fixas com uma meta em uma frase, (3) planejamento contra a capacidade em horas, (4) encerramento explícito com destino do que sobrou e (5) relatório que mostra o que foi planejado, o que entrou no meio e o que foi entregue.

## Decisão proposta

1. **Opcional e por projeto.** Qualquer projeto pode ter sprints; a aba aparece em destaque quando a abordagem é `agile`. Projeto sem sprint continua igual.
2. **Modelo** (migração 018):
   - `sprints`: projeto, número, nome (padrão "Sprint N"), **meta** (texto), início e fim (`date` de calendário), estado `planned` → `active` → `closed`, `started_at`, `closed_at`, `capacity_minutes` (opcional), `version` e `summary jsonb` gravado ao encerrar.
   - No máximo **uma sprint ativa por projeto** (índice único parcial). Fim ≥ início. Datas de sprints do mesmo projeto não se sobrepõem.
   - `tasks.sprint_id` (nulo = backlog). Subtarefa segue a sprint da tarefa-mãe (validado no serviço).
   - `sprint_task_log`: entrada e saída de cada tarefa na sprint (`added_at`, `removed_at`; no máximo uma linha aberta por tarefa). Dá o escopo comprometido no início, o que entrou depois e, numa segunda etapa, o gráfico de burndown, sem reconstruir pelo histórico genérico.
3. **Prioridade = ordem.** A posição no backlog (`position`, já existente) é a prioridade de fato, ajustada por arrastar ou pelas setas. O rótulo de prioridade continua como classificação visual e filtro, agora com **`urgent`** acima de `high`. A etiqueta livre "URGENTE", que fazia esse papel, é convertida em prioridade pela migração 018 e sai da ficha da tarefa: fica um só jeito de dizer "urgente". Não adotamos WSJF/RICE como campos: seria configuração a mais para um produto que ainda não tem esse uso.
4. **Planejamento pela capacidade (Cohn).** A sprint mostra horas estimadas contra a capacidade informada, e a carga por pessoa. Tarefa sem estimativa aparece como "sem estimativa", sem bloquear. Pontos de história ficam fora.
5. **Ciclo de vida:**
   - *Criar:* a próxima sprint já vem com a mesma duração e começa no dia seguinte ao fim da anterior (cadência fixa; padrão de 2 semanas, até 31 dias, como no guia do Scrum). Datas de sprints do mesmo projeto não se sobrepõem.
   - *Iniciar:* exige meta escrita e nenhuma outra sprint em andamento. O escopo comprometido é o que estava na sprint nesse momento. As datas ficam travadas; a meta pode ser reescrita, com registro no histórico.
   - *Encerrar:* nunca automático. Vencida a data, a sprint mostra "Terminou — falta encerrar". O diálogo traz o resumo e pergunta o destino do que não terminou: a próxima sprint planejada (cria uma na mesma cadência se não houver) ou o backlog. As concluídas ficam na sprint. Quem encerra antes do fim muda o fim para o dia do encerramento, e o fim previsto fica no relatório. O resumo (comprometido, adicionado, retirado, concluído, não concluído, horas e destino) vai para `summary` e não muda mais.
6. **Permissões** (sem ação nova na matriz):
   - `project.manage`: criar, editar, iniciar e encerrar sprint.
   - `task.write`: colocar e tirar tarefas da sprint e reordenar o backlog (a equipe é dona do backlog da sprint).
   - Leitura segue a visibilidade do projeto. Sprint de outro projeto ou inexistente responde 403.
7. **Telas:**
   - Aba **Sprints** no projeto: backlog ordenado à esquerda; sprint ativa e próximas à direita, cada uma com meta, datas, dias restantes, barra de capacidade e carga por pessoa.
   - Quadro e Lista ganham filtro de sprint; com sprint ativa, o Quadro abre nela.
   - Visão geral do projeto: cartão da sprint ativa (meta, progresso, dias restantes).
   - Sprints encerradas: relatório somente leitura a partir de `summary`.
8. **Exportar/importar espaço** passa a levar sprints e o vínculo das tarefas. O registro de entrada e saída não viaja: no destino, as tarefas contam como comprometidas desde o início.

## Consequências

- O assistente não consulta nem propõe mudanças de sprint nesta etapa. Isso altera `assistant/tools.py`, que cabe a uma pessoa decidir (AGENTS.md §6).
- `assistant/tools.py` também precisa conhecer a prioridade `urgent` (nos `Literal` das ferramentas e na ordenação de `tool_tasks_due`). Sem isso, o modelo não filtra nem propõe "urgente", e a consulta de prazos por período falha (`KeyError`) quando há tarefa urgente no período. A mudança está descrita, mas não aplicada, porque cabe a uma pessoa (AGENTS.md §6).
- Burndown e velocidade média ficam para uma segunda etapa. O `sprint_task_log` já guarda o necessário.
- A cadência é por projeto. Quem trabalha em vários projetos não tem visão de capacidade somada entre eles.
- A ligação entre a meta da sprint e um resultado-chave (ADR 0005) fica para depois.

## Alternativas descartadas

- **Sprint como "fase" ou etiqueta:** reaproveitaria campos, mas não há datas, meta, estado nem regra de uma ativa por vez.
- **Rolagem automática ao fim da data (como o Linear):** menos cliques, mas tira o momento de revisão e esconde o que não foi entregue.
- **Cadência no espaço (todos os projetos na mesma sprint):** útil para capacidade compartilhada, mas obriga projetos com ritmos diferentes a seguir o mesmo calendário.
- **Pontos de história ou campos de WSJF/RICE:** exigem calibração e disciplina que o público atual não tem. A estimativa em horas já existe no modelo.
