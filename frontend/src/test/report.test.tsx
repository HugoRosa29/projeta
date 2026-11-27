import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { ReportSheet } from "../features/projects/ProjectReport";
import { buildReport, longDate, type StatusNote } from "../domain/report";
import type { Risk } from "../domain/risk";
import type { Sprint } from "../domain/sprint";
import type { Project, Status, Task } from "../domain/types";

const today = "2026-11-27";
const now = new Date("2026-11-27T12:00:00Z");
const project: Project = { id: "p1", workspace_id: "w1", name: "Novo ERP", summary: "Troca do sistema financeiro", description: "", responsible: "Ana", requester: "DIFIN", status: "active", task_count: 0, done_count: 0, last_activity: null, attributes: [{ name: "Término", value: "31/12/2026" }, { name: "Custo estimado", value: "R$ 2 mi" }] };

const base: Omit<Task, "id" | "title" | "status" | "due_date"> = { workspace_id: "w1", project_id: "p1", owner_id: null, description: "", priority: "medium", assignee_id: null, assignee_name: "Bruno", project_name: "Novo ERP", estimate_minutes: null, progress: 0, phase: null, is_milestone: false, labels: [], version: 1, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" };
const t = (id: string, due: string | null, status: Status = "todo", extra: Partial<Task> = {}): Task => ({ ...base, id, title: id, status, due_date: due, ...extra });

const risk = (n: number, score: number, status: Risk["status"] = "open"): Risk => ({ id: `r${n}`, number: n, kind: "threat", title: `Risco ${n}`, cause: "", effect: "", category: "technical", probability: 1, impact: score, score, affects: [], strategy: null, response: "", contingency: "", trigger_signal: "", owner_id: null, owner_name: null, response_due: null, status, reviewed_at: "2026-11-20T00:00:00Z", version: 1, created_at: "", updated_at: "" });

const tasks = [
  t("Levantar requisitos", "2026-10-15", "done", { phase: "Planejamento", updated_at: "2026-11-20T10:00:00Z" }),
  t("Contratar fornecedor", "2026-11-10", "doing", { phase: "Execução" }),
  t("Migrar dados", "2026-12-05", "blocked", { phase: "Execução" }),
  t("Homologação", "2026-12-20", "todo", { phase: "Execução", is_milestone: true }),
  t("Treinamento", "2027-02-01", "todo", { phase: "Execução" }),
  t("Kickoff", "2026-09-01", "done", { phase: "Planejamento", updated_at: "2026-09-02T10:00:00Z" }),
];
const note: StatusNote = { id: "n1", state: "at_risk", delay_reason: "Fornecedor atrasou", done: "Requisitos aprovados", pending: "Contrato", blockers: "", author_name: "Ana", created_at: "2026-11-25T10:00:00Z" };

const input = { project, tasks, risks: [risk(1, 4), risk(2, 20), risk(3, 12, "closed")], sprints: [] as Sprint[], notes: [note], phaseOrder: ["Iniciação", "Planejamento", "Execução"], today, now };

describe("relatório de andamento", () => {
  const r = buildReport(input);

  it("resume progresso e estados das tarefas", () => {
    expect(r.progress).toEqual({ pct: 33, informed: false, done: 2, total: 6 });
    expect(r.byStatus).toEqual({ todo: 2, doing: 1, blocked: 1, done: 2 });
  });

  it("usa o % informado quando há", () => {
    expect(buildReport({ ...input, project: { ...project, progress: 70 } }).progress).toMatchObject({ pct: 70, informed: true });
  });

  it("toma o término do campo do portfólio, como o Portfólio", () => {
    expect(r.schedule.end).toBe("2026-12-31");
    expect(r.schedule.daysLeft).toBe(34);
  });

  it("separa atrasadas, bloqueadas, próximas entregas e concluídas no período", () => {
    expect(r.late.map((x) => x.id)).toEqual(["Contratar fornecedor"]);
    expect(r.blocked.map((x) => x.id)).toEqual(["Migrar dados"]);
    expect(r.upcoming.map((x) => x.id)).toEqual(["Migrar dados", "Homologação"]);
    expect(r.recentDone.map((x) => x.id)).toEqual(["Levantar requisitos"]);
    expect(r.milestones.map((x) => x.id)).toEqual(["Homologação"]);
  });

  it("segue a ordem das fases e omite fase sem tarefas", () => {
    expect(r.phases).toEqual([
      { name: "Planejamento", total: 2, done: 2, pct: 100 },
      { name: "Execução", total: 4, done: 0, pct: 0 },
    ]);
  });

  it("lista só riscos ativos, o mais grave primeiro", () => {
    expect(r.risks.top.map((k) => k.number)).toEqual([2, 1]);
    expect(r.risks.summary.active).toHaveLength(2);
  });

  it("traz a nota de acompanhamento mais recente", () => {
    expect(r.note?.id).toBe("n1");
  });

  it("escreve a data por extenso", () => {
    expect(longDate(today)).toBe("27 de novembro de 2026");
  });
});

it("monta a folha com cabeçalho, indicadores e seções", () => {
  render(
    <MemoryRouter>
      <ReportSheet project={project} members={[]} report={buildReport(input)} today={today} author="Carla" />
    </MemoryRouter>,
  );
  const sheet = screen.getByRole("article", { name: "Relatório de andamento: Novo ERP" });
  expect(within(sheet).getByRole("heading", { level: 1, name: "Novo ERP" })).toBeInTheDocument();
  expect(within(sheet).getByText(/Emitido em 27 de novembro de 2026/)).toBeInTheDocument();
  expect(within(sheet).getByText("33%")).toBeInTheDocument();
  expect(within(sheet).getByText("Fornecedor atrasou")).toBeInTheDocument();
  expect(within(sheet).getByText("Em risco")).toBeInTheDocument();
  const attention = within(sheet).getByRole("heading", { name: /Pontos de atenção/ }).parentElement!;
  expect(within(attention).getByText("Contratar fornecedor")).toBeInTheDocument();
  expect(within(attention).getByText("Migrar dados")).toBeInTheDocument();
  expect(within(sheet).getByText("R-02")).toBeInTheDocument();
  expect(within(sheet).queryByText("R-03")).not.toBeInTheDocument();
  expect(within(sheet).getByText("R$ 2 mi")).toBeInTheDocument();
});
