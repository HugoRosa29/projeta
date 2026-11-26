/** Registro de riscos do projeto (PMBOK): tipos, rótulos e os números do painel. */

export type RiskKind = "threat" | "opportunity";
export type RiskCategory = "technical" | "management" | "commercial" | "external";
export type RiskStatus = "open" | "responding" | "occurred" | "closed";
export type RiskStrategy = "escalate" | "avoid" | "transfer" | "mitigate" | "exploit" | "share" | "enhance" | "accept";
export type RiskObjective = "schedule" | "cost" | "scope" | "quality";
export type RiskLevel = "low" | "moderate" | "high" | "critical";

export interface Risk {
  id: string;
  number: number;
  kind: RiskKind;
  title: string;
  cause: string;
  effect: string;
  category: RiskCategory;
  probability: number;
  impact: number;
  score: number;
  affects: RiskObjective[];
  strategy: RiskStrategy | null;
  response: string;
  contingency: string;
  trigger_signal: string;
  owner_id: string | null;
  owner_name: string | null;
  response_due: string | null;
  status: RiskStatus;
  reviewed_at: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export const KIND_LABEL: Record<RiskKind, string> = { threat: "Ameaça", opportunity: "Oportunidade" };

/** Nível 1 da EAR de riscos (estrutura analítica de riscos) do PMBOK. */
export const CATEGORIES: RiskCategory[] = ["technical", "management", "commercial", "external"];
export const CATEGORY_LABEL: Record<RiskCategory, string> = {
  technical: "Técnico",
  management: "Gerenciamento",
  commercial: "Comercial",
  external: "Externo",
};
export const CATEGORY_HINT: Record<RiskCategory, string> = {
  technical: "Requisitos, tecnologia, qualidade, complexidade",
  management: "Planejamento, recursos, comunicação, governança",
  commercial: "Contratos, fornecedores, licitações, parceiros",
  external: "Legislação, órgãos de controle, clima, mercado",
};

export const STATUSES: RiskStatus[] = ["open", "responding", "occurred", "closed"];
export const RISK_STATUS_LABEL: Record<RiskStatus, string> = {
  open: "Identificado",
  responding: "Em tratamento",
  occurred: "Ocorreu",
  closed: "Encerrado",
};

export const OBJECTIVES: RiskObjective[] = ["schedule", "cost", "scope", "quality"];
export const OBJECTIVE_LABEL: Record<RiskObjective, string> = { schedule: "Prazo", cost: "Custo", scope: "Escopo", quality: "Qualidade" };

/** Estratégias do PMBOK para cada tipo; "escalar" e "aceitar" valem para os dois. */
export const STRATEGIES: Record<RiskKind, RiskStrategy[]> = {
  threat: ["avoid", "mitigate", "transfer", "accept", "escalate"],
  opportunity: ["exploit", "enhance", "share", "accept", "escalate"],
};
export const STRATEGY_LABEL: Record<RiskStrategy, string> = {
  escalate: "Escalar",
  avoid: "Evitar",
  transfer: "Transferir",
  mitigate: "Mitigar",
  exploit: "Explorar",
  share: "Compartilhar",
  enhance: "Melhorar",
  accept: "Aceitar",
};
export const STRATEGY_HINT: Record<RiskStrategy, string> = {
  escalate: "Está fora da alçada do projeto: leve a quem decide (diretoria, comitê).",
  avoid: "Mude o plano para eliminar a ameaça ou proteger o projeto dela.",
  transfer: "Passe o impacto e a gestão a terceiros (contrato, seguro, garantia).",
  mitigate: "Aja antes para reduzir a probabilidade ou o impacto.",
  exploit: "Garanta que a oportunidade aconteça.",
  enhance: "Aumente a probabilidade ou o benefício da oportunidade.",
  share: "Divida com quem tem mais condição de aproveitá-la.",
  accept: "Reconheça e acompanhe; reserve contingência se fizer sentido.",
};

/** Escala qualitativa de 1 a 5 (faixas de probabilidade usuais no PMBOK). */
export const PROBABILITY_LABEL = ["", "Muito baixa (até 10%)", "Baixa (10–30%)", "Média (30–50%)", "Alta (50–70%)", "Muito alta (acima de 70%)"];
export const IMPACT_LABEL = ["", "Muito baixo", "Baixo", "Médio", "Alto", "Muito alto"];
export const SCALE_SHORT = ["", "Muito baixa", "Baixa", "Média", "Alta", "Muito alta"];

export const LEVELS: RiskLevel[] = ["critical", "high", "moderate", "low"];
export const LEVEL_LABEL: Record<RiskLevel, string> = { low: "Baixo", moderate: "Moderado", high: "Alto", critical: "Crítico" };

/** Pontuação = probabilidade × impacto (1–25), em quatro faixas da matriz 5×5. */
export function riskLevel(score: number): RiskLevel {
  if (score >= 15) return "critical";
  if (score >= 10) return "high";
  if (score >= 5) return "moderate";
  return "low";
}

export const riskCode = (n: number) => `R-${String(n).padStart(2, "0")}`;

/** Ainda pede atenção: identificado ou em tratamento. Ocorrido vira problema; encerrado sai. */
export const isActive = (r: Pick<Risk, "status">) => r.status === "open" || r.status === "responding";

/** Dias sem reavaliação a partir dos quais o risco ativo pede revisão. */
export const REVIEW_DAYS = 30;

export function needsReview(r: Pick<Risk, "status" | "reviewed_at">, now: Date): boolean {
  return isActive(r) && now.getTime() - new Date(r.reviewed_at).getTime() > REVIEW_DAYS * 86_400_000;
}

export function responseLate(r: Pick<Risk, "status" | "response_due">, today: string): boolean {
  return isActive(r) && !!r.response_due && r.response_due < today;
}

/** Ameaça ativa relevante (moderada para cima) ainda sem estratégia de resposta. */
export function withoutResponse(r: Pick<Risk, "status" | "strategy" | "score">): boolean {
  return isActive(r) && !r.strategy && r.score >= 5;
}

export interface RiskSummary {
  active: Risk[];
  byLevel: Record<RiskLevel, number>;
  byCategory: Record<RiskCategory, number>;
  byStatus: Record<RiskStatus, number>;
  /** matrix[p-1][i-1] = riscos ativos com probabilidade p e impacto i. */
  matrix: number[][];
  noResponse: Risk[];
  review: Risk[];
  late: Risk[];
}

/** Números do painel. Nível, categoria e matriz olham os ativos; situação olha todos. */
export function summarizeRisks(risks: Risk[], today: string, now: Date): RiskSummary {
  const active = risks.filter(isActive);
  const byLevel = { low: 0, moderate: 0, high: 0, critical: 0 };
  const byCategory = { technical: 0, management: 0, commercial: 0, external: 0 };
  const byStatus = { open: 0, responding: 0, occurred: 0, closed: 0 };
  const matrix = Array.from({ length: 5 }, () => [0, 0, 0, 0, 0]);
  for (const r of risks) byStatus[r.status]++;
  for (const r of active) {
    byLevel[riskLevel(r.score)]++;
    byCategory[r.category]++;
    matrix[r.probability - 1][r.impact - 1]++;
  }
  return {
    active,
    byLevel,
    byCategory,
    byStatus,
    matrix,
    noResponse: active.filter(withoutResponse),
    review: active.filter((r) => needsReview(r, now)),
    late: active.filter((r) => responseLate(r, today)),
  };
}

/** Ordem do registro: ativos primeiro, depois maior pontuação, depois código. */
export function sortRisks(risks: Risk[]): Risk[] {
  return [...risks].sort((a, b) => Number(isActive(b)) - Number(isActive(a)) || b.score - a.score || a.number - b.number);
}
