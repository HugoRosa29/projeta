# ADR 0008 — Compartilhamento direto com qualquer setor

- **Estado:** proposto (rascunho de agente; falta uma pessoa aceitar ou recusar)
- **Contexto de origem:** pedido para compartilhar projetos com setores que não estão na mesma linha hierárquica.
- **Revê:** a alternativa "compartilhamento solto" que o [ADR 0004](0004-organizacao-e-compartilhamento.md) tinha descartado, agora restrita a unidades do organograma.

## Contexto

Pelo ADR 0004, um projeto só sobe um nível por vez (DISID → COTIN → COINT). Projetos que envolvem outra diretoria (DISID com a GEPES, por exemplo) não tinham como ser mostrados a ela.

## Decisão proposta

1. **Dois caminhos de compartilhamento.** `project_shares.kind` vale `up` (o de sempre) ou `direct` (o novo). A chave passa a ser `(project_id, unit, kind)`: os dois caminhos coexistem para a mesma unidade e cada um se desfaz sem mexer no outro.
2. **Só o Gestor do espaço dono compartilha direto**, só projetos do próprio espaço e só com unidades do organograma (migração 016 e seguintes), menos a própria e a imediatamente acima, que já tem o caminho normal.
3. **O direto não se repassa.** Quem recebeu direto não compartilha para cima nem com mais ninguém: só o dono decide quem vê. Pelo caminho `up` o repasse continua como no ADR 0004.
4. **O que se vê não muda:** leitura do projeto inteiro, para o Gestor da unidade que recebeu e para os perfis com `org.view_shared`.

## Consequências

- Recolher um repasse pela hierarquia não apaga um compartilhamento direto com a mesma unidade, e vice-versa.
- Espaços fora do organograma (equipes comuns) continuam sem compartilhar.
- Pode-se compartilhar com uma unidade que ainda não tem espaço. Ela passa a ver quando alguém lotado lá entrar.
- Os setores aparecem pela sigla. Os nomes por extenso (que estão na planilha de titulares) entrariam pelo `org_units.label`.

## Alternativas descartadas

- Deixar quem recebeu direto repassar: o projeto se espalharia sem o dono saber.
- Compartilhar com qualquer espaço, não só unidades: permitiria mandar dados para equipes informais sem Gestor responsável no organograma.
