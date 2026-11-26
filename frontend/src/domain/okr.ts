/** OKRs (work/okrs.py): tipos da API e regras puras usadas na interface. */

export type Confidence = "on_track" | "at_risk" | "off_track";
export const CONFIDENCES: Confidence[] = ["on_track", "at_risk", "off_track"];
export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  on_track: "No caminho",
  at_risk: "Em risco",
  off_track: "Fora do caminho",
};
export const CONFIDENCE_TONE: Record<Confidence, "ok" | "warn" | "bad"> = { on_track: "ok", at_risk: "warn", off_track: "bad" };
/** Classe de .badge para cada confiança. */
export const CONFIDENCE_BADGE: Record<Confidence, string> = { on_track: "ok", at_risk: "warn", off_track: "alerta" };

export interface KeyResult {
  id: string;
  objective_id: string;
  objective_title?: string;
  title: string;
  owner_id: string | null;
  owner_name: string | null;
  kind: "number" | "project";
  start_value: number;
  target_value: number;
  current_value: number;
  unit: string;
  project_id: string | null;
  project_name: string | null;
  /** Reais. Nulo = não informado; 0 = equipe interna, sem custo externo. */
  cost: number | null;
  confidence: Confidence;
  last_checkin_at: string | null;
  progress: number;
  stale: boolean;
  behind_pace: boolean;
  mine: boolean;
  can_checkin: boolean;
}
export interface Objective {
  id: string;
  title: string;
  description: string;
  owner_id: string | null;
  owner_name: string | null;
  period: string;
  progress: number;
  confidence: Confidence | null;
  key_results: KeyResult[];
  /** Espaço de origem quando o objetivo veio de uma unidade abaixo no organograma (só leitura). */
  shared_from?: string;
}
export interface OkrBoard {
  period: string;
  periods: string[];
  /** % do trimestre já decorrido; nulo fora do trimestre. */
  pace: number | null;
  can_manage: boolean;
  objectives: Objective[];
  summary: {
    objectives: number;
    key_results: number;
    progress: number;
    confidence: Record<Confidence, number>;
    stale: number;
    behind_pace: number;
    updated_this_week: number;
    without_owner: number;
    cost: number;
  };
  /** Objetivos compartilhados pelas unidades abaixo no organograma, só leitura. */
  received: { objectives: Objective[]; summary: OkrBoard["summary"] };
}
export interface MyOkrs {
  period: string;
  pace: number | null;
  key_results: KeyResult[];
  pending: number;
  streak_weeks: number;
  checkins_this_week: number;
}
export interface CheckIn {
  id: string;
  value: number;
  progress: number;
  confidence: Confidence;
  note: string;
  created_at: string;
  author_id: string | null;
  author_name: string | null;
}

/** "2026-T4" -> "4º trimestre de 2026". */
export function periodLabel(p: string): string {
  return `${p.slice(-1)}º trimestre de ${p.slice(0, 4)}`;
}

/** Mesmo cálculo do servidor (okrs.progress_of): meta abaixo da partida também funciona. */
export function progressOf(start: number, target: number, current: number): number {
  if (target === start) return current >= target ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round((100 * (current - start)) / (target - start))));
}

