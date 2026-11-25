-- Quem já tem conta passa a estar no espaço oficial da unidade da própria lotação.
--
-- O vínculo só acontecia no login pelo GIA e comparava o texto inteiro da lotação. Assim,
-- "DIRAU - DIRAU - DIVISÃO DE ..." caía num espaço próprio, fora do organograma, e não no
-- espaço oficial da DIRAU. Agora vale só a sigla (ver `_join_allotment_workspace`). Esta
-- migração aplica a regra a quem já entrou, sem esperar o próximo login.
--
-- Só vincula a espaços oficiais que já existem. Os espaços comuns criados pela regra antiga
-- ficam como estão: podem ter projetos, e juntar espaços é decisão de pessoas.

-- Lotados entram como Gerente de projeto; quem já é membro mantém o papel que tem.
INSERT INTO workspace_members(workspace_id, user_id, role)
SELECT w.id, u.id, 'manager'
FROM users u
JOIN workspaces w ON w.org_unit = projeta_unit_for_allotment(u.allotment)
WHERE u.allotment IS NOT NULL
ON CONFLICT (workspace_id, user_id) DO NOTHING;

-- Titular da planilha é o Gestor do espaço oficial da unidade (ADR 0007), mesma regra de
-- `_seat_unit_heads`: só contas com matrícula, comparando o nome vindo do GIA.
INSERT INTO workspace_members(workspace_id, user_id, role)
SELECT w.id, u.id, 'admin'
FROM org_unit_heads h
JOIN workspaces w ON w.org_unit = h.sigla
JOIN users u ON u.matricula IS NOT NULL AND projeta_name_key(u.name) = projeta_name_key(h.name)
ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = 'admin';
