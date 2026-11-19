-- Autenticação 100% pelo GIA: a identidade é a matrícula e a senha vive só no GIA.
ALTER TABLE users DROP COLUMN password_hash;
ALTER TABLE users
  ADD COLUMN matricula text UNIQUE,
  ADD COLUMN gia_code text,
  ADD COLUMN allotment text;

-- Cada lotação tem um espaço de equipe comum; a unicidade ignora caixa para que
-- "TI" e "ti" caiam no mesmo espaço.
ALTER TABLE workspaces ADD COLUMN allotment text;
CREATE UNIQUE INDEX workspaces_allotment_uq ON workspaces (lower(allotment))
  WHERE allotment IS NOT NULL;
