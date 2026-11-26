-- Pastas de projetos: o setor agrupa os próprios projetos por tema (ex.: "ERP", "Imóveis") e o
-- panorama passa a mostrar um bloco por pasta. A pasta é do espaço; o projeto fica em no máximo
-- uma. Excluir a pasta devolve os projetos para "sem pasta" (não apaga projeto nenhum).
CREATE TABLE project_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  position int NOT NULL DEFAULT 0,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Nome único no espaço sem diferenciar maiúsculas: duas pastas "ERP" seriam ambíguas na tela.
CREATE UNIQUE INDEX project_folders_name ON project_folders(workspace_id, lower(name));

ALTER TABLE projects ADD COLUMN folder_id uuid REFERENCES project_folders(id) ON DELETE SET NULL;
CREATE INDEX projects_folder ON projects(folder_id) WHERE folder_id IS NOT NULL;
