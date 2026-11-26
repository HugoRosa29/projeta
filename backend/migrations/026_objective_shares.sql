-- Objetivo (com seus KRs) visível à unidade `unit`, só leitura. Mesma regra dos projetos
-- (migração 016, ADR 0004): o Gestor do espaço dono compartilha com a unidade imediatamente
-- acima; cada nível decide se repassa ao seguinte. Quem vê na unidade que recebeu: Gestor e
-- perfis com `org.view_shared`.
CREATE TABLE objective_shares (
  objective_id uuid NOT NULL REFERENCES objectives(id) ON DELETE CASCADE,
  unit text NOT NULL REFERENCES org_units(sigla),
  from_unit text NOT NULL REFERENCES org_units(sigla),
  shared_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (objective_id, unit),
  CHECK (unit <> from_unit)
);
CREATE INDEX objective_shares_unit_idx ON objective_shares(unit);
