// Áreas do panorama: cada nível do organograma vê só as unidades filhas diretas. Na COTIN, DISID e
// DIRAU são áreas; na COINT, tudo o que veio delas fica sob COTIN. A unidade filha vem do servidor
// (via_unit); sem ela (compartilhamento direto de fora da linha), o projeto fica junto dos
// próprios: um bloco por espaço de origem fragmentava o panorama a cada compartilhamento avulso.
// "Geral" junta todas. O recorte de acesso também veio do servidor.
import type { PortfolioRow } from "./formal";
import { summarize, type Summary } from "./overview";

export interface Area {
  id: string;
  label: string;
  own: boolean;
  rows: PortfolioRow[];
  summary: Summary;
  /** Bloco de uma pasta do próprio espaço (o id da pasta). */
  folder?: string;
  /** Bloco dos próprios projetos que ficaram fora de pasta, quando o espaço usa pastas. */
  loose?: boolean;
  /** Área do portfólio que corresponde ao bloco (a pasta abre o portfólio do próprio espaço). */
  portfolioArea?: string;
}

export interface Folder {
  id: string;
  name: string;
  position: number;
  project_count: number;
}

/** Áreas com projeto, a do próprio espaço primeiro e as demais em ordem alfabética. */
export function areasOf(rows: PortfolioRow[], ownId: string, ownName: string): Area[] {
  const groups = new Map<string, { label: string; rows: PortfolioRow[] }>();
  for (const r of rows) {
    const own = (r.workspace_id ?? ownId) === ownId || !r.via_unit;
    const id = own ? ownId : r.via_unit!.sigla;
    const label = own ? ownName : r.via_unit!.label;
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

/** Divide a área do próprio espaço em um bloco por pasta (na ordem das pastas) e um bloco com o
 *  que ficou fora de pasta. Pasta sem projeto no recorte não vira bloco. Sem pasta com projeto,
 *  as áreas voltam como vieram: o setor que não usa pastas vê o mesmo de antes. */
export function splitByFolder(areas: Area[], folders: Folder[]): Area[] {
  const own = areas.find((a) => a.own);
  if (!own || !folders.length) return areas;
  const inFolder = new Map<string, PortfolioRow[]>();
  const loose: PortfolioRow[] = [];
  const known = new Set(folders.map((f) => f.id));
  for (const r of own.rows) {
    if (r.folder_id && known.has(r.folder_id)) inFolder.set(r.folder_id, [...(inFolder.get(r.folder_id) ?? []), r]);
    else loose.push(r);
  }
  if (!inFolder.size) return areas;
  const blocks: Area[] = folders
    .filter((f) => inFolder.has(f.id))
    .map((f) => {
      const rows = inFolder.get(f.id)!;
      return { id: `pasta-${f.id}`, label: f.name, own: true, rows, summary: summarize(rows), folder: f.id, portfolioArea: own.id };
    });
  if (loose.length) blocks.push({ ...own, rows: loose, summary: summarize(loose), loose: true });
  return [...blocks, ...areas.filter((a) => a !== own)];
}