export function fmtNum(n: number): string {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

export function fmtValue(n: number, unit: string): string {
  if (unit === "%") return `${fmtNum(n)}%`;
  return unit ? `${fmtNum(n)} ${unit}` : fmtNum(n);
}

/** Custo curto para a coluna do quadro: "interno", "R$ 900", "R$ 40 mil", "R$ 1,3 mi". */
export function fmtCost(cost: number | null): string {
  if (cost == null) return "—";
  if (cost === 0) return "interno";
  const short = (n: number, suffix: string) => `R$ ${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} ${suffix}`;
  if (cost >= 1e9) return short(cost / 1e9, "bi");
  if (cost >= 1e6) return short(cost / 1e6, "mi");
  if (cost >= 1e3) return short(cost / 1e3, "mil");
  return `R$ ${cost.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}`;
}

/** Valor completo, para a dica e para leitores de tela. */
export function fmtCostFull(cost: number | null): string {
  if (cost == null) return "custo não informado";
  if (cost === 0) return "equipe interna, sem custo externo";
  return cost.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** "hoje", "ontem", "há 5 dias" — para lembrar há quanto tempo o KR não é atualizado. */
export function since(iso: string | null, now = new Date()): string {
  if (!iso) return "nunca atualizado";
  const days = Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "atualizado hoje";
  if (days === 1) return "atualizado ontem";
  return `atualizado há ${days} dias`;
}

/** Mensagem curta depois do check-in: reconhece o avanço sem exagerar. */
export function cheer(before: number, after: number, streak: number): string {
  if (after >= 100 && before < 100) return "Meta atingida! Resultado-chave concluído.";
  const d = after - before;
  const tail = streak >= 2 ? ` ${streak} semanas seguidas atualizando.` : "";
  if (d > 0) return `Avançou ${d} ponto${d === 1 ? "" : "s"}.${tail}`;
  if (d < 0) return `Recuou ${-d} ponto${d === -1 ? "" : "s"}. Registrar também é transparência.${tail}`;
  return `Check-in registrado.${tail}`;
}

/** Na lista de quem gere: KRs sem atualização recente agrupados pelo responsável. */
export function staleByOwner(objectives: Objective[]): { owner: string; items: KeyResult[] }[] {
  const map = new Map<string, KeyResult[]>();
  for (const o of objectives)
    for (const k of o.key_results)
      if (k.stale && k.progress < 100) {
        const owner = k.owner_name ?? "Sem responsável";
        map.set(owner, [...(map.get(owner) ?? []), k]);
      }
  return [...map.entries()].map(([owner, items]) => ({ owner, items })).sort((a, b) => b.items.length - a.items.length || a.owner.localeCompare(b.owner));
}

/**
 * Junta os resumos dos objetivos próprios e dos recebidos num panorama só. As contagens somam;
 * o progresso é a média dos objetivos, como o servidor calcula cada resumo (work/okrs.py).
 */
export function mergeSummaries(objectives: Objective[], ...parts: OkrBoard["summary"][]): OkrBoard["summary"] {
  const sum = (f: (p: OkrBoard["summary"]) => number) => parts.reduce((n, p) => n + f(p), 0);
  return {
    objectives: objectives.length,
    key_results: sum((p) => p.key_results),
    progress: objectives.length ? Math.round(objectives.reduce((n, o) => n + o.progress, 0) / objectives.length) : 0,
    confidence: { on_track: sum((p) => p.confidence.on_track), at_risk: sum((p) => p.confidence.at_risk), off_track: sum((p) => p.confidence.off_track) },
    stale: sum((p) => p.stale),
    behind_pace: sum((p) => p.behind_pace),
    updated_this_week: sum((p) => p.updated_this_week),
    without_owner: sum((p) => p.without_owner),
    cost: sum((p) => p.cost),
  };
}

/** Quem vê a home como gestão (painéis) e quem vê como execução (o próprio trabalho primeiro). */
export function isLead(w: { role: string; permissions?: string[] }): boolean {
  return w.role === "admin" || !!w.permissions?.includes("okr.manage") || !!w.permissions?.includes("project.manage");
}

// ---------- Quadro do painel (busca, filtros, ordem e resumo por objetivo) ----------

/** Mesmo critério do servidor (okrs.PACE_GAP): o tempo decorrido passa o progresso em mais de 25 pontos. */
export const PACE_GAP = 25;
export function behindPace(progress: number, pace: number | null): boolean {
  return pace != null && progress < 100 && pace - progress > PACE_GAP;
}

/** Cor do quadro (classe g-*) para cada confiança. */
export const CONFIDENCE_COLOR: Record<Confidence, string> = { on_track: "green", at_risk: "orange", off_track: "red" };

/** "" = todos; "none" = sem responsável; o resto é o id da pessoa. */
export interface KrFilter {
  q: string;
  owner: string;
  confidence: Confidence | "";
  pending: boolean;
}
export const NO_KR_FILTER: KrFilter = { q: "", owner: "", confidence: "", pending: false };

export type KrSort = "position" | "progress" | "risk" | "stale";
export const KR_SORT_LABEL: Record<KrSort, string> = {
  position: "Ordem: definida",
  progress: "Ordem: menor progresso",
  risk: "Ordem: maior risco",
  stale: "Ordem: mais tempo sem check-in",
};

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const isPending = (k: KeyResult) => k.stale && k.progress < 100;

export function isFiltered(f: KrFilter): boolean {
  return Boolean(f.q.trim() || f.owner || f.confidence || f.pending);
}

/** Responsáveis que aparecem nos KRs, para o filtro. */
export function krOwners(objectives: Objective[]): { id: string; name: string }[] {
  const map = new Map<string, string>();
  for (const o of objectives) for (const k of o.key_results) if (k.owner_id) map.set(k.owner_id, k.owner_name ?? "—");
  return [...map].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

const KR_ORDER: Record<KrSort, ((a: KeyResult, b: KeyResult) => number) | null> = {
  position: null,
  progress: (a, b) => a.progress - b.progress,
  risk: (a, b) => CONFIDENCES.indexOf(b.confidence) - CONFIDENCES.indexOf(a.confidence) || +b.behind_pace - +a.behind_pace || a.progress - b.progress,
  // Nunca atualizado vem primeiro; depois o check-in mais antigo.
  stale: (a, b) => (a.last_checkin_at ?? "").localeCompare(b.last_checkin_at ?? ""),
};

/**
 * Recorte do quadro. A busca casa com o objetivo (mostra todos os KRs dele) ou com o KR, o
 * responsável e o projeto. Com filtro, objetivo sem KR no recorte sai do quadro.
 */
export function filterBoard(objectives: Objective[], f: KrFilter, sort: KrSort = "position"): Objective[] {
  const q = norm(f.q.trim());
  const filtered = isFiltered(f);
  const cmp = KR_ORDER[sort];
  return objectives.flatMap((o) => {
    const objHit = !!q && norm(o.title).includes(q);
    const krs = o.key_results.filter(
      (k) =>
        (!q || objHit || [k.title, k.owner_name ?? "", k.project_name ?? ""].some((s) => norm(s).includes(q))) &&
        (!f.owner || (f.owner === "none" ? !k.owner_id : k.owner_id === f.owner)) &&
        (!f.confidence || k.confidence === f.confidence) &&
        (!f.pending || isPending(k)),
    );
    if (filtered && !krs.length) return [];
    return [{ ...o, key_results: cmp ? krs.slice().sort(cmp) : krs }];
  });
}

/** Linha de resumo de um objetivo no quadro. */
/** Sem nenhum check-in, a confiança do KR é só o valor padrão: o quadro mostra "sem avaliação". */
export const isRated = (k: KeyResult) => k.last_checkin_at != null;

export function objectiveSummary(o: Objective) {
  const krs = o.key_results;
  const rated = krs.filter(isRated);
  const confidence = Object.fromEntries(CONFIDENCES.map((c) => [c, rated.filter((k) => k.confidence === c).length])) as Record<Confidence, number>;
  const costs = krs.map((k) => k.cost).filter((c): c is number => c != null);
  return {
    unrated: krs.length - rated.length,
    /** Soma do que foi informado; nulo quando nenhum KR tem custo. */
    cost: costs.length ? costs.reduce((a, b) => a + b, 0) : null,
    costMissing: krs.length - costs.length,
    owners: new Set(krs.map((k) => k.owner_id).filter(Boolean)).size,
    projects: new Set(krs.map((k) => k.project_id ?? (k.kind === "project" ? k.id : null)).filter(Boolean)).size,
    pending: krs.filter(isPending).length,
    confidence,
  };
}

/** Faixa do topo: objetivos no ritmo, KRs em risco, check-ins em dia. */
export function boardStats(board: Pick<OkrBoard, "objectives" | "pace" | "summary">) {
  const s = board.summary;
  return {
    objectives: s.objectives,
    onPace: board.objectives.filter((o) => o.key_results.length && !behindPace(o.progress, board.pace)).length,
    keyResults: s.key_results,
    atRisk: s.confidence.at_risk + s.confidence.off_track,
    progress: s.progress,
    pending: board.objectives.reduce((n, o) => n + o.key_results.filter(isPending).length, 0),
    updated: s.updated_this_week,
  };
}
