import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  capacityOf,
  daysLeftLabel,
  deliveryOf,
  fmtHours,
  groupSprints,
  paceOf,
  positionBetween,
  tasksIn,
  type Sprint,
  type SprintSummary,
} from "../domain/sprint";
import type { Task } from "../domain/types";
import { CloseSprintDialog } from "../features/sprints/SprintDialogs";
import { SprintsView } from "../features/sprints/SprintsView";
import { api } from "../services/api";

afterEach(() => vi.restoreAllMocks());

const sprint = (over: Partial<Sprint> = {}): Sprint => ({
  id: "s1",
  project_id: "p1",
  number: 1,
  name: "Sprint 1",
  goal: "Publicar a busca",
  start_date: "2026-11-24",
  end_date: "2026-12-07",
  status: "active",
  capacity_minutes: 600,
  summary: null,
  version: 1,
  days_total: 14,
  days_elapsed: 5,
  days_left: 9,
  overdue: false,
  stats: { tasks: 4, done: 1, minutes: 480, done_minutes: 60, unestimated: 0 },
  load: [],
  ...over,
});

const task = (over: Partial<Task> = {}): Task => ({
  id: "t1",
  workspace_id: "w1",
  project_id: "p1",
  owner_id: null,
  title: "Tarefa",
  description: "",
  status: "todo",
  priority: "medium",
  assignee_id: null,
  assignee_name: null,
  project_name: "Portal",
  due_date: null,
  estimate_minutes: null,
  progress: 0,
  phase: null,
  is_milestone: false,
  labels: [],
  version: 1,
  created_at: "2026-11-20T10:00:00Z",
  updated_at: "2026-11-20T10:00:00Z",
  sprint_id: null,
  position: 1,
  ...over,
});

