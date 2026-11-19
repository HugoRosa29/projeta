// Esteira e timeline da home: em que fase cada projeto está e se o prazo está sob controle.
// Vale para qualquer espaço: usa fase, % concluído e datas que o projeto já tiver, na ordem
// campo do portfólio → TAP → prazos das tarefas. Nada aqui decide acesso; as linhas vêm do servidor.
import { PHASE_LABEL, type Phase, type PortfolioRow } from "./formal";
import { projectProgress } from "./work";

/** Nomes de campo do portfólio reconhecidos como datas (comparados sem acento nem caixa). */
const START_FIELDS = ["inicio", "data de inicio", "data inicio", "data inicial", "inicio previsto", "data de abertura"];
const END_FIELDS = [
  "data prevista",
  "termino",
  "termino previsto",
  "data de termino",
  "data termino",
  "previsao de termino",
  "data final",
  "data de entrega",
  "prazo",
  "prazo final",
  "fim",
];

/** Ritmo: o projeto está atrás quando o tempo decorrido passa o % concluído por mais que isto. */
export const BEHIND_POINTS = 25;
/** "Termina em breve": até tantos dias para o fim previsto. */
export const SOON_DAYS = 30;

export type Pace = "late" | "behind" | "soon" | "ok" | "none";
export const PACE_ORDER: Pace[] = ["late", "behind", "soon", "ok", "none"];
export const PACE_LABEL: Record<Pace, string> = {
  late: "Prazo vencido",
  behind: "Ritmo abaixo do previsto",
  soon: `Termina em até ${SOON_DAYS} dias`,
  ok: "No prazo",
  none: "Sem prazo definido",
};
export const PACE_HINT: Record<Pace, string> = {
  late: "Data prevista já passou e o projeto não chegou a 100%",
  behind: `Tempo decorrido passa o % concluído em mais de ${BEHIND_POINTS} pontos`,
  soon: "Fim previsto nos próximos dias",
  ok: "Dentro do prazo e no ritmo",
  none: "Sem data prevista no portfólio, no TAP ou nas tarefas",
};

export interface Stage {
  /** null = projeto sem fase (não usa o modo formal). */
  key: Phase | null;
  code: string;
  label: string;
}

export const STAGES: Stage[] = [
  { key: null, code: "00", label: "Sem fase definida" },
  ...(Object.keys(PHASE_LABEL) as Phase[]).map((p, i) => ({ key: p, code: String(i + 1).padStart(2, "0"), label: PHASE_LABEL[p] })),
];

type Source = "campo" | "TAP" | "tarefas" | "criação";

export interface Track {
  row: PortfolioRow;
  pct: number;
  start: string | null;
  end: string | null;
  startFrom: Source | null;
  endFrom: Source | null;
  /** Dias corridos até o fim previsto (negativo = vencido). */
  daysLeft: number | null;
  /** Pontos que o % concluído está atrás do tempo decorrido (positivo = atrasado). */
  gap: number | null;
  pace: Pace;
}

const plain = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

