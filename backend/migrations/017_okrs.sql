-- OKRs do espaço: objetivo (qualitativo, por trimestre) -> resultados-chave (mensuráveis, com
-- dono) -> check-ins (histórico de valor, confiança e nota). Ver work/okrs.py e ADR 0005.
CREATE TABLE objectives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- Trimestre no formato AAAA-Tn (ex.: 2026-T4).
  period text NOT NULL CHECK (period ~ '^[0-9]{4}-T[1-4]$'),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  owner_id uuid REFERENCES users(id) ON DELETE SET NULL,
  position int NOT NULL DEFAULT 0,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX objectives_ws_period_idx ON objectives(workspace_id, period);

CREATE TABLE key_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  objective_id uuid NOT NULL REFERENCES objectives(id) ON DELETE CASCADE,
  title text NOT NULL,
  owner_id uuid REFERENCES users(id) ON DELETE SET NULL,
  -- number: valor de partida -> meta; project: progresso vem do projeto vinculado.
  kind text NOT NULL DEFAULT 'number' CHECK (kind IN ('number', 'project')),
  start_value numeric NOT NULL DEFAULT 0,
  target_value numeric NOT NULL DEFAULT 100,
  current_value numeric NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT '',
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  confidence text NOT NULL DEFAULT 'on_track'
    CHECK (confidence IN ('on_track', 'at_risk', 'off_track')),
  last_checkin_at timestamptz,
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX key_results_objective_idx ON key_results(objective_id);
CREATE INDEX key_results_owner_idx ON key_results(owner_id);

CREATE TABLE okr_checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key_result_id uuid NOT NULL REFERENCES key_results(id) ON DELETE CASCADE,
  author_id uuid REFERENCES users(id) ON DELETE SET NULL,
  value numeric NOT NULL,
  -- Progresso (0-100) no momento do check-in: o histórico não muda se a meta for editada depois.
  progress int NOT NULL CHECK (progress BETWEEN 0 AND 100),
  confidence text NOT NULL CHECK (confidence IN ('on_track', 'at_risk', 'off_track')),
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX okr_checkins_kr_idx ON okr_checkins(key_result_id, created_at DESC);

-- Nova permissão da matriz: criar e editar objetivos e resultados-chave.
-- Padrão: Gerente de projeto (o Gestor sempre pode). O check-in é do dono do KR, sem permissão extra.
UPDATE workspaces SET permissions = jsonb_set(permissions, '{manager}',
  COALESCE(permissions->'manager', '[]'::jsonb) || '["okr.manage"]'::jsonb)
WHERE NOT COALESCE(permissions->'manager', '[]'::jsonb) @> '"okr.manage"'::jsonb;
ALTER TABLE workspaces ALTER COLUMN permissions SET DEFAULT
  '{"manager": ["project.create", "project.manage", "task.write", "comment.write", "org.view_shared", "okr.manage"],
    "member": ["task.write", "comment.write"],
    "viewer": []}'::jsonb;
