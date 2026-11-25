# Estado do produto

Atualizado em 09/11/2026 a partir do código disponível. O [plano original](../../Plano_Claude_Gestao_de_Projetos.md) descreve o objetivo completo; esta lista distingue implementação de trabalho futuro.

| Fase | Presente no código | Pendente |
| --- | --- | --- |
| 1 — Base | Cadastro/login, espaços, convites, papéis com matriz de permissões editável pelo Gestor ([ADR 0003](../adr/0003-permissoes-por-perfil.md)), organização pelo organograma com projetos compartilhados para cima ([ADR 0004](../adr/0004-organizacao-e-compartilhamento.md)) ou direto com qualquer setor ([ADR 0008](../adr/0008-compartilhamento-direto-entre-setores.md)), titular de cada unidade como Gestor ([ADR 0007](../adr/0007-titular-e-o-gestor-da-unidade.md)), projetos, tarefas pessoais e de projeto, lista, quadro, Hoje e histórico | Validação da jornada completa no navegador, inclusive 360 px |
| 2 — Assistente | Consultas (meu dia, prazos, busca com filtros, detalhes da tarefa com comentários, portfólio, raio-x do projeto, carga por pessoa, atividade recente, parados, bloqueios), projetos e pessoas pelo nome, links, escolha entre tarefas homônimas, EAP com fases/marcos/dependências, propostas de criação, atualização (estado, prazo, progresso, prioridade, responsável) e comentário, revisão, cancelamento, confirmação e controle de versão | Propostas de lembretes, de campos do projeto (fase, % concluído, campos livres) e de TAP/TEP; teste real com o provedor; ampliar a edição dos campos da EAP |
| 3 — Colaboração e agenda | Dependências com detecção de ciclos (ligadas arrastando na lista ou no cronograma, com setas e alerta de conflito de datas), data de início da tarefa, marcos, calendário de prazos, cronograma, busca/filtros em partes da aplicação, comentários na tarefa e subtarefas (um nível) | Compromissos, notificações, agendador e deduplicação de lembretes, resumo diário automático |
| 4 — Voz e estimativas | Campos manuais de estimativa e responsável | Áudio/transcrição, estimativas com evidência histórica e sugestão de responsáveis |
| 5 — Riscos e relatórios | Consulta de bloqueios e projetos parados no assistente; portfólio por espaço com campos livres filtráveis; panorama em quadro na home; sprints no projeto com relatório de encerramento ([ADR 0006](../adr/0006-sprints-no-projeto.md)) | Relatórios, importação/exportação CSV (exportar/importar o espaço inteiro em JSON já existe; ver [guia](../guides/deploy.md#levar-um-espaço-de-uma-instalação-para-outra)), burndown e velocidade das sprints, versões, anexos e alertas persistentes |
| 6 — Operação | Seed fictício, configuração local e testes automatizados | Implantação, backups/restauração, observabilidade operacional, acessibilidade e piloto |

Próximo incremento funcional: lembretes com persistência, autorização, processamento idempotente e integração ao fluxo de propostas. A expansão das ferramentas/instruções do assistente precisa seguir a área de decisão humana definida em `AGENTS.md`. Novas estruturas de banco devem usar novas migrações.

## OKRs e telas por papel

Rascunho: [ADR 0005](../adr/0005-okrs-e-telas-por-papel.md). Presente no código, com testes: objetivos por trimestre, resultados-chave numéricos ou ligados a projeto, check-in com confiança e nota, histórico, permissão `okr.manage`, painel de quem gere, "Meus resultados-chave" e home diferente para gestão e execução.

Pendente: o assistente consultar e propor check-ins (decisão humana, `assistant/tools.py`), OKRs na exportação/importação do espaço, alinhamento entre unidades do organograma, lembrete ativo de check-in (depende do agendador) e validação no navegador (inclusive 360 px).

Nenhuma fase é declarada concluída apenas pela presença das telas. As pendências de navegador, provedor e operação acima permanecem abertas.

## Sprints

Decisão: [ADR 0006](../adr/0006-sprints-no-projeto.md). Presente no código, com testes: sprints por projeto com meta, datas e capacidade em horas; backlog ordenado; uma sprint ativa por vez; encerramento com destino do que ficou aberto e relatório imutável; prioridade "urgente"; sprints na exportação/importação do espaço.

Pendente: o assistente consultar e propor mudanças de sprint (decisão humana, `assistant/tools.py`), burndown e velocidade média (o registro de entrada e saída já existe), capacidade somada de quem está em vários projetos e validação no navegador (inclusive 360 px).

## Modo projeto formal

Baseado no POP de gestão de projetos da TI da Terracap, de uso opcional (projeto sem fase segue comum). Decisão em rascunho: [ADR 0001](../adr/0001-modo-projeto-formal.md).

Presente no código, com testes: fase, abordagem e processo SEI; funções por pessoa com segregação (qualidade/segurança x projeto/execução); nota semanal com rascunho calculado; TAP e TEP com controle de versão, rascunho do TEP e exportação em Markdown; portfólio por espaço; convite ao projeto por matrícula (vínculo imediato se a conta existe, senão no primeiro login pelo GIA); proposta `status_note` do assistente (prévia editável e confirmação). Telas: aba "Formal" no projeto, convite na equipe e página Portfólio.

Pendente: lembrete ativo de nota semanal vencida (hoje só o portfólio sinaliza; depende do agendador), propostas do assistente para TAP/TEP, exportação em PDF/DOCX, revisão de acessibilidade das telas novas e validação no navegador (inclusive 360 px).
