// Áreas do panorama: na unidade que recebe projetos do organograma (ex.: COTIN), cada espaço de
// origem (DISID, DIRAU...) é uma área. "Geral" junta todas. O recorte de acesso veio do servidor.
import type { PortfolioRow } from "./formal";
import { summarize, type Summary } from "./overview";

export interface Area {
  id: string;
  label: string;
  own: boolean;
  rows: PortfolioRow[];
  summary: Summary;
}

/** Áreas com projeto, a do próprio espaço primeiro e as demais em ordem alfabética. */
export function areasOf(rows: PortfolioRow[], ownId: string, ownName: string): Area[] {
  const groups = new Map<string, { label: string; rows: PortfolioRow[] }>();
  for (const r of rows) {
    const id = r.workspace_id ?? ownId;
    const label = id === ownId ? ownName : (r.shared_from ?? ownName);
    const g = groups.get(id) ?? { label, rows: [] };
    g.rows.push(r);
    groups.set(id, g);
  }
  return [...groups.entries()]
    .map(([id, g]) => ({ id, label: g.label, own: id === ownId, rows: g.rows, summary: summarize(g.rows) }))
    .sort((a, b) => Number(b.own) - Number(a.own) || a.label.localeCompare(b.label, "pt-BR"));
}

/** Área escolhida, se ainda existir; senão "Geral" (string vazia). */
export function pickArea(areas: Area[], id: string | null): Area | null {
  return areas.find((a) => a.id === id) ?? null;
}
