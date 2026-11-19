-- Modo "projeto formal" (opcional): fase, abordagem, processo SEI, funções por projeto,
-- notas semanais de acompanhamento, termos de abertura/encerramento e convite por matrícula.
-- `phase` nulo = projeto comum, fora do modo formal.
ALTER TABLE projects
  ADD COLUMN phase text CHECK (phase IN ('initiation','planning','execution','monitoring','closing')),
  ADD COLUMN approach text CHECK (approach IN ('agile','waterfall')),
  ADD COLUMN sei_process text;

-- Funções no projeto (GP, PO, AN, AS, EX, SE, QA, EI). Uma pessoa pode acumular funções;
-- a segregação (QA/SE x EX/AS) é validada no serviço.
ALTER TABLE project_members
  ADD COLUMN roles text[] NOT NULL DEFAULT '{}'
  CHECK (roles <@ ARRAY['gp','po','an','as','ex','se','qa','ei']::text[]);

CREATE TABLE project_status_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users(id),
  state text NOT NULL CHECK (state IN ('on_track','at_risk','late')),
  delay_reason text NOT NULL DEFAULT '',
  done text NOT NULL DEFAULT '',
  pending text NOT NULL DEFAULT '',
  blockers text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX project_status_notes_idx ON project_status_notes(project_id, created_at DESC);

CREATE TABLE project_terms (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('tap','tep')),
  content jsonb NOT NULL DEFAULT '{}',
  version int NOT NULL DEFAULT 1,
  updated_by uuid NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, kind)
);

-- Convite por matrícula: a identidade é a do GIA, então basta a matrícula. Quem ainda não
-- entrou no PROJETA é vinculado no primeiro login; quem já entrou é vinculado na hora.
CREATE TABLE project_invites (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  matricula text NOT NULL,
  invited_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, matricula)
);
CREATE INDEX project_invites_matricula_idx ON project_invites(matricula);
