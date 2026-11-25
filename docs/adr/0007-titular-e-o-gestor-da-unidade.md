# ADR 0007 — O titular da unidade é o Gestor do espaço dela

- **Estado:** proposto (rascunho de agente; falta uma pessoa aceitar ou recusar)
- **Contexto de origem:** pedido para que os responsáveis de cada setor sejam os da planilha "Responsáveis pelas Unidades orgânicas da TERRACAP" (novembro/2026).
- **Substitui:** o item 3 do [ADR 0004](0004-organizacao-e-compartilhamento.md) ("o primeiro lotado a entrar vira Gestor") nas unidades que têm titular.

## Contexto

Pelo ADR 0004, quem entrasse primeiro pelo GIA numa lotação virava Gestor do espaço da unidade. Isso dá a gestão a quem chega antes, não a quem responde pela unidade. A Terracap mantém a lista oficial de titulares de cada unidade orgânica.

## Decisão proposta

1. **Os titulares são dado versionado.** A tabela `org_unit_heads(sigla, name)` vem da migração 019, transcrita da planilha. Só o nome entra: o e-mail e o telefone da planilha são das caixas das unidades. Trocou o titular, entra uma nova migração.
2. **O titular é o Gestor do espaço oficial da unidade**, inclusive de unidades fora da própria lotação (a mesma pessoa responde pela GEPES e pelo SESMT, pela GECOT e pelo NUREC). Ele assume ao entrar pelo GIA, ou quando o espaço da unidade é criado depois da entrada dele.
3. **Nas unidades com titular, ninguém mais vira Gestor automaticamente.** Os lotados entram como Gerente de projeto. Espaços sem titular cadastrado mantêm a regra do ADR 0004.
4. **A identificação é pelo nome que o GIA devolve**, comparado sem acento, sem pontuação e sem diferença de caixa ou espaços. Só contas do GIA (com matrícula) entram na comparação: numa conta local o nome é digitado por quem se cadastra, então ela nunca vira Gestor por nome.
5. **A planilha manda.** Se outro Gestor rebaixar o titular, ele volta a Gestor na próxima entrada.

## Consequências

- Quem já é Gestor por ter entrado primeiro não é rebaixado: a migração só promove os titulares que já têm conta.
- Enquanto o titular não entra, a unidade fica sem Gestor no espaço; ninguém compartilha projetos para cima nem edita a matriz de permissões dela.
- Se o nome no GIA diferir do da planilha (um sobrenome a mais ou a menos), o titular não é reconhecido. Corrige-se com uma migração que ajusta o nome. Uma alternativa mais firme é guardar a matrícula do titular, que a planilha não traz.
- Duas unidades da planilha faltavam no organograma e entraram: **COINC** sob a DICOM (resolve a dúvida COINC × CORUR do ADR 0004; CORUR fica, sem titular, até se confirmar que deixou de existir) e **CPLIC** sob a GECOP, pela posição na planilha. A posição da CPLIC precisa ser confirmada.

## Alternativas descartadas

- Casar pelo e-mail da planilha: são caixas das unidades (`cotin@...`), repetidas entre unidades, e não o e-mail da pessoa no GIA.
- Manter o primeiro lotado como Gestor até o titular chegar: dá a gestão provisória a quem não responde pela unidade, e ela continuaria depois.
