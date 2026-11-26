-- Propostas genéricas do assistente: um plano de ações que chama os mesmos serviços da interface.
ALTER TABLE assistant_proposals DROP CONSTRAINT IF EXISTS assistant_proposals_kind_check;
ALTER TABLE assistant_proposals
  ADD CONSTRAINT assistant_proposals_kind_check
  CHECK (kind IN ('create_tasks','apply_wbs','update_task','status_note','add_comment','actions'));
