# ADR 0004 — Organização pelo organograma e compartilhamento de projetos para cima

- **Estado:** proposto (rascunho de agente; falta uma pessoa aceitar ou recusar)
- **Contexto de origem:** pedido para a COTIN acompanhar o andamento de DISID, DIRAU etc.

## Contexto

Cada espaço era isolado: nenhuma unidade via projetos de outra. A Terracap tem um organograma oficial ([intranet](https://intranet.terracap.df.gov.br/organograma-da-terracap/), versão de agosto/2026), e o GIA informa a lotação de cada pessoa no login. O login pelo GIA já cria um espaço por lotação.

## Decisão proposta

1. **O organograma é dado versionado.** A tabela `org_units(sigla, parent)` vem da migração 016, transcrita das imagens da intranet. Quando o organograma mudar, entra uma nova migração; esta não se edita.
2. **O espaço oficial de uma unidade é o da lotação.** O vínculo `workspaces.org_unit` sai da lotação do GIA, comparada de forma tolerante: a sigla inteira, a última parte de um caminho (`COINT/COTIN/DISID`) ou a primeira palavra. Ninguém declara a própria unidade, então não dá para se passar pela COTIN. Cada unidade tem no máximo um espaço oficial, e espaços de equipe comuns ficam fora da organização.
3. **O primeiro lotado a entrar vira Gestor** do espaço da unidade. Isso também vale para espaços de lotação que já existem sem Gestor: quem entrar primeiro depois da implantação assume. Até aqui a regra era o contrário ("não é de quem chegou primeiro").
4. **O compartilhamento sobe um nível por vez.** O Gestor do espaço dono compartilha um projeto com a unidade imediatamente acima (DISID → COTIN). O Gestor da unidade que recebeu decide se repassa ao nível seguinte (COTIN → COINT). Recolher num nível recolhe também tudo o que foi repassado acima dele. Também há a ação "compartilhar todos", que não vale para projetos criados depois.
5. **O que a unidade que recebeu vê é só leitura.** Ela vê o projeto inteiro (ficha, fase, notas, TAP/TEP, tarefas, comentários), mas não escreve, não comenta e não gere.
6. **Quem vê na unidade que recebeu** é o Gestor e os perfis com a nova permissão `org.view_shared`. O padrão inclui o Gerente de projeto, e o Gestor ajusta pela matriz (ADR 0003).
7. **O servidor aplica as regras:** o fragmento `VISIBLE_PROJECT` ganhou a via `project_shares`, e `project_access` devolve acesso só de leitura a quem não é membro do espaço dono.

## Consequências

- A lista de projetos e o portfólio da unidade mostram os recebidos com o selo "de DISID".
- O assistente da unidade que recebeu não lista os recebidos nas consultas por espaço, porque as ferramentas filtram por `p.workspace_id`. Ajustar isso é mudança em `assistant/tools.py`, que cabe a uma pessoa decidir.
- O formato da lotação em produção não foi confirmado. Se o GIA devolver algo que não bate com nenhuma sigla, o espaço fica fora da organização. Corrige-se com uma migração que preenche `org_unit`.
- As imagens da intranet divergem em um ponto: o organograma geral de agosto/2026 mostra **CORUR** sob a DICOM, e o da DICOM de julho/2026 mostra **COINC**. Foi usado CORUR (o mais recente). É preciso confirmar.
- Para importar DISID e DIRAU (exportação de espaço) no espaço oficial da unidade, quem importa precisa ser o Gestor dele.

## Alternativas descartadas

- Espaço vê automaticamente tudo dos espaços abaixo: tira da unidade a escolha do que sai.
- Qualquer Gestor vincula o próprio espaço a uma unidade: permitiria contornar a matriz do espaço oficial ou se passar por outra unidade.
- Compartilhamento solto entre quaisquer espaços: não dá a visão consolidada pelo organograma.
