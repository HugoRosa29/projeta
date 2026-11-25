// Quadro do panorama, no formato de board (grupos recolhíveis, uma linha por projeto). As linhas já vêm
// recortadas pelo servidor; aqui só se agrupa e se ordena.
import { HEALTH_LABEL, type Health } from "./formal";
import { PACE_LABEL, PACE_ORDER, STAGES, byUrgency, type Pace, type Track } from "./esteira";
import { HEALTH_ORDER, NO_VALUE } from "./overview";
import { attributeValue } from "./work";

/** Cores do quadro (classes g-*). Situação e prazo têm cor de significado; fase e campo livre
 *  recebem cores de categoria em sequência, como os grupos de um board. */
export const HEALTH_COLOR: Record<Health, string> = { on_track: "green", at_risk: "orange", late: "red" };
export const PACE_COLOR: Record<Pace, string> = { late: "red", behind: "orange", soon: "blue", ok: "green", none: "gray" };
export const PALETTE = ["blue", "purple", "teal", "pink", "navy", "olive", "brown"];

/** Agrupamentos fixos; um campo livre do portfólio entra como "field:<nome>". */
export type GroupBy = "health" | "pace" | "phase" | `field:${string}`;
export const GROUP_LABEL: Record<"health" | "pace" | "phase", string> = { health: "Situação", pace: "Prazo", phase: "Fase" };

export interface BoardGroup {
  key: string;
  label: string;
  /** Cor do grupo (classe g-<cor>). */
  color: string;
  tracks: Track[];
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("pt-BR")} ${n === 1 ? one : many}`;

export function daysText(t: Pick<Track, "daysLeft">): string {
  if (t.daysLeft === null) return "sem prazo";
  if (t.daysLeft < 0) return `vencido há ${plural(-t.daysLeft, "dia", "dias")}`;
  if (t.daysLeft === 0) return "termina hoje";
  return `faltam ${plural(t.daysLeft, "dia", "dias")}`;
}

/** Só os grupos com projeto, na ordem natural do critério; dentro de cada um, o mais urgente primeiro. */
export function groupTracks(tracks: Track[], by: GroupBy): BoardGroup[] {
  let groups: BoardGroup[];
  if (by === "health") {
    groups = HEALTH_ORDER.slice()
      .reverse() // atrasado primeiro: é o que pede ação
      .map((h) => ({ key: h, label: HEALTH_LABEL[h], color: HEALTH_COLOR[h], tracks: tracks.filter((t) => t.row.health === h) }));
  } else if (by === "pace") {
    groups = PACE_ORDER.map((p) => ({ key: p, label: PACE_LABEL[p], color: PACE_COLOR[p], tracks: tracks.filter((t) => t.pace === p) }));
  } else if (by === "phase") {
    // Sem fase vai por último aqui: no quadro, o ciclo do projeto é a leitura principal.
    const stages = [...STAGES.slice(1), STAGES[0]];
    groups = stages.map((s) => ({
      key: s.key ?? "none",
      label: s.label,
      color: s.key ? "" : "gray",
      tracks: tracks.filter((t) => (t.row.phase ?? null) === s.key),
    }));
  } else {
    const field = by.slice("field:".length);
    const buckets = new Map<string, Track[]>();
    for (const t of tracks) {
      const v = attributeValue(t.row.attributes, field) ?? NO_VALUE;
      buckets.set(v, [...(buckets.get(v) ?? []), t]);
    }
    groups = [...buckets]
      .sort(([a, x], [b, y]) => +(a === NO_VALUE) - +(b === NO_VALUE) || y.length - x.length || a.localeCompare(b, "pt-BR"))
      .map(([v, list]) => ({ key: v, label: v, color: v === NO_VALUE ? "gray" : "", tracks: list }));
  }
  // A cor de categoria é dada depois de tirar os grupos vazios: grupos vizinhos nunca repetem cor.
  return groups
    .filter((g) => g.tracks.length)
    .map((g, i) => ({ ...g, color: g.color || PALETTE[i % PALETTE.length], tracks: g.tracks.slice().sort(byUrgency) }));
}

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** Período curto para a pílula da timeline: "12 jan – 30 jun", com o ano quando não é o de hoje. */
export function rangeText(start: string | null, end: string | null, today: string): string {
  const year = today.slice(0, 4);
  const one = (d: string, withYear: boolean) => `${+d.slice(8, 10)} ${MONTHS[+d.slice(5, 7) - 1]}${withYear ? `/${d.slice(2, 4)}` : ""}`;
  if (!end) return "sem data";
  const other = (start ?? end).slice(0, 4) !== year || end.slice(0, 4) !== year;
  return start && start !== end ? `${one(start, other)} – ${one(end, other)}` : one(end, other);
}

/** Fração (0–1) do período já decorrida até hoje; sem início, 1 se o fim já passou. */
export function elapsed(start: string | null, end: string | null, today: string): number {
  if (!end) return 0;
  if (!start || start >= end) return today >= end ? 1 : 0;
  return Math.max(0, Math.min(1, (Date.parse(today) - Date.parse(start)) / (Date.parse(end) - Date.parse(start))));
}
