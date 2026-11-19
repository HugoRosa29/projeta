# ADR 0003 — Permissões por perfil, configuráveis pelo Gestor do espaço

- **Estado:** proposto (rascunho de agente; falta uma pessoa aceitar ou recusar)
- **Contexto de origem:** pedido para compartilhar o espaço de equipe e deixar o Gestor definir quem pode fazer o quê

## Contexto

Até aqui, cada um dos quatro papéis do espaço (`admin`, `manager`, `member`, `viewer`) tinha um conjunto fixo de ações em `identity/policy.py`. Quem administrava o espaço só podia trocar o papel das pessoas, sem mudar o que cada papel pode fazer. Também não dava para, por exemplo, deixar o Leitor comentar sem deixá-lo editar tarefas.

## Decisão proposta

1. O papel `admin` passa a se chamar **Gestor** na interface e pode tudo, sempre. Ele não aparece na matriz e não pode ser limitado.
2. Cada espaço guarda em `workspaces.permissions` (migração 015) um JSON `{perfil: [ações]}` para `manager`, `member` e `viewer`. O padrão reproduz o comportamento anterior, então espaços existentes não mudam até o Gestor editar a matriz.
3. As ações configuráveis estão em `policy.PERMISSIONS`:
   - `project.view_all`: ver todos os projetos do espaço, só para leitura;
   - `project.create`;
   - `project.manage`;
   - `task.write`;
   - `comment.write`, que passa a ser separada de `task.write`;
   - `workspace.invite`.
4. Duas ações ficam fora da matriz: ler, que todo membro pode, e gerir o espaço (nome, papéis, matriz), que só o Gestor pode.
5. Escrever e gerir continuam exigindo vínculo com o projeto. `project.view_all` só amplia a leitura.
6. Quem convida sem ser Gestor só concede perfil igual ou abaixo do seu, nunca o de Gestor. Essa pessoa vê e revoga apenas os próprios convites.
7. O servidor aplica tudo: `policy.Member.can`, `access.membership`/`project_access` e o fragmento SQL `VISIBLE_PROJECT`. A interface recebe `workspace.permissions` só para esconder opções.

## Consequências

- O assistente herda a matriz, porque chama os mesmos serviços. A ferramenta de detalhes da tarefa ainda informa só `pode_editar`, não "pode comentar". Mudar isso é alteração em `assistant/tools.py` e cabe a uma pessoa.
- `VISIBLE_PROJECT` duplica em SQL a regra de `project.view_all`. Os testes de `test_permissions.py` cobrem as duas partes.
- Não há histórico de alterações da matriz (`set_member_role` também não registra). Se for preciso auditar, isso fica para um próximo passo.

## Alternativas descartadas

- Perfis personalizados com nome livre: mais flexíveis, mas exigem cadastro, migração de papéis e mais telas. A matriz cobre o pedido com os quatro perfis atuais.
- Manter os papéis fixos e só ajustar o código: não atende "o Gestor define quem pode fazer o quê".
