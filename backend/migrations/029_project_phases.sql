-- Fases do projeto: antes eram só o texto livre `tasks.phase` (vindo da EAP do assistente ou da
-- importação), sem como renomear, ordenar ou criar uma fase vazia. Agora o projeto tem a própria
-- lista ordenada. A tarefa continua guardando o *nome* da fase em `tasks.phase` (assim a linha de
-- base, a exportação e o assistente seguem iguais); o serviço mantém os dois em sincronia:
-- renomear a fase renomeia nas tarefas, excluir a fase deixa as tarefas "sem fase".
CREATE TABLE project_phases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Sem diferenciar maiúsculas: "Execução" e "EXECUÇÃO" seriam a mesma fase na tela.
CREATE UNIQUE INDEX project_phases_name ON project_phases(project_id, lower(name));

UPDATE tasks SET phase = NULLIF(btrim(phase), '') WHERE phase IS DISTINCT FROM NULLIF(btrim(phase), '');

-- Fases que já existem nas tarefas, na ordem em que aparecem no projeto.
INSERT INTO project_phases(project_id, name, position)
SELECT project_id, name, (row_number() OVER (PARTITION BY project_id ORDER BY first_pos, name))::int - 1
FROM (
  SELECT project_id, min(phase) AS name, min(position) AS first_pos
  FROM tasks
  WHERE project_id IS NOT NULL AND phase IS NOT NULL
  GROUP BY project_id, lower(phase)
) s;

-- Uma grafia só por fase (a registrada).
UPDATE tasks t SET phase = p.name
FROM project_phases p
WHERE t.project_id = p.project_id AND lower(t.phase) = lower(p.name) AND t.phase <> p.name;

-- Subtarefa acompanha a fase da tarefa-mãe (regra do serviço daqui em diante).
UPDATE tasks s SET phase = m.phase
FROM tasks m
WHERE s.parent_id = m.id AND s.phase IS DISTINCT FROM m.phase;
