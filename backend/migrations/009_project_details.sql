-- Ficha do projeto: resumo curto (cabeçalho e cards) e dados de quem pede e conduz.
-- `responsible` e `requester` são texto livre de propósito: a pessoa pode não ter conta
-- (ex.: área demandante); quem tem conta continua sendo membro do projeto.
-- `external_ref` guarda o identificador em outro sistema (Redmine, Jira, processo SEI...).
ALTER TABLE projects
  ADD COLUMN summary text NOT NULL DEFAULT '',
  ADD COLUMN responsible text NOT NULL DEFAULT '',
  ADD COLUMN requester text NOT NULL DEFAULT '',
  ADD COLUMN external_ref text NOT NULL DEFAULT '';
