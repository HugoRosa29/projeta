# ADR 0001 — Modo "projeto formal" opcional

- **Estado:** proposto (rascunho de agente; falta uma pessoa aceitar ou recusar)
- **Contexto de origem:** POP de Gestão de Projetos, Programas e Portfólio da TI da Terracap

## Contexto

O POP exige, para projetos de TI do PDTI: fases definidas, funções com segregação (qualidade e segurança não podem ser de quem projeta ou executa), nota semanal de acompanhamento, Termo de Abertura (TAP), Termo de Encerramento (TEP), processo no SEI e visão de portfólio. O Projeta atende também tarefas pessoais e outros espaços, onde essas regras não se aplicam.

## Decisão proposta

1. As regras do POP entram como **modo opcional por projeto**: `projects.phase` nulo é projeto comum e nada muda para ele.
2. **Funções** ficam em `project_members.roles` (gp, po, an, as, ex, se, qa, ei). A segregação (qa/se x ex/as na mesma pessoa) é validada no serviço, não na interface.
3. **Nota semanal**, **TAP** e **TEP** são dados do projeto (`project_status_notes`, `project_terms`), com controle de versão otimista nos termos. O TAP/TEP são exportados em Markdown para anexar ao SEI; **o Projeta não assina nem substitui o SEI**, só guarda o número do processo.
4. **Portfólio** é uma leitura por espaço, limitada ao que a pessoa já enxerga.
5. **Convite por matrícula**: o GIA só confirma identidade no login (não há consulta de diretório). O convite guarda a matrícula e vincula a pessoa na hora, se a conta existe, ou no primeiro login, se não existe. A resposta ao convidar é a mesma nos dois casos, para não revelar quem já usou o sistema.
6. O **assistente** ganha uma proposta, `status_note`, que segue o fluxo existente (proposta, prévia editável, confirmação, execução, histórico). A justificativa de atraso só pode vir do usuário; o modelo não a inventa.

## Consequências

- Nova migração (005, 006); nenhuma migração publicada foi alterada.
- Mudança em `assistant/tools.py` e `service.py` (área de decisão humana pelo AGENTS.md): **exige revisão de uma pessoa antes de valer**.
- O POP é interno e revisado anualmente; os campos de TAP/TEP seguem a estrutura atual do modelo e podem precisar de ajuste a cada revisão.
- Não há agendador no produto: "nota semanal vencida" aparece no portfólio, mas não gera lembrete ativo até existir o agendador do roadmap.

## Alternativas descartadas

- Tornar o POP regra global: quebraria o uso pessoal e de outros espaços.
- Um papel único por membro: impediria acumular funções e tornaria a segregação trivial e inútil.
- Convite por e-mail com token: o e-mail do GIA nem sempre existe ou é livre; a matrícula é a identidade confiável.
