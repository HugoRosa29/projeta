# Plano de implementação para o Claude
## Plataforma de gestão de projetos com assistente pessoal

### 1. Instrução de execução

Atue como engenheiro responsável pela entrega. Implemente uma aplicação web em português do Brasil, responsiva, para uso individual e em equipes pequenas. Comece inspecionando o repositório, as instruções locais e os comandos de validação. Se houver produto em andamento, preserve a arquitetura e os fluxos existentes que atendem ao plano. Se o repositório estiver vazio, adote a arquitetura da seção 4. Registre decisões e dependências externas no README e inicie a primeira fase no mesmo ciclo de trabalho.

Entregue em fases verticais com interface, regras, persistência e validação integradas. Ao concluir uma fase, execute os testes, o lint e o build, registre evidências e avance para a próxima. Se faltar uma credencial, entregue a integração configurável, valide com um provedor de teste e registre a validação real como pendente. Retome a partir do último marco verificado se a execução continuar em outra sessão.

### 2. Produto e experiência

**Jornada principal.** Entrar → criar um projeto manualmente ou descrever um objetivo → revisar fases e tarefas → acompanhar a execução pelo quadro → consultar o assistente para decidir o próximo passo.

| Área | O que a pessoa deve conseguir fazer |
|---|---|
| Hoje | Ver prioridades pessoais, prazos próximos, tarefas vencidas e lembretes. Criar uma tarefa informando apenas o título. |
| Projetos | Criar, arquivar e consultar projetos. Dentro de cada projeto, alternar entre quadro, lista, cronograma e visão geral. |
| Minhas tarefas | Organizar tarefas pessoais e atribuídas por prazo, prioridade e situação. Manter tarefas pessoais privadas dentro do espaço de trabalho. |
| Agenda | Reunir prazos, marcos, compromissos internos e lembretes. Abrir o item original pelo calendário. |
| Assistente | Conversar a partir de qualquer tela, com contexto visível do projeto atual. Abrir referências e revisar ações sugeridas. |
| Configurações | Gerenciar equipe, convites, fuso horário e preferências de notificações. Mostrar opções de gestão apenas a quem tem permissão. |

Use quatro estados padrão no quadro: A fazer, Em andamento, Bloqueada e Concluída. Disponibilize mudança de estado por menu e teclado além do arraste. Mantenha título e ação principal em destaque, com datas, estimativas, etiquetas e dependências em campos opcionais. Mostre estados vazios com uma ação de início, mensagens recuperáveis em erros, foco visível e navegação por teclado. Valide o fluxo principal também em tela de 360 px.

### 3. Fases e critérios de saída

| Fase | Implementação | Critério de saída |
|---|---|---|
| 1. Base operacional | Login, espaço pessoal, espaços de equipe, convites, papéis, projetos, tarefas pessoais e de projeto, lista, quadro, Hoje e atividade. | Duas contas de teste colaboram no mesmo projeto. Uma terceira conta de outro espaço recebe acesso negado mesmo usando URLs ou IDs conhecidos. Uma tarefa criada aparece na lista e no quadro e persiste ao recarregar. |
| 2. Assistente e planejamento | Chat com modelo GPT, resumo diário sob demanda, consultas com links, geração de EAP com fases, marcos e tarefas, propostas para criar tarefas, atualizar status e cadastrar lembretes. | De um objetivo em texto nasce uma EAP editável. Cancelar preserva os registros existentes. Confirmar a mesma proposta duas vezes grava apenas um conjunto. A tarefa criada pode ser localizada pelo assistente e pela interface. |
| 3. Colaboração e agenda | Comentários, subtarefas, dependências, marcos, cronograma, calendário, busca, filtros, notificações internas, lembretes e resumo diário opcional. | Bloquear ciclos nas dependências. Um lembrete aparece uma vez mesmo após reprocessamento. Busca, cronograma e calendário abrem registros autorizados. |
| 4. Voz, estimativas e distribuição | Gravação e transcrição de áudio em pt-BR, revisão de atualizações, estimativas e indicação de responsáveis com base em competências, disponibilidade e carga. | Uma gravação gera transcrição editável e prévia da mudança. Com histórico, mostrar a faixa estimada, o tamanho da amostra e as premissas. Sem base suficiente, sinalizar a limitação e pedir revisão. |
| 5. Riscos e relatórios | Painel de portfólio, progresso, bloqueios, carga, relatório semanal, exportação CSV e alertas de cronograma e inatividade. | Uma dependência bloqueada com prazo próximo gera alerta com evidência e link. Alertas recorrentes são agrupados. Uma exportação contém apenas dados acessíveis ao solicitante. |
| 6. Piloto e operação | Dados fictícios de demonstração, acessibilidade, testes de recuperação, observabilidade, instruções de implantação e piloto com usuários. Avaliar módulo de clima separadamente. | Demonstrar a jornada principal em desktop e celular. Executar o sistema a partir de um ambiente limpo com README, migrações e dados de teste. Registrar resultados do piloto, limitações e itens ainda dependentes de validação. |

