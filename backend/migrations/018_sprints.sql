-- Sprints no projeto (ADR 0006) e prioridade "urgente".

-- Prioridade: entra "urgent" acima de "high". A etiqueta livre URGENTE fazia esse papel; vira
-- prioridade para haver um só jeito de dizer "urgente" (e para ordenar e filtrar por ela).
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_priority_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_priority_check
  CHECK (priority IN ('low', 'medium', 'high', 'urgent'));
UPDATE tasks SET priority = 'urgent',
  labels = ARRAY(SELECT l FROM unnest(labels) AS l WHERE upper(btrim(l)) <> 'URGENTE')
WHERE EXISTS (SELECT 1 FROM unnest(labels) AS l WHERE upper(btrim(l)) = 'URGENTE');

-- Sprint: intervalo de datas de calendário com uma meta. Uma ativa por vez em cada projeto.
-- Sobreposição de datas é recusada no serviço (work/sprints.py), sob trava do projeto.
CREATE TABLE sprints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  number int NOT NULL,
  name text NOT NULL,
  goal text NOT NULL DEFAULT '',
  start_date date NOT NULL,
  end_date date NOT NULL,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'active', 'closed')),
  capacity_minutes int CHECK (capacity_minutes IS NULL OR capacity_minutes >= 0),
  -- Relatório gravado no encerramento; não muda depois (as tarefas podem mudar).
  summary jsonb,
  started_at timestamptz,
  closed_at timestamptz,
  version int NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date),
  UNIQUE (project_id, number)
);
CREATE UNIQUE INDEX sprints_one_active_idx ON sprints(project_id) WHERE status = 'active';

-- Nulo = backlog do projeto. Excluir uma sprint (só planejada) devolve as tarefas ao backlog.
ALTER TABLE tasks ADD COLUMN sprint_id uuid REFERENCES sprints(id) ON DELETE SET NULL;
CREATE INDEX tasks_sprint_idx ON tasks(sprint_id);

-- Entrada e saída de cada tarefa na sprint: escopo comprometido no início, o que entrou e saiu
-- no meio, e (numa próxima etapa) o burndown. Uma linha aberta (removed_at nulo) por tarefa.
CREATE TABLE sprint_task_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sprint_id uuid NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  added_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz
);
CREATE INDEX sprint_task_log_sprint_idx ON sprint_task_log(sprint_id);
CREATE UNIQUE INDEX sprint_task_log_open_idx ON sprint_task_log(task_id) WHERE removed_at IS NULL;
