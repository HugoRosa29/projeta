-- Campos livres do projeto para o portfólio (ex.: Complexidade, PDTI, Custo estimado).
-- Lista de {name, value} definida por quem usa, sem cadastro prévio de tipos; ver ADR 0002.
ALTER TABLE projects
  ADD COLUMN attributes jsonb NOT NULL DEFAULT '[]'
  CHECK (jsonb_typeof(attributes) = 'array');
