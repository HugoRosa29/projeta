-- Metadados de mensagem do assistente: candidatos para desambiguação e ação pendente.
ALTER TABLE assistant_messages ADD COLUMN meta jsonb NOT NULL DEFAULT '{}';
CREATE INDEX assistant_usage_user_idx ON assistant_usage(user_id, created_at DESC);
