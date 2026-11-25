# ADR 0005 — OKRs no espaço e telas por papel

- **Estado:** proposto (rascunho de agente; falta uma pessoa aceitar ou recusar)
- **Contexto de origem:** pedido para aplicar a gestão de OKR do [guia do monday.com](https://support.monday.com/hc/pt/articles/4402057681298-Gerenciamento-de-OKR-usando-a-monday-com), com telas diferentes para quem gere e para quem executa, e com o objetivo de levar quem atualiza o projeto a usar a plataforma

## Contexto

O Projeta acompanha projetos e tarefas, mas não tinha como dizer *para quê*: não havia metas do time nem como medi-las. A home era igual para todos: o panorama do espaço vinha antes das tarefas da pessoa, mesmo para quem só executa. Quem atualiza (o dono de uma entrega) não tinha um motivo claro nem um caminho curto para voltar à ferramenta.

O guia do monday organiza OKRs assim: **objetivos** agrupam **resultados-chave** (KRs). Cada KR tem dono, status e prazo, e uma nota calculada. **Check-ins** periódicos registram o andamento, e painéis mostram o progresso por objetivo e o geral do trimestre.

## Decisão proposta

1. **Modelo** (migração 017): `objectives` (espaço, trimestre `AAAA-Tn`, título, responsável) → `key_results` (dono, partida → meta, unidade, ou vínculo a um projeto) → `okr_checkins` (valor, progresso do momento, confiança, nota). A migração 019 acrescenta o custo do KR em reais (nulo = não informado; 0 = equipe interna). Quem tem `okr.manage` define o custo, e todo membro do espaço o vê no painel, com o total por objetivo.
2. **Progresso calculado na leitura.** KR numérico: `(atual − partida) / (meta − partida)`, limitado a 0–100. Também vale para meta decrescente, como reduzir de 30 para 10 dias. Um KR de projeto usa o mesmo % do portfólio (informado ou por tarefas concluídas). O objetivo usa a média dos KRs. A confiança do objetivo é a pior confiança entre os KRs. O check-in guarda o progresso daquele momento, então o histórico não muda se a meta mudar.
3. **Ritmo.** "Ritmo abaixo do previsto" usa o mesmo critério da esteira: o tempo decorrido do trimestre passa o progresso em mais de 25 pontos. Um KR fica "pedindo atualização" depois de 7 dias sem check-in.
4. **Permissões.** A nova ação `okr.manage` da matriz permite criar e editar objetivos e KRs. O padrão a dá ao Gerente de projeto, e o Gestor pode tudo. Ser dono do KR basta para fazer o check-in: é a delegação explícita de quem gere. Quem tem `okr.manage` também registra o check-in no lugar do dono. Qualquer membro do espaço lê. O dono precisa ser membro do espaço, e o projeto vinculado precisa ser do espaço e visível a quem vincula. Quem não enxerga o projeto vê o progresso do KR, mas não o nome nem o link do projeto.
5. **Telas por papel** (só ordem e destaque; o servidor decide o acesso):
   - *Gestão* (Gestor, `okr.manage` ou `project.manage`): a home abre com o **pulso dos OKRs** (progresso contra o ritmo, KRs por confiança, quem precisa atualizar) e o panorama. Em **Metas**, a página abre no painel: indicadores, progresso por objetivo, pendências por pessoa e edição.
   - *Execução*: a home abre em **Meus resultados-chave**, com as pendências primeiro e um botão que faz o check-in de todas em sequência. O panorama fica a um clique. Em **Metas**, a página abre nos próprios KRs e mostra os objetivos do time para dar contexto.
6. **Engajamento de quem atualiza:**
   - check-in em segundos, com valor já preenchido, controle deslizante, confiança em um toque e nota opcional;
   - prévia ao vivo do avanço (+N p.p.) e confirmação que reconhece o resultado, com destaque quando a meta é atingida;
   - fila de check-ins: ao salvar, oferece o próximo KR pendente;
   - sequência de semanas seguidas com check-in;
   - KR ligado a projeto que se atualiza sozinho pelas tarefas, para não haver retrabalho;
   - transparência: quem gere vê quem atualizou e quem está pendente.

## Consequências

- O assistente ainda não consulta nem propõe check-ins de OKR. Isso é mudança em `assistant/tools.py`, que cabe a uma pessoa decidir (AGENTS.md §6).
- "Exportar/importar espaço" ainda não leva os OKRs.
- O lembrete é só visual, na home e no painel, sem notificação, porque ainda não há agendador (roadmap, fase 3).
- Os OKRs são por espaço e não sobem pelo organograma: a COTIN não vê os OKRs da DISID. O alinhamento entre níveis (objetivo-pai) fica para uma próxima decisão.
- A home deixa de ser igual para todos. Quem é Membro e queria o panorama em destaque precisa de um clique a mais.

## Alternativas descartadas

- **OKR como tipo de projeto ou campo livre:** reaproveitaria telas, mas o projeto não tem dono por métrica nem histórico de check-ins, e o progresso misturaria entrega com resultado.
- **Progresso guardado no KR:** mais simples de ler, mas fica errado quando a meta muda ou quando o projeto vinculado avança.
- **Telas separadas por perfil fixo (`role`):** a matriz já é a fonte de "quem pode o quê" (ADR 0003). Usar as permissões evita uma segunda regra.
