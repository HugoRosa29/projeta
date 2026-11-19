-- Imagem de capa do projeto (uma por projeto). Guardada no banco para o acesso seguir a mesma
-- regra do projeto; o conteúdo é validado no servidor (PNG, JPEG ou WebP) antes de entrar aqui.
CREATE TABLE project_covers (
  project_id   uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  content_type text        NOT NULL CHECK (content_type IN ('image/png','image/jpeg','image/webp')),
  data         bytea       NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
