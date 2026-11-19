-- Subtarefas: um nível só (tarefa-mãe -> subtarefas), validado no serviço.
-- Excluir a tarefa-mãe não apaga as subtarefas: elas voltam a ser tarefas comuns.
ALTER TABLE tasks ADD COLUMN parent_id uuid REFERENCES tasks(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD CONSTRAINT tasks_parent_not_self CHECK (parent_id IS NULL OR parent_id <> id);
CREATE INDEX tasks_parent_idx ON tasks(parent_id);
