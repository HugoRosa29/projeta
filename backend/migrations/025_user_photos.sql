-- Foto de perfil (uma por pessoa). Fica no banco, como a capa de projeto (007), para o acesso
-- seguir a regra do servidor; o conteúdo é validado (PNG, JPEG ou WebP) antes de entrar aqui.
CREATE TABLE user_photos (
  user_id      uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  content_type text        NOT NULL CHECK (content_type IN ('image/png','image/jpeg','image/webp')),
  data         bytea       NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
