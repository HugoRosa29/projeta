# ADR 0009 — OKRs sobem pelo organograma como os projetos

- **Estado:** proposto (rascunho de agente; falta uma pessoa aceitar ou recusar)
- **Contexto de origem:** pedido para que os OKRs também sejam compartilhados com o setor acima, assim como os projetos.
- **Revê:** a consequência do [ADR 0005](0005-okrs-e-telas-por-papel.md) "os OKRs são por espaço e não sobem pelo organograma".

## Contexto

Pelo [ADR 0004](0004-organizacao-e-compartilhamento.md), a COTIN acompanha os projetos que DISID e DIRAU compartilham com ela. Os OKRs ficavam presos ao espaço, então a COTIN via as entregas, mas não as metas das unidades abaixo.

## Decisão proposta

1. **A unidade de compartilhamento é o objetivo**, com todos os resultados-chave dele. Não há compartilhamento de KR avulso. A tabela é `objective_shares` (migração 026), igual a `project_shares`.
2. **Mesma regra dos projetos:** o Gestor do espaço dono compartilha com a unidade imediatamente acima. O Gestor de quem recebeu decide se repassa ao nível seguinte. Recolher num nível recolhe também tudo o que foi repassado acima dele. Por padrão, nada sobe.
3. **Quem vê na unidade que recebeu** é o Gestor e os perfis com `org.view_shared`, a mesma permissão dos projetos.
4. **Só leitura.** Em Metas, os recebidos aparecem numa seção própria, com o selo "de DISID": objetivos, KRs, progresso, confiança e histórico de check-ins. Quem recebeu não cria, edita, remove nem faz check-in. O resumo do painel conta só os OKRs do próprio espaço.
5. **Projeto vinculado a um KR:** o KR recebido mostra o progresso, mas o nome e o link do projeto só aparecem se quem lê também enxerga o projeto, como já acontece dentro do espaço.

## Consequências

- O compartilhamento é gerenciado em Configurações → Organização, num desenho do organograma: clicar num setor mostra o que ele vê (projetos e objetivos para a unidade acima, com o repasse do que foi recebido; projetos para os demais setores). O botão "Compartilhar" no próprio projeto ou objetivo é um atalho para o mesmo.
- Não há "compartilhar todos" nem compartilhamento direto (ADR 0008) para OKRs. Se fizer falta, a decisão é nova.
- O alinhamento entre níveis (objetivo-pai, com o progresso da COTIN calculado a partir de DISID) continua fora: a COTIN só lê.