function wrap(children: ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("regras de sprint", () => {
  it("fala em horas", () => {
    expect(fmtHours(90)).toBe("1h30");
    expect(fmtHours(120)).toBe("2h");
    expect(fmtHours(45)).toBe("45min");
  });
  it("ordena: ativa, planejadas pela data, encerradas da mais recente", () => {
    const g = groupSprints([
      sprint({ id: "a", status: "closed", start_date: "2026-10-01" }),
      sprint({ id: "b", status: "planned", start_date: "2026-12-22" }),
      sprint({ id: "c", status: "active" }),
      sprint({ id: "d", status: "planned", start_date: "2026-12-08" }),
      sprint({ id: "e", status: "closed", start_date: "2026-11-01" }),
    ]);
    expect(g.open.map((s) => s.id)).toEqual(["c", "d", "b"]);
    expect(g.closed.map((s) => s.id)).toEqual(["e", "a"]);
  });
  it("compara estimativas com a capacidade", () => {
    expect(capacityOf(sprint({ capacity_minutes: null }))).toEqual({ pct: 0, state: "none" });
    expect(capacityOf(sprint()).state).toBe("ok");
    expect(capacityOf(sprint({ capacity_minutes: 540 })).state).toBe("tight");
    expect(capacityOf(sprint({ capacity_minutes: 300 }))).toEqual({ pct: 160, state: "over" });
  });
  it("aponta ritmo abaixo do tempo com o mesmo critério dos OKRs", () => {
    expect(paceOf(sprint())).toEqual({ done: 25, time: 36, behind: false });
    expect(paceOf(sprint({ days_elapsed: 10 })).behind).toBe(true);
  });
  it("diz quanto falta", () => {
    expect(daysLeftLabel(sprint())).toBe("Faltam 9 dias");
    expect(daysLeftLabel(sprint({ days_left: 0 }))).toBe("Último dia");
    expect(daysLeftLabel(sprint({ overdue: true }))).toBe("Terminou — falta encerrar");
    expect(daysLeftLabel(sprint({ status: "planned", days_elapsed: 0, days_left: 14 }))).toBe("Ainda não começou");
  });
  it("mede a entrega sobre o escopo real da sprint", () => {
    const sum: SprintSummary = {
      goal: "",
      planned_end: "2026-12-07",
      committed: { tasks: 4, minutes: 0 },
      added: { tasks: 1, minutes: 0 },
      removed: 1,
      done: { tasks: 3, minutes: 0 },
      not_done: { tasks: 1, minutes: 0 },
      unestimated: 0,
      carried: { to: null, items: [] },
    };
    expect(deliveryOf(sum)).toEqual({ pct: 75, scope: 4 });
  });
  it("backlog: só tarefas principais abertas, na ordem de prioridade", () => {
    const list = [
      task({ id: "b", position: 2 }),
      task({ id: "a", position: 1 }),
      task({ id: "feita", position: 0, status: "done" }),
      task({ id: "sub", position: 0, parent_id: "a" }),
      task({ id: "na-sprint", position: 0, sprint_id: "s1" }),
    ];
    expect(tasksIn(list, null).map((t) => t.id)).toEqual(["a", "b"]);
    expect(tasksIn(list, "s1").map((t) => t.id)).toEqual(["na-sprint"]);
  });
  it("calcula a posição entre vizinhos para reordenar", () => {
    const list = [{ id: "a", position: 1 }, { id: "b", position: 2 }, { id: "c", position: 3 }];
    expect(positionBetween(list, "c", "a")).toBe(0);
    expect(positionBetween(list, "c", "b")).toBe(1.5);
    expect(positionBetween(list, "a", null)).toBe(4);
  });
});

describe("tela de sprints", () => {
  const data = (over = {}) => ({
    sprints: [sprint(), sprint({ id: "s2", number: 2, name: "Sprint 2", status: "planned", goal: "", stats: { tasks: 0, done: 0, minutes: 0, done_minutes: 0, unestimated: 0 } })],
    backlog_open: 1,
    today: "2026-11-28",
    can_manage: true,
    can_write: true,
    ...over,
  });

  it("mostra backlog e sprints; leva tarefa para a sprint pelo seletor", async () => {
    vi.spyOn(api, "get").mockResolvedValue(data());
    const patch = vi.spyOn(api, "patch").mockResolvedValue({});
    const tasks = [task({ id: "t1", title: "Indexar", estimate_minutes: 90 }), task({ id: "t2", title: "Na sprint", sprint_id: "s1" })];
    wrap(<SprintsView projectId="p1" tasks={tasks} onOpen={() => {}} />);
    const backlog = await screen.findByRole("region", { name: /Backlog/ });
    expect(within(backlog).getByText("Indexar")).toBeInTheDocument();
    expect(within(backlog).getByText("1h30")).toBeInTheDocument();
    const s1 = screen.getByRole("region", { name: "Sprint 1, Em andamento" });
    expect(within(s1).getByText("Na sprint")).toBeInTheDocument();
    expect(within(s1).getByText(/8h de 10h \(80%\)/)).toBeInTheDocument();
    // Sem meta, a planejada avisa; e não pode iniciar enquanto outra está em andamento.
    const s2 = screen.getByRole("region", { name: "Sprint 2, Planejada" });
    expect(within(s2).getByText(/Sem meta/)).toBeInTheDocument();
    expect(within(s2).getByRole("button", { name: /Iniciar/ })).toBeDisabled();
    await userEvent.setup().selectOptions(within(backlog).getByLabelText("Colocar “Indexar” numa sprint"), "s2");
    expect(patch).toHaveBeenCalledWith("/tasks/t1", { sprint_id: "s2", expected_version: 1 });
  });

  it("quem não gere não vê planejar, iniciar nem encerrar", async () => {
    vi.spyOn(api, "get").mockResolvedValue(data({ can_manage: false, can_write: false }));
    wrap(<SprintsView projectId="p1" tasks={[task()]} onOpen={() => {}} />);
    await screen.findByRole("region", { name: "Sprint 1, Em andamento" });
    expect(screen.queryByRole("button", { name: /Planejar sprint/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Encerrar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Subir/ })).not.toBeInTheDocument();
  });

  it("encerrar pergunta o destino do que não terminou", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue({ sprint: sprint({ status: "closed" }), next: null });
    const tasks = [
      task({ id: "a", title: "Feita", sprint_id: "s1", status: "done" }),
      task({ id: "b", title: "Aberta", sprint_id: "s1" }),
    ];
    wrap(<CloseSprintDialog sprint={sprint()} tasks={tasks} onClose={() => {}} />);
    expect(screen.getByText((_, el) => el?.tagName === "P" && /^1 de 2 tarefas concluídas/.test(el.textContent ?? ""))).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /nova sprint/ })).toBeChecked();
    await userEvent.setup().click(screen.getByRole("radio", { name: /backlog/ }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Encerrar sprint" }));
    expect(post).toHaveBeenCalledWith("/sprints/s1/close", { carry_to: "backlog" });
  });
});
