-- Titular com conta passa a ter o espaço oficial da unidade que chefia, mesmo que ninguém
-- lotado nela tenha entrado ainda.
--
-- A 023 só vinculava a espaços oficiais existentes. Unidade sem espaço oficial deixava o
-- titular sem espaço: o perfil mostrava "Titular de DIRAU", mas não havia espaço da DIRAU.
-- O login agora cria o espaço (`_seat_unit_heads`); esta migração faz o mesmo para quem já
-- tem conta, sem esperar o próximo login.

-- 1. Espaço comum de antes do organograma cuja lotação tem a sigla vira o oficial, se a
--    unidade ainda não tiver um (mesma regra da 016: o mais antigo).
UPDATE workspaces w SET org_unit = x.sigla
FROM (SELECT DISTINCT ON (projeta_unit_for_allotment(allotment)) id,
        projeta_unit_for_allotment(allotment) AS sigla
      FROM workspaces
      WHERE kind = 'team' AND org_unit IS NULL AND allotment IS NOT NULL
        AND projeta_unit_for_allotment(allotment) IS NOT NULL
      ORDER BY projeta_unit_for_allotment(allotment), created_at) x
WHERE w.id = x.id
  AND NOT EXISTS (SELECT 1 FROM workspaces o WHERE o.org_unit = x.sigla);

-- 2. Unidade com titular cadastrado e ainda sem espaço oficial: cria o espaço.
INSERT INTO workspaces(name, kind, created_by, org_unit)
SELECT DISTINCT ON (ou.sigla) ou.label, 'team', u.id, ou.sigla
FROM org_unit_heads h
JOIN org_units ou ON ou.sigla = h.sigla
JOIN users u ON u.matricula IS NOT NULL AND projeta_name_key(u.name) = projeta_name_key(h.name)
WHERE NOT EXISTS (SELECT 1 FROM workspaces w WHERE w.org_unit = h.sigla)
ORDER BY ou.sigla, u.created_at
ON CONFLICT DO NOTHING;

-- 3. Mesmo vínculo da 023, agora que há mais espaços oficiais.
INSERT INTO workspace_members(workspace_id, user_id, role)
SELECT w.id, u.id, 'manager'
FROM users u
JOIN workspaces w ON w.org_unit = projeta_unit_for_allotment(u.allotment)
WHERE u.allotment IS NOT NULL
ON CONFLICT (workspace_id, user_id) DO NOTHING;

INSERT INTO workspace_members(workspace_id, user_id, role)
SELECT w.id, u.id, 'admin'
FROM org_unit_heads h
JOIN workspaces w ON w.org_unit = h.sigla
JOIN users u ON u.matricula IS NOT NULL AND projeta_name_key(u.name) = projeta_name_key(h.name)
ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = 'admin';