**Casos dos PDFs.** A geração de EAP corresponde ao caso 1.1 (fase 2). Estimativa e atribuição correspondem a 1.2 e 2.1 (fase 4). Atualização por chat e áudio corresponde a 2.2 (fases 2 e 4). Alertas de cronograma correspondem a 3.1 (fase 5). O caso 3.2 fica sujeito a avaliação na fase 6. O artigo de Obradović, Vukomanović e Todorović é referência para priorizar colaboração, comunicação, revisão humana e transparência. Trata-se de um estudo de percepção sobre competências, com 755 participantes, e suas conclusões não medem a eficácia dos recursos propostos para este produto.

### 4. Arquitetura para repositório novo

- Next.js com TypeScript, interface responsiva e um backend no mesmo projeto. PostgreSQL para dados e migrações. Use uma solução estabelecida de autenticação e mantenha o servidor como autoridade de acesso. Supabase Auth e Postgres são uma opção para acelerar a implantação.
- Organize o código por domínio: identidade e acesso, projetos e tarefas, agenda e notificações, assistente e relatórios. A interface, o assistente e as rotinas agendadas chamam os mesmos serviços de negócio, com contexto de autorização explícito.
- Use um agendador para lembretes e alertas, com persistência de execução no banco, deduplicação e retentativas limitadas. Considere indisponibilidade do processo, concorrência e fuso horário. Armazene horários absolutos em UTC e datas sem hora como datas de calendário.
- Use ambientes separados para teste e produção, migrações versionadas e configuração por variáveis de ambiente. Inclua .env.example, configuração mínima de execução e dados fictícios. Verifique a documentação oficial das dependências antes de fixar versões.
- Use os papéis administrador do espaço, gerente de projeto, membro e leitor. Centralize a política e valide papel, vínculo com o projeto e escopo do objeto em toda operação. Separe conversas privadas dos dados compartilhados. Teste acessos cruzados por ID, inclusive por buscas, notificações, relatórios e chamadas do assistente.

| Núcleo de dados | Campos e regras essenciais |
|---|---|
| Espaços e equipe | Usuários, membros, papéis, convites com validade, competências e capacidade disponível. |
| Projetos e planejamento | Projetos, membros do projeto, fases, marcos, tarefas, subtarefas, dependências, responsáveis, prioridades e estimativas. Tarefas pessoais têm proprietário e regras de visibilidade próprias. |
| Execução | Comentários, histórico de mudanças, registros de progresso, lembretes, notificações, alertas e execuções agendadas. |
| Assistente | Conversas por usuário e espaço, mensagens, propostas com validade, versão dos objetos afetados, chave de idempotência, estado da confirmação e métricas de uso. |

### 5. Assistente pessoal integrado

Implemente um chat dentro da aplicação com a OpenAI Responses API pelo servidor. Use um modelo GPT configurável e ferramentas com esquemas validados. As chaves ficam no ambiente do servidor. O histórico usado pelo assistente é o da plataforma e dos registros autorizados naquele espaço. Conversas e memórias da conta pessoal do ChatGPT ficam fora do escopo desta integração. O consumo da API tem faturamento separado da assinatura do ChatGPT.

**Ferramentas iniciais.** Consulte projetos, tarefas, agenda e bloqueios. Gere propostas estruturadas para criar tarefas, aplicar uma EAP, mudar estado, alterar prazo, registrar progresso ou cadastrar um lembrete. Cada ferramenta recebe contexto de usuário e espaço estabelecido pelo servidor. O texto enviado pelo modelo não define identidade nem permissões.

**Fluxo de ação.**

1. Identifique a intenção e resolva o item no escopo autorizado. Se houver mais de uma tarefa com o mesmo nome, peça ao usuário que escolha.
2. Para consultas, retorne fatos com links para registros, incluindo data da atualização quando relevante.
3. Para alterações, grave uma proposta temporária e mostre uma prévia editável com o antes e o depois. Permita confirmar ou cancelar.
4. No clique de confirmação, revalide acesso, validade, argumentos e versão do registro. Em caso de concorrência, devolva uma prévia atualizada. Execute em transação com deduplicação e histórico.
5. Mostre o resultado confirmado pelo servidor. Trate comentários, transcrições e conteúdo importado como dados não confiáveis. Restrições e permissões são aplicadas pelo servidor mesmo que esses textos tentem induzir chamadas.

