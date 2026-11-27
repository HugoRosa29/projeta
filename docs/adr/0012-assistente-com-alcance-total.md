# ADR 0012 — Assistente com alcance total por plano de ações

- **Estado:** proposto (rascunho de agente; falta uma pessoa aceitar ou recusar)
- **Contexto de origem:** pedido para o assistente fazer, em linguagem natural, tudo o que uma pessoa faz na plataforma.

## Contexto

O assistente consultava tarefas e projetos e propunha só cinco tipos de alteração (criar tarefas, EAP, mudar estado/prazo/progresso/prioridade/responsável, comentar, nota semanal). Riscos, sprints, OKRs, fases, pastas, linhas de base, TAP/TEP, equipe, convites, organograma, permissões e preferências só existiam na tela. Criar um tipo de proposta, com prévia própria, para cada uma dessas ações multiplicaria código e telas.

## Decisão proposta

1. **Um tipo de proposta genérico, `actions`** (migração 031): um plano de 1 a 20 passos. Cada passo é uma ação registrada em `assistant/actions.py`, com parâmetros validados (pydantic, campo desconhecido é erro) e uma função que chama **o mesmo serviço** usado pela rota da API. O assistente nunca grava: o plano segue proposta → prévia editável → confirmação → execução → histórico.
2. **Tudo ou nada.** Os passos rodam em ordem, na transação da confirmação. Se um falhar, nenhum grava, a proposta continua pendente e a mensagem diz qual passo falhou.
3. **Simulação antes da prévia.** Ao propor e ao editar, o plano roda dentro de um SAVEPOINT que é desfeito. Assim a pessoa vê o erro real do serviço (permissão, regra de negócio) antes de confirmar. É seguro porque nenhum serviço de escrita tem efeito fora do banco, e desfazer o SAVEPOINT libera as travas que ele pegou. Na confirmação tudo é revalidado.
4. **Escopo do espaço como defesa extra.** Todo ID citado precisa pertencer ao espaço da conversa (e toda pessoa citada, ser membro dele). Fora disso a resposta é 403, igual a objeto inexistente.
5. **Nomes no lugar de IDs.** As ferramentas resolvem projeto, tarefa, pessoa, sprint, risco (R3), fase, linha de base, objetivo, KR, pasta e convite pelo nome, só entre o que a pessoa enxerga. Ambiguidade volta para o modelo com as opções. O que um passo anterior do mesmo plano cria pode ser citado pelo nome; vira `@passo:N` e recebe o ID real na execução.
6. **Controle de versão.** Edições de tarefa, risco, sprint e termo guardam a versão vista na proposta. Se o registro mudar até a confirmação, o serviço recusa (409).
7. **Ações irreversíveis ou que mudam acesso** (excluir, remover pessoa, mudar perfil ou permissões, compartilhar tudo) aparecem destacadas na prévia, e as instruções pedem que o assistente avise o que se perde ou quem passa a ver.
8. **Segredo fora do histórico.** O link de convite ao espaço volta só na resposta da confirmação; não fica no resultado gravado, nas mensagens nem no que vai ao modelo.
9. **Edição em lote como um passo só** (`task.bulk_update`): filtros dentro de um projeto (fase, estado, responsável, sprint, prazo, título) ou lista explícita, até 200 tarefas, inclusive "mover datas em N dias". A seleção é congelada na proposta com as versões; todas são conferidas antes de gravar a primeira, e cada tarefa passa pelo `update_task` da tela. Tarefa que passar a casar com o filtro depois da prévia não entra.
10. **Novas consultas:** pessoas e convites, plano do projeto (fases, sprints, linhas de base, notas), riscos, OKRs e check-ins, termos TAP/TEP, organograma e configurações.
11. **O catálogo de ações que vai ao modelo é gerado dos próprios modelos de parâmetros**, para não divergir do código.

## Consequências

- Ficam fora do alcance, porque não cabem em texto ou exigem o link pessoal: enviar capa, foto ou arquivo de importação, exportar o espaço, entrar/sair e aceitar convite. As instruções mandam o assistente explicar como fazer pela tela.
- Os cinco tipos antigos continuam (prévias específicas, como o antes/depois da tarefa); o genérico cobre o resto e as mudanças em lote.
- Fora as tarefas, a atividade registrada por ações genéricas não marca "via assistente", porque os outros serviços não recebem esse parâmetro.
- O catálogo aumenta o texto enviado ao provedor em cada chamada (cerca de 2 mil tokens). Ele é idêntico entre chamadas, o que favorece o cache de prompt.
- A prévia genérica mostra referências pelo nome sem permitir trocá-las; para trocar, a pessoa pede ao assistente.
