-- Organograma da Terracap (intranet, versão de agosto/2026) e compartilhamento de projetos
-- para cima na hierarquia. Mudou o organograma: nova migração com INSERT/UPDATE, nunca editar esta.
-- A sigla é a chave; o espaço da lotação (workspaces.allotment, vindo do GIA) é o espaço oficial
-- da unidade (workspaces.org_unit).
CREATE TABLE org_units (
  sigla text PRIMARY KEY,
  label text NOT NULL DEFAULT '',
  parent text REFERENCES org_units(sigla)
);
INSERT INTO org_units(sigla, parent) VALUES
  ('PRESIDENCIA', NULL),
  ('GABIN', 'PRESIDENCIA'),
  ('ASSOC', 'GABIN'),
  ('COINT', 'PRESIDENCIA'),
  ('COTIN', 'COINT'),
  ('DIGTI', 'COTIN'),
  ('DISEG', 'COTIN'),
  ('DISID', 'COTIN'),
  ('DIRAU', 'COTIN'),
  ('CORED', 'COINT'),
  ('DICOP', 'COINT'),
  ('DIGER', 'COINT'),
  ('COINS', 'PRESIDENCIA'),
  ('ASCOM', 'PRESIDENCIA'),
  ('OUVIDORIA', 'PRESIDENCIA'),
  ('CPLAM', 'PRESIDENCIA'),
  ('DIMOG', 'CPLAM'),
  ('DIPLA', 'CPLAM'),
  ('DITEC', 'PRESIDENCIA'),
  ('ADTEC', 'DITEC'),
  ('GEMAM', 'DITEC'),
  ('NUAMB', 'GEMAM'),
  ('NULIC', 'GEMAM'),
  ('GEREN', 'DITEC'),
  ('NUENC', 'GEREN'),
  ('NUPOE', 'GEREN'),
  ('NUENE', 'GEREN'),
  ('GEPRO', 'DITEC'),
  ('NUARQ', 'GEPRO'),
  ('NUREG', 'GEPRO'),
  ('GEFIS', 'DITEC'),
  ('NUVIS', 'GEFIS'),
  ('NUFIS', 'GEFIS'),
  ('DIRAF', 'PRESIDENCIA'),
  ('ADRAF', 'DIRAF'),
  ('GECOP', 'DIRAF'),
  ('NUCCA', 'GECOP'),
  ('GEFIN', 'DIRAF'),
  ('NUGEF', 'GEFIN'),
  ('NUCOR', 'GEFIN'),
  ('GERAT', 'DIRAF'),
  ('NUMAT', 'GERAT'),
  ('NUPAT', 'GERAT'),
  ('NUDOC', 'GERAT'),
  ('NUGER', 'GERAT'),
  ('NUTAN', 'GERAT'),
  ('GEPES', 'DIRAF'),
  ('SESMT', 'GEPES'),
  ('NUDIV', 'GEPES'),
  ('NUBEN', 'GEPES'),
  ('GEPAG', 'DIRAF'),
  ('NUPAG', 'GEPAG'),
  ('NUCAF', 'GEPAG'),
  ('NUCAT', 'GEPAG'),
  ('GECOT', 'DIRAF'),
  ('NUREC', 'GECOT'),
  ('NUCOC', 'GECOT'),
  ('GEARI', 'DIRAF'),
  ('NUGRE', 'GEARI'),
  ('NUNEG', 'GEARI'),
  ('NUFID', 'GEARI'),
  ('NUAFI', 'GEARI'),
  ('GETRI', 'DIRAF'),
  ('NUTRI', 'GETRI'),
  ('NURFI', 'GETRI'),
  ('GECOE', 'DIRAF'),
  ('DIRES', 'PRESIDENCIA'),
  ('ADRES', 'DIRES'),
  ('COREG', 'DIRES'),
  ('GEDES', 'DIRES'),
  ('NUPRO', 'GEDES'),
  ('GEHAB', 'DIRES'),
  ('NUDOP', 'GEHAB'),
  ('DINEG', 'PRESIDENCIA'),
  ('ADNEG', 'DINEG'),
  ('GENEG', 'DINEG'),
  ('GEFOR', 'DINEG'),
  ('DIJUR', 'PRESIDENCIA'),
  ('COJUR', 'DIJUR'),
  ('CESUT', 'COJUR'),
  ('SEACO', 'COJUR'),
  ('NUDAP', 'SEACO'),
  ('DICOM', 'PRESIDENCIA'),
  ('CORUR', 'DICOM'),
  ('ADCOM', 'DICOM'),
  ('COVED', 'DICOM'),
  ('COPLI', 'DICOM'),
  ('GEATE', 'DICOM'),
  ('GETOP', 'DICOM'),
  ('NUGET', 'GETOP'),
  ('NUANF', 'GETOP'),
  ('GECOM', 'DICOM'),
  ('NUCAD', 'GECOM'),
  ('NUCOM', 'GECOM'),
  ('NUGEC', 'GECOM'),
  ('GEPEA', 'DICOM'),
  ('NUPEA', 'GEPEA'),
  ('GEVED', 'DICOM'),
  ('GEREF', 'DICOM');
