-- Custo do resultado-chave, em reais, para o painel de OKRs (coluna "Custo" e total por objetivo).
-- Nulo = não informado; 0 = feito com equipe interna, sem custo externo.
ALTER TABLE key_results ADD COLUMN cost numeric(14, 2) CHECK (cost IS NULL OR cost >= 0);