/** Aceita "dd/mm/aaaa", "dd/mm/aa" e "aaaa-mm-dd"; devolve "aaaa-mm-dd" ou null se não for data válida. */
export function parseDate(text: string | null | undefined): string | null {
  if (!text) return null;
  const s = text.trim();
  let y: number, m: number, d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s);
  if (iso) [y, m, d] = [+iso[1], +iso[2], +iso[3]];
  else if (br) [d, m, y] = [+br[1], +br[2], br[3].length === 2 ? 2000 + +br[3] : +br[3]];
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/** Dias entre duas datas de calendário "aaaa-mm-dd" (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

function fieldDate(row: PortfolioRow, names: string[]): string | null {
  for (const want of names) {
    const hit = row.attributes?.find((a) => plain(a.name) === want);
    const d = parseDate(hit?.value);
    if (d) return d;
  }
  return null;
}

function first(...options: [string | null | undefined, Source][]): [string | null, Source | null] {
  for (const [value, source] of options) {
    const d = parseDate(value);
    if (d) return [d, source];
  }
  return [null, null];
}

export function track(row: PortfolioRow, today: string): Track {
  const { pct } = projectProgress(row);
  let [start, startFrom] = first([fieldDate(row, START_FIELDS), "campo"], [row.tap_start, "TAP"], [row.first_due, "tarefas"], [row.created_on, "criação"]);
  const [end, endFrom] = first([fieldDate(row, END_FIELDS), "campo"], [row.tap_end, "TAP"], [row.last_due, "tarefas"]);
  // Início depois do fim é dado de fonte diferente (ex.: projeto criado depois das datas do campo).
  if (start && end && start > end) [start, startFrom] = [null, null];
  const daysLeft = end ? daysBetween(today, end) : null;
  let gap: number | null = null;
  if (start && end && end > start && today > start) {
    const elapsed = Math.min(1, daysBetween(start, today) / daysBetween(start, end));
    gap = Math.round(elapsed * 100 - pct);
  }
  let pace: Pace;
  if (daysLeft === null) pace = "none";
  else if (pct >= 100) pace = "ok";
  else if (daysLeft < 0) pace = "late";
  else if (gap !== null && gap > BEHIND_POINTS) pace = "behind";
  else if (daysLeft <= SOON_DAYS) pace = "soon";
  else pace = "ok";
  return { row, pct, start, end, startFrom, endFrom, daysLeft, gap, pace };
}

/** Mais urgente primeiro; no mesmo nível, quem termina antes. */
export function byUrgency(a: Track, b: Track): number {
  return (
    PACE_ORDER.indexOf(a.pace) - PACE_ORDER.indexOf(b.pace) ||
    (a.end ?? "9999").localeCompare(b.end ?? "9999") ||
    a.row.name.localeCompare(b.row.name, "pt-BR")
  );
}

export function paceCounts(tracks: Track[]): Record<Pace, number> {
  const out = { late: 0, behind: 0, soon: 0, ok: 0, none: 0 };
  for (const t of tracks) out[t.pace] += 1;
  return out;
}

export interface StageGroup extends Stage {
  tracks: Track[];
  /** Quantos estão vencidos ou fora do ritmo. */
  attention: number;
}

export function stageGroups(tracks: Track[]): StageGroup[] {
  return STAGES.map((s) => {
    const mine = tracks.filter((t) => (t.row.phase ?? null) === s.key).sort(byUrgency);
    return { ...s, tracks: mine, attention: mine.filter((t) => t.pace === "late" || t.pace === "behind").length };
  });
}

export interface Span {
  from: string;
  to: string;
  /** Posição (0–100) de uma data no eixo. */
  at: (d: string) => number;
  ticks: { date: string; label: string; at: number }[];
}

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** Eixo da timeline: do primeiro início ao último fim, sempre incluindo hoje, em meses inteiros. */
export function timelineSpan(tracks: Track[], today: string): Span | null {
  const dated = tracks.filter((t) => t.end);
  if (!dated.length) return null;
  const dates = [today, ...dated.flatMap((t) => [t.start ?? t.end!, t.end!])].sort();
  const [y0, m0] = dates[0].split("-").map(Number);
  const [y1, m1] = dates.at(-1)!.split("-").map(Number);
  const from = `${y0}-${String(m0).padStart(2, "0")}-01`;
  const endMonth = new Date(Date.UTC(y1, m1, 1)); // 1º dia do mês seguinte
  const to = endMonth.toISOString().slice(0, 10);
  const total = daysBetween(from, to);
  const at = (d: string) => Math.max(0, Math.min(100, (daysBetween(from, d) / total) * 100));
  const months = (y1 - y0) * 12 + (m1 - m0) + 1;
  // No máximo 6 marcas, em passos de calendário (1, 2, 3, 6 ou 12 meses): mais que isso colide.
  const step = [1, 2, 3, 6, 12].find((s) => months / s <= 6) ?? 12;
  const ticks = [];
  for (let i = 0; i < months; i++) {
    const m = (m0 - 1 + i) % 12;
    const y = y0 + Math.floor((m0 - 1 + i) / 12);
    if (m % step !== 0) continue;
    const date = `${y}-${String(m + 1).padStart(2, "0")}-01`;
    ticks.push({ date, label: `${MONTHS[m]}/${String(y).slice(2)}`, at: at(date) });
  }
  return { from, to, at, ticks };
}
