# ADR 0010 — Linhas de base do cronograma

- **Estado:** proposto (rascunho de agente; falta uma pessoa aceitar ou recusar)
- **Contexto de origem:** pedido para ter linha de base nos projetos — uma criada junto com o projeto e a opção de gerar novas no cronograma — com comparação fácil e interativa entre o planejado e o atual.

## Contexto

O cronograma mostra só as datas atuais. Quando um prazo muda (à mão ou pelo encadeamento de dependências), o plano anterior se perde e não dá para dizer quanto o projeto escorregou.

Ao ser criado, o projeto ainda não tem tarefas. Uma fotografia tirada nesse instante seria vazia.

## Decisão proposta

1. **Linha de base inicial (número 0), criada com o projeto, guarda o primeiro plano de cada tarefa.** A tarefa entra nela quando ganha prazo pela primeira vez (na criação ou numa edição), com o início e o prazo daquele momento. Depois disso não muda. Assim existe "o plano original" mesmo que o cronograma seja montado aos poucos.
2. **As outras (1, 2, …) são fotografias completas**: início e prazo de todas as tarefas com prazo no momento em que são salvas. Servem para registrar um replanejamento aprovado e medir os desvios a partir dele. A numeração não é reaproveitada depois de uma exclusão.
3. **A fotografia não depende da tarefa continuar existindo.** `baseline_tasks` guarda o título e não tem chave estrangeira para `tasks`. A tarefa excluída aparece como "removida" na comparação.
4. **Permissões no servidor:** quem lê o projeto lê as linhas de base. Salvar e excluir exige gestão do projeto (`project.manage`, vinculado, projeto ativo). A inicial não pode ser excluída. Há um limite de 20 linhas de base além da inicial.
5. **Registro na aplicação, não por gatilho no banco:** `work/baselines.py` é chamado na criação do projeto (tela e importação) e na criação/edição de tarefa, como os outros serviços. Projetos que já existiam ganharam a inicial na migração 027, com as datas daquele dia.
6. **A comparação é feita no cliente**, a partir da lista de tarefas que o cronograma já carrega e das datas da linha de base escolhida. O desvio é medido no prazo, em dias de calendário.

## Consequências

- A inicial de um projeto antigo reflete as datas do dia da migração, não o plano de verdade original.
- Uma tarefa criada com um prazo errado e corrigida logo depois fica com o prazo errado na inicial. Para esses casos, salve uma nova linha de base.
- A exportação do espaço ainda não leva as linhas de base. O projeto importado ganha só a inicial, com as datas do arquivo.
- O assistente não consulta linhas de base. Incluir isso mexe em `assistant/tools.py`, que é decisão humana.
