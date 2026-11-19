-- O assistente passa a propor a nota semanal de acompanhamento (projeto formal).
ALTER TABLE assistant_proposals DROP CONSTRAINT IF EXISTS assistant_proposals_kind_check;
ALTER TABLE assistant_proposals
  ADD CONSTRAINT assistant_proposals_kind_check
  CHECK (kind IN ('create_tasks','apply_wbs','update_task','status_note'));
