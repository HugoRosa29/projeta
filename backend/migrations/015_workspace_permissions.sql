-- Matriz de permissões por espaço: o Gestor (admin) define o que cada perfil pode fazer.
-- O admin não aparece aqui porque pode tudo. O padrão reproduz o comportamento anterior,
-- então espaços existentes não mudam até o Gestor editar (ver identity/policy.py).
ALTER TABLE workspaces ADD COLUMN permissions jsonb NOT NULL DEFAULT
  '{"manager": ["project.create", "project.manage", "task.write", "comment.write"],
    "member": ["task.write", "comment.write"],
    "viewer": []}'::jsonb;
