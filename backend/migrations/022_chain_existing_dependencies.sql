-- Encadeia as datas das dependências que já existiam antes da regra (work/schedule.py): tarefa com
-- dependência começa no dia seguinte ao prazo mais tardio das anteriores; com início anterior,
-- o prazo anda junto (mantém a duração); sem início, o prazo só sobe se ficaria antes dele.
-- Cada volta acerta um nível da cadeia; o grafo não tem ciclo, então termina.
DO $$
DECLARE
  changed int;
  rounds int := 0;
BEGIN
  LOOP
    WITH want AS (
      SELECT d.task_id AS id, max(p.due_date) + 1 AS s
      FROM task_dependencies d JOIN tasks p ON p.id = d.depends_on_id
      WHERE p.due_date IS NOT NULL
      GROUP BY d.task_id
    )
    UPDATE tasks t SET
      due_date = CASE
        WHEN t.due_date IS NULL THEN NULL
        WHEN t.start_date IS NOT NULL THEN t.due_date + (w.s - t.start_date)
        ELSE greatest(t.due_date, w.s)
      END,
      start_date = w.s,
      version = t.version + 1,
      updated_at = now()
    FROM want w
    WHERE w.id = t.id AND t.start_date IS DISTINCT FROM w.s;
    GET DIAGNOSTICS changed = ROW_COUNT;
    EXIT WHEN changed = 0;
    rounds := rounds + 1;
    IF rounds > 1000 THEN
      RAISE EXCEPTION 'Encadeamento de datas não convergiu: confira ciclos em task_dependencies';
    END IF;
  END LOOP;
END $$;
