-- Entrada local (e-mail e senha) convivendo com o GIA. Quem entra pelo GIA continua sem senha
-- local (password_hash NULL) e não consegue usar a entrada local; quem se cadastra por e-mail
-- não tem matrícula. Toda conta precisa de ao menos uma das duas identidades.
ALTER TABLE users ADD COLUMN password_hash text;
ALTER TABLE users ADD CONSTRAINT users_identity_ck
  CHECK (matricula IS NOT NULL OR password_hash IS NOT NULL);
