-- Linhas de base do cronograma: fotografias das datas planejadas para comparar com o atual.
-- Número 0 é a linha de base inicial, criada junto com o projeto: guarda as *primeiras* datas
-- planejadas de cada tarefa (a tarefa entra quando ganha prazo e não é mais sobrescrita).
-- As seguintes (1, 2, …) são fotografias completas tiradas sob demanda no cronograma.
CREATE TABLE baselines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  number int NOT NULL CHECK (number >= 0),
  name text NOT NULL,
  note text NOT NULL DEFAULT '',
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, number)
);

-- Sem chave estrangeira para tasks: a tarefa excluída depois continua na fotografia e aparece
-- como "removida" na comparação (mudança de escopo). O título é guardado pelo mesmo motivo.
CREATE TABLE baseline_tasks (
  baseline_id uuid NOT NULL REFERENCES baselines(id) ON DELETE CASCADE,
  task_id uuid NOT NULL,
  title text NOT NULL,
  phase text,
  is_milestone boolean NOT NULL DEFAULT false,
  start_date date,
  due_date date NOT NULL,
  PRIMARY KEY (baseline_id, task_id)
);

-- Projetos que já existiam ganham a linha de base inicial com as datas de hoje.
INSERT INTO baselines(project_id, number, name, created_by, created_at)
SELECT id, 0, 'Linha de base inicial', created_by, created_at FROM projects;

INSERT INTO baseline_tasks(baseline_id, task_id, title, phase, is_milestone, start_date, due_date)
SELECT b.id, t.id, t.title, t.phase, t.is_milestone, t.start_date, t.due_date
FROM tasks t JOIN baselines b ON b.project_id = t.project_id AND b.number = 0
WHERE t.due_date IS NOT NULL;
