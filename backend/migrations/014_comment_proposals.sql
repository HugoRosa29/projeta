-- O assistente passa a propor comentários em tarefas (gravados só após confirmação).
ALTER TABLE assistant_proposals DROP CONSTRAINT IF EXISTS assistant_proposals_kind_check;
ALTER TABLE assistant_proposals
  ADD CONSTRAINT assistant_proposals_kind_check
  CHECK (kind IN ('create_tasks','apply_wbs','update_task','status_note','add_comment'));
