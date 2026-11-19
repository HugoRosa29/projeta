-- Percentual concluído informado por quem gerencia (como o "% Terminado" do Redmine).
-- Nulo = a interface calcula pelas tarefas concluídas.
ALTER TABLE projects
  ADD COLUMN progress int CHECK (progress BETWEEN 0 AND 100);