UPDATE org_units SET label = sigla;
UPDATE org_units SET label = 'PRESIDÊNCIA' WHERE sigla = 'PRESIDENCIA';

-- Uma unidade tem no máximo um espaço oficial.
ALTER TABLE workspaces ADD COLUMN org_unit text REFERENCES org_units(sigla);
CREATE UNIQUE INDEX workspaces_org_unit_uq ON workspaces(org_unit) WHERE org_unit IS NOT NULL;

-- Lotação -> sigla, tolerante ao formato do GIA: a própria sigla, a última parte de um caminho
-- (COINT/COTIN/DISID) ou a primeira palavra ("DISID - Divisão..."). Mesma regra de identity/org.py.
CREATE FUNCTION projeta_unit_for_allotment(a text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT u.sigla FROM org_units u, (VALUES
      (1, translate(upper(btrim(a)), 'ÊÉÁÍÓÚÂÔÃÕÇ', 'EEAIOUAOAOC')),
      (2, upper(btrim(regexp_replace(btrim(a), '^.*[/\\>]', '')))),
      (3, upper(split_part(btrim(a), ' ', 1)))) AS c(ord, v)
  WHERE u.sigla = c.v ORDER BY c.ord LIMIT 1
$$;
UPDATE workspaces w SET org_unit = x.sigla
FROM (SELECT DISTINCT ON (projeta_unit_for_allotment(allotment)) id,
        projeta_unit_for_allotment(allotment) AS sigla
      FROM workspaces WHERE allotment IS NOT NULL AND projeta_unit_for_allotment(allotment) IS NOT NULL
      ORDER BY projeta_unit_for_allotment(allotment), created_at) x
WHERE w.id = x.id;

-- Projeto visível à unidade `unit` (só leitura). `from_unit` é quem repassou: o dono do projeto
-- compartilha com a unidade acima; cada nível decide se repassa ao seguinte.
CREATE TABLE project_shares (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  unit text NOT NULL REFERENCES org_units(sigla),
  from_unit text NOT NULL REFERENCES org_units(sigla),
  shared_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, unit),
  CHECK (unit <> from_unit)
);
CREATE INDEX project_shares_unit_idx ON project_shares(unit);

-- Nova permissão da matriz: ver os projetos compartilhados pelas unidades abaixo.
-- Padrão: Gerente de projeto vê (o Gestor sempre vê).
UPDATE workspaces SET permissions = jsonb_set(permissions, '{manager}',
  COALESCE(permissions->'manager', '[]'::jsonb) || '["org.view_shared"]'::jsonb)
WHERE NOT COALESCE(permissions->'manager', '[]'::jsonb) @> '"org.view_shared"'::jsonb;
ALTER TABLE workspaces ALTER COLUMN permissions SET DEFAULT
  '{"manager": ["project.create", "project.manage", "task.write", "comment.write", "org.view_shared"],
    "member": ["task.write", "comment.write"],
    "viewer": []}'::jsonb;