| Mensagem de exemplo | Resultado esperado |
|---|---|
| “O que eu preciso fazer hoje?” | Lista por prioridade, com prazos e links para tarefas e compromissos. |
| “Planeje a migração do Joomla para WordPress.” | EAP em rascunho com fases, marcos, tarefas, dependências e premissas. Criação após revisão e confirmação. |
| “A migração de conteúdo chegou a 70%.” | Seleção da tarefa correta, prévia do progresso e registro de atividade após confirmação. |
| “Me lembre amanhã às 9h de revisar os acessos.” | Prévia com data absoluta e fuso local. Agendamento após confirmação. |
| “Qual projeto ficou parado?” | Projetos ativos com inatividade acima de um limite configurável. Exibir data da última atividade e o critério aplicado. |

Para indisponibilidade da API, mantenha todos os fluxos manuais acessíveis e apresente erro recuperável no chat. Limite tamanho das entradas, volume de consultas e rodadas de ferramenta. Registre latência, erros, tokens e uso por espaço sem inserir conteúdo pessoal nos logs operacionais. Documente o armazenamento, a exclusão do histórico e a configuração do envio de dados ao provedor. Na voz, mostre o estado de gravação, permita cancelamento e defina retenção curta do áudio bruto.

### 6. Regras para estimativas, alocação e risco

- **Estimativas.** Colete duração realizada e estimada. Compare tarefas concluídas do mesmo espaço, por tipo e complexidade. Informe intervalo, amostra e premissas. Mostre uma estimativa manual quando a base for insuficiente. A IA explica a faixa e ajuda a estruturar a tarefa.
- **Atribuição.** Ordene candidatos elegíveis por competências declaradas, disponibilidade e esforço comprometido no período. Mostre a justificativa e registre a escolha humana. Evite usar avaliações de clima como critério.
- **Risco.** Comece com regras observáveis: prazo próximo, bloqueios, dependências em atraso e diferença entre entrega planejada e realizada. Explique causa, impacto e possível ação. Ofereça probabilidade numérica apenas após validar um método com histórico suficiente e medir sua calibração.
- **Clima da equipe.** Trate como módulo opcional de piloto. Comece com check-ins voluntários, informação agregada e supressão de resultados para grupos pequenos. Qualquer análise de comentários precisa de decisão explícita sobre finalidade, transparência, retenção e acesso antes de ser ativada. O plano de entrega principal funciona com o módulo desativado.

### 7. Validação e entregáveis

- Entregue código executável, esquema e migrações, dados de demonstração, README, instruções de implantação e matriz de testes por fase.
- Teste autorização, dependências cíclicas, mudança simultânea de uma tarefa, confirmação duplicada, datas relativas e mudança de fuso, deduplicação de alertas e falhas da API.
- Rode testes ponta a ponta para criação manual, planejamento por IA, edição de rascunho, confirmação, colaboração, leitura sem permissão e lembrete. Use respostas controladas da IA nos testes automatizados e faça um teste real separado quando houver credenciais.
- No piloto, observe se usuários conseguem criar um projeto, encontrar o que vence hoje e revisar uma sugestão do assistente sem orientação. Registre onde precisam de ajuda e ajuste o fluxo.
- Na entrega de cada fase, reporte o que está utilizável, quais comandos foram executados, as evidências do fluxo e os bloqueios concretos. Um botão só está pronto quando o fluxo correspondente funciona com persistência e autorização.

### 8. Como iniciar no Claude Code

Coloque este arquivo e os dois PDFs na raiz do repositório ou em uma pasta de referências. Envie esta instrução:

> Leia o plano e os dois PDFs. Inspecione o repositório e siga as instruções locais. Implemente a fase 1 de ponta a ponta nesta sessão, com testes e instruções para rodar. Se a fase 1 já estiver pronta, verifique os critérios de saída e avance para a primeira fase incompleta. Registre o próximo passo e qualquer validação pendente. Comece executando as mudanças no código.

### Referências

- Casos_de_Uso_Gestao_Projetos_IA.pdf, módulos 1 a 3.
- Obradović, V., Vukomanović, M. e Todorović, M. (2026). *The future of Project Management: Insights from the next generation of professionals*. International Journal of Project Management, 44, 102848. [DOI](https://doi.org/10.1016/j.ijproman.2026.102848).
- OpenAI. [Function calling na Responses API](https://developers.openai.com/api/docs/guides/function-calling).
- OpenAI. [Faturamento do ChatGPT e da API](https://help.openai.com/pt-br/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform).
