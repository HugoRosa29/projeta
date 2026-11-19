-- Comentários na tarefa (equivalente às notas do Redmine e aos comentários do Jira).
-- O texto é dado do usuário: nunca vai para logs operacionais nem vira instrução do assistente.
CREATE TABLE task_comments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id    uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id  uuid NOT NULL REFERENCES users(id),
  body       text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000),
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at  timestamptz
);
CREATE INDEX task_comments_task_idx ON task_comments(task_id, created_at);
