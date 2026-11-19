// Rótulos e utilitários do modo projeto formal. O servidor valida; aqui só se apresenta.
import type { ProjectAttribute } from "./types";

export type Phase = "initiation" | "planning" | "execution" | "monitoring" | "closing";
export type Health = "on_track" | "at_risk" | "late";

/** Linha de GET /portfolio: projeto ativo visível à pessoa, com contagens calculadas no servidor. */
export interface PortfolioRow {
  id: string;
  /** Espaço de origem quando o projeto veio de uma unidade abaixo no organograma. */
  shared_from?: string | null;
  name: string;
  phase: Phase | null;
  approach: string | null;
  sei_process: string | null;
  task_count: number;
  done_count: number;
  doing_count?: number;
  overdue_count: number;
  blocked_count: number;
  health: Health;
  note_stale: boolean;
  last_note_at: string | null;
  cover_version?: string | null;
  summary?: string;
  attributes?: ProjectAttribute[];
  progress?: number | null;
  /** Datas para a esteira: prazos extremos das tarefas, datas do TAP (texto livre) e criação. */
  first_due?: string | null;
  last_due?: string | null;
  tap_start?: string | null;
  tap_end?: string | null;
  created_on?: string | null;
}

export const PHASE_LABEL: Record<Phase, string> = {
  initiation: "Iniciação",
  planning: "Planejamento",
  execution: "Execução",
  monitoring: "Monitoramento e controle",
  closing: "Encerramento",
};
export const APPROACH_LABEL = { agile: "Ágil (Scrum)", waterfall: "Cascata" } as const;
export const HEALTH_LABEL: Record<Health, string> = { on_track: "Em dia", at_risk: "Em risco", late: "Atrasado" };

export type TermKind = "tap" | "tep";
export const TERM_TITLE: Record<TermKind, string> = {
  tap: "Termo de Abertura do Projeto (TAP)",
  tep: "Termo de Encerramento do Projeto (TEP)",
};

export const TERM_FIELDS: Record<TermKind, [string, string][]> = {
  tap: [
    ["objetivo_estrategico", "Objetivo estratégico"],
    ["justificativa", "Justificativa"],
    ["objetivos", "Objetivos (produtos que o projeto gera)"],
    ["escopo", "Escopo"],
    ["nao_escopo", "Não escopo"],
    ["beneficios", "Benefícios esperados"],
    ["grandes_entregas", "Grandes entregas"],
    ["partes_interessadas", "Partes interessadas"],
    ["premissas", "Premissas"],
    ["restricoes", "Restrições"],
    ["custo_estimado", "Custo estimado"],
    ["data_inicio", "Data de início"],
    ["data_termino", "Data de término prevista"],
  ],
  tep: [
    ["objetivo_estrategico", "Objetivo estratégico"],
    ["justificativa", "Justificativa"],
    ["objetivos", "Objetivos"],
    ["escopo", "Escopo final"],
    ["nao_escopo", "Não escopo"],
    ["grandes_entregas", "Entregas"],
    ["custo_real", "Custo financeiro real"],
    ["data_inicio", "Data de início"],
    ["data_termino", "Data de término efetiva"],
    ["encerramento", "Encerramento (necessidades atendidas, problemas resolvidos, benefícios)"],
  ],
};

/** Valores do servidor podem ser texto ou listas; o formulário trabalha só com texto. */
export function asText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    return v
      .map((i) =>
        typeof i === "object" && i
          ? Object.values(i as Record<string, unknown>)
              .filter(Boolean)
              .join(" · ")
          : String(i),
      )
      .map((l) => `- ${l}`)
      .join("\n");
  }
  return JSON.stringify(v);
}

/** Termo em Markdown para baixar ou colar no processo do SEI. Campos vazios ficam de fora. */
export function termToMarkdown(
  kind: TermKind,
  project: string,
  sei: string | null | undefined,
  content: Record<string, unknown>,
): string {
  const out = [`# ${TERM_TITLE[kind]}`, "", `**Projeto:** ${project}`];
  if (sei) out.push(`**Processo SEI:** ${sei}`);
  for (const [key, label] of TERM_FIELDS[kind]) {
    const text = asText(content[key]).trim();
    if (text) out.push("", `## ${label}`, "", text);
  }
  return out.join("\n") + "\n";
}

export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
