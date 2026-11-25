-- Compartilhamento direto com qualquer unidade do organograma, fora da hierarquia (ADR 0008).
-- 'up' é o de sempre (um nível por vez, repassável); 'direct' é escolha só do espaço dono e
-- não se repassa. Os dois caminhos coexistem para a mesma unidade e se desfazem separados.
ALTER TABLE project_shares ADD COLUMN kind text NOT NULL DEFAULT 'up'
  CHECK (kind IN ('up', 'direct'));
ALTER TABLE project_shares DROP CONSTRAINT project_shares_pkey;
ALTER TABLE project_shares ADD PRIMARY KEY (project_id, unit, kind);
