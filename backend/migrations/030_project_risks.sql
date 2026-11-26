-- Registro de riscos do projeto, no formato do PMBOK: identificar (causa → evento → efeito e
-- categoria da EAR de riscos), analisar (probabilidade × impacto, escala 1–5), planejar a resposta
-- (estratégia, plano, contingência, gatilho, responsável, prazo) e monitorar (situação e revisão).
CREATE TABLE project_risks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- Código do risco no projeto (R-01, R-02…). Não é reaproveitado depois de uma exclusão: "R-03"
  -- continua sendo o mesmo risco nas atas e relatórios.
  number int NOT NULL CHECK (number > 0),
  kind text NOT NULL DEFAULT 'threat' CHECK (kind IN ('threat', 'opportunity')),
  title text NOT NULL,
  cause text NOT NULL DEFAULT '',
  effect text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'technical'
    CHECK (category IN ('technical', 'management', 'commercial', 'external')),
  probability smallint NOT NULL CHECK (probability BETWEEN 1 AND 5),
  impact smallint NOT NULL CHECK (impact BETWEEN 1 AND 5),
  score smallint GENERATED ALWAYS AS (probability * impact) STORED,
  -- Objetivos do projeto afetados: prazo, custo, escopo, qualidade.
  affects text[] NOT NULL DEFAULT '{}',
  strategy text CHECK (strategy IN (
    'escalate', 'avoid', 'transfer', 'mitigate', 'exploit', 'share', 'enhance', 'accept')),
  response text NOT NULL DEFAULT '',
  contingency text NOT NULL DEFAULT '',
  trigger_signal text NOT NULL DEFAULT '',
  owner_id uuid REFERENCES users(id) ON DELETE SET NULL,
  response_due date,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'responding', 'occurred', 'closed')),
  -- Última vez que alguém reavaliou o risco (probabilidade, impacto, situação ou "revisado").
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  version int NOT NULL DEFAULT 1,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, number)
);

-- Último código de risco usado no projeto. Contador próprio (e não max(number)) para que excluir
-- o risco mais recente não faça o próximo herdar o código dele.
ALTER TABLE projects ADD COLUMN last_risk_number int NOT NULL DEFAULT 0;
