import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/ui";
import { compareBaseline, deltaLabel, type Baseline, type BaselineTask } from "../domain/baseline";
import type { Task } from "../domain/types";
import { Timeline } from "../features/projects/Timeline";
import { api } from "../services/api";

const base: Omit<Task, "id" | "title" | "status"> = { workspace_id: "w1", project_id: "p1", owner_id: null, description: "", priority: "medium", assignee_id: null, assignee_name: null, project_name: "Obra", due_date: null, estimate_minutes: null, progress: 0, phase: null, is_milestone: false, labels: [], version: 1, created_at: "2026-11-01T10:00:00Z", updated_at: "", parent_id: null, parent_title: null };
const task = (id: string, title: string, extra: Partial<Task> = {}): Task => ({ ...base, id, title, status: "todo", ...extra });
const planned = (task_id: string, title: string, start_date: string | null, due_date: string): BaselineTask => ({ task_id, title, phase: null, is_milestone: false, start_date, due_date });

// Atual: A atrasou 5 dias, B adiantou 2, C igual, D é nova; E foi removida e F perdeu o prazo.
const tasks = [
  task("a", "Fundação", { start_date: "2026-12-01", due_date: "2026-12-15" }),
  task("b", "Estrutura", { start_date: "2026-12-11", due_date: "2026-12-18" }),
  task("c", "Telhado", { start_date: "2026-12-19", due_date: "2026-12-22" }),
  task("d", "Vistoria", { due_date: "2026-12-23" }),
  task("f", "Pintura"),
];
const items = [
  planned("a", "Fundação", "2026-12-01", "2026-12-10"),
  planned("b", "Estrutura", "2026-12-11", "2026-12-20"),
  planned("c", "Telhado", "2026-12-19", "2026-12-22"),
  planned("e", "Demolição", null, "2026-11-30"),
  planned("f", "Pintura", "2026-12-21", "2026-12-28"),
];

describe("comparação com a linha de base", () => {
  it("separa atrasadas, adiantadas, no plano, novas e as que saíram do cronograma", () => {
    const c = compareBaseline(tasks, items);
    expect(c.late.map((t) => t.id)).toEqual(["a"]);
    expect(c.early.map((t) => t.id)).toEqual(["b"]);
    expect(c.onPlan.map((t) => t.id)).toEqual(["c"]);
    expect(c.added.map((t) => t.id)).toEqual(["d"]);
    expect(c.missing.map((m) => [m.task_id, m.reason])).toEqual([["e", "removida"], ["f", "sem prazo"]]);
    expect(c.finishDelta(tasks[0])).toBe(5);
    // Término do projeto: planejado 28/12 (Pintura) × atual 23/12.
    expect([c.plannedFinish, c.currentFinish, c.projectDelta]).toEqual(["2026-12-28", "2026-12-23", -5]);
  });

  it("rotula o desvio em dias", () => {
    expect([deltaLabel(3), deltaLabel(-2), deltaLabel(0)]).toEqual(["+3 d", "−2 d", "no plano"]);
  });
});

describe("cronograma com linha de base", () => {
  const list: Baseline[] = [
    { id: "b0", number: 0, name: "Linha de base inicial", note: "", created_at: "2026-11-01T10:00:00Z", created_by_name: "Ana", task_count: 3, start: "2026-11-30", finish: "2026-12-20" },
    { id: "b1", number: 1, name: "Plano aprovado", note: "Comitê de novembro", created_at: "2026-11-20T10:00:00Z", created_by_name: "Ana", task_count: 5, start: "2026-11-30", finish: "2026-12-28" },
  ];
  let get: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    localStorage.removeItem("projeta-baseline:p1");
    get = vi.spyOn(api, "get").mockImplementation((path: string) => {
      if (path === "/projects/p1/baselines") return Promise.resolve({ baselines: list, can_manage: true }) as never;
      if (path === "/projects/p1/baselines/b1") return Promise.resolve({ ...list[1], tasks: items }) as never;
      return Promise.reject(new Error(`inesperado: ${path}`)) as never;
    });
  });
  afterEach(() => vi.restoreAllMocks());

  const wrap = (ui: ReactNode) =>
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
        <ToastProvider>
          <MemoryRouter>{ui}</MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );

  it("liga a comparação com a mais recente, mostra desvios e filtra pelo resumo", async () => {
    wrap(<Timeline tasks={tasks} canWrite={false} onOpen={() => {}} projectId="p1" />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Linha de base/ }));
    expect(get).toHaveBeenCalledWith("/projects/p1/baselines/b1");

    const summary = await screen.findByRole("group", { name: "Comparação com LB 1 · Plano aprovado" });
    expect(within(summary).getByText("−5 d")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Fundação.*Na linha de base: 01\/12\/26 → 10\/12\/26 \(5 dias depois do planejado\)/ })).toBeInTheDocument();
    expect(screen.getByText("+5 d", { selector: ".g-var" })).toBeInTheDocument();
    expect(screen.getByText("nova", { selector: ".g-var" })).toBeInTheDocument();

    // Só as atrasadas.
    await user.click(within(summary).getByRole("button", { name: /1 atrasou/ }));
    expect(screen.getByRole("button", { name: "Fundação" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Estrutura" })).toBeNull();

    // As que saíram do cronograma aparecem só com o planejado.
    await user.click(within(summary).getByRole("button", { name: /2 fora do cronograma/ }));
    expect(screen.getByRole("img", { name: /Demolição: planejada até 30\/11\/26; a tarefa foi removida/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pintura" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Mostrar todas/ }));
    expect(screen.getByRole("button", { name: "Estrutura" })).toBeInTheDocument();
    expect(localStorage.getItem("projeta-baseline:p1")).toBe("b1");
  });

  it("salva uma nova linha de base pelo diálogo", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue({ ...list[1], id: "b2", number: 2, name: "Replanejamento" });
    wrap(<Timeline tasks={tasks} canWrite onOpen={() => {}} projectId="p1" />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Linhas de base: salvar e gerenciar" }));
    const dialog = screen.getByRole("dialog", { name: "Linhas de base" });
    expect(within(dialog).getByText("LB 0 · Linha de base inicial")).toBeInTheDocument();
    // A inicial não tem botão de excluir; as outras têm.
    expect(within(dialog).queryByRole("button", { name: "Excluir LB 0 · Linha de base inicial" })).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Excluir LB 1 · Plano aprovado" })).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("Nome"), "Replanejamento");
    await user.click(within(dialog).getByRole("button", { name: "Salvar linha de base" }));
    expect(post).toHaveBeenCalledWith("/projects/p1/baselines", { name: "Replanejamento", note: "" });
  });
});
