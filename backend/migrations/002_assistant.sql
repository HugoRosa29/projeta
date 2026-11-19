-- Etapa 2: assistente (conversas privadas por usuário + propostas com confirmação)
CREATE TABLE assistant_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assistant_conv_user_idx ON assistant_conversations(user_id, workspace_id, updated_at DESC);

CREATE TABLE assistant_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant')),
  content text NOT NULL,
  links jsonb NOT NULL DEFAULT '[]',
  proposal_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assistant_msg_conv_idx ON assistant_messages(conversation_id, created_at);

CREATE TABLE assistant_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('create_tasks','apply_wbs','update_task')),
  payload jsonb NOT NULL,
  base_versions jsonb NOT NULL DEFAULT '{}',   -- task_id -> version vista na proposta
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','cancelled','expired','failed')),
  idempotency_key text NOT NULL UNIQUE,         -- chave da execução: uma proposta grava no máximo uma vez
  result jsonb,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);

CREATE TABLE assistant_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  latency_ms int NOT NULL,
  input_tokens int NOT NULL DEFAULT 0,
  output_tokens int NOT NULL DEFAULT 0,
  tool_rounds int NOT NULL DEFAULT 0,
  ok boolean NOT NULL,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);
