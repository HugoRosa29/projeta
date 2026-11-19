# ADR 0002 — Campos livres do projeto para o portfólio

- **Estado:** proposto (rascunho de agente; falta uma pessoa aceitar ou recusar)
- **Contexto de origem:** importação do portfólio do Redmine (DISID) e do Jira (DIRAU)

## Contexto

O Redmine guardava, por projeto, campos personalizados como Complexidade, Alerta de risco, PDTI, Executado por, Estimativa de custo e datas de início e previsão. O Jira tem outros. Cada área usa um conjunto próprio, e ele muda com o tempo. A pessoa pediu campos "simples e não engessados".

## Decisão proposta

1. `projects.attributes` é uma lista JSON de `{name, value}`, com os dois valores em texto (migração 012). A ordem é a definida por quem edita.
2. Não há cadastro de tipos de campo. Os nomes e valores já usados em projetos visíveis do espaço aparecem como sugestão no formulário e alimentam o filtro do portfólio.
3. O serviço valida: até 20 campos, nome com até 40 caracteres, valor com até 200, sem nome repetido (sem diferenciar maiúsculas). Uma linha totalmente vazia é ignorada.
4. Quem edita os campos é quem já pode editar o projeto (`project.manage`). Quem lê os campos é quem já enxerga o projeto.

## Consequências

- Não há validação de tipo: um campo de data ou de valor é texto, e o filtro compara o texto exato.
- Grafias diferentes ("Alta" e "alta") viram valores diferentes. As sugestões reduzem isso, mas não o impedem.
- Se um dia for preciso somar ou ordenar por valor (ex.: custo), será necessário um campo tipado ou um relatório próprio.

## Alternativas descartadas

- Colunas fixas para os campos do Redmine: engessaria o modelo para outras áreas.
- Cadastro de campos personalizados por espaço (tipo, opções, obrigatoriedade): mais completo, porém mais pesado de configurar e manter, que é justamente o que se quis evitar.
