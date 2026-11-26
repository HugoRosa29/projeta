# ADR 0011 — Registro de riscos do projeto (PMBOK)

- **Estado:** proposto (rascunho de agente; falta uma pessoa aceitar ou recusar)
- **Contexto de origem:** pedido de uma aba de riscos no projeto, seguindo o PMBOK, com cadastro e acompanhamento fáceis e interativos e gráficos de pizza.

## Contexto

O projeto só tinha o "risco" derivado das tarefas (atrasadas, bloqueadas, vencendo). Não havia onde registrar uma incerteza que ainda não virou tarefa, avaliar a gravidade dela nem planejar e acompanhar a resposta, que é o que o PMBOK pede no gerenciamento de riscos (identificar, análise qualitativa, planejar e implementar respostas, monitorar).

## Decisão proposta

1. **Uma tabela `project_risks` por projeto** (migração 030), com os campos do registro de riscos do PMBOK: tipo (ameaça ou oportunidade), evento, causa e efeito (metalinguagem de risco), categoria do nível 1 da EAR de riscos (técnico, gerenciamento, comercial, externo), objetivos afetados, probabilidade e impacto (1–5), estratégia, plano de resposta, contingência, gatilho, responsável, prazo da resposta, situação e data da última revisão.
2. **Análise qualitativa com escala 1–5 e pontuação = probabilidade × impacto** (coluna gerada no banco). Os níveis (baixo até 4, moderado 5–9, alto 10–14, crítico 15+) são calculados no cliente, para poderem ser ajustados sem migração. A análise quantitativa (valor monetário esperado, Monte Carlo) fica de fora.
3. **A estratégia tem que valer para o tipo**, validado no serviço: ameaça aceita escalar, evitar, transferir, mitigar ou aceitar; oportunidade aceita escalar, explorar, compartilhar, melhorar ou aceitar. Trocar o tipo apaga uma estratégia que deixou de valer.
4. **Código sequencial por projeto (R-01, R-02…) que não se reaproveita**: o contador fica em `projects.last_risk_number`, para que excluir o risco mais recente não faça o próximo herdar o código dele em atas e relatórios.
5. **Monitoramento pela situação e pela revisão.** "Ocorreu" e "encerrado" saem dos indicadores, da matriz e das roscas de nível e categoria. Mudar probabilidade, impacto ou situação, ou marcar "revisado", atualiza `reviewed_at`; um risco ativo fica pedindo revisão depois de 30 dias.
6. **Permissões no servidor:** ler segue o acesso ao projeto; registrar e alterar exige `task.write` (vinculado, projeto ativo), porque quem está perto do trabalho vê o risco primeiro; excluir exige `project.manage`. Risco de outro projeto responde 403, igual ao inexistente. Edição usa controle de versão (409 quando outra pessoa alterou antes).
7. **Histórico sem conteúdo:** a atividade registra só o código, o título e a mudança de pontuação/situação, nunca causa, efeito ou planos.
8. **Gráficos próprios em SVG**, sem nova dependência: matriz 5×5 e roscas (nível, categoria, situação) que filtram o registro.

## Consequências

- A exportação/importação do espaço ainda não leva os riscos. Um projeto importado chega sem registro de riscos.
- O assistente não consulta nem propõe riscos. Incluir isso mexe em `assistant/tools.py`, que é decisão humana.
- O portfólio e o panorama continuam medindo "em risco" pelo prazo, não pelo registro de riscos.
- A resposta ao risco ainda não vira tarefa ligada. Hoje o plano é só texto; ligar a uma tarefa é um passo natural seguinte.
- As cores dos níveis seguem a escala de situação já usada nos gráficos, com o laranja de "alto" acrescentado; como verde, dourado, laranja e vermelho não se separam bem para todo tipo de daltonismo, o nível sempre aparece escrito.
