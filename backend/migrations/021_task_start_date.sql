-- Data de início da tarefa: com o prazo, dá a duração real no cronograma (antes a barra
-- começava na criação da tarefa). Data de calendário, como o prazo. Nula = sem início definido.
ALTER TABLE tasks ADD COLUMN start_date date;
ALTER TABLE tasks ADD CONSTRAINT tasks_start_not_after_due
  CHECK (start_date IS NULL OR due_date IS NULL OR start_date <= due_date);
