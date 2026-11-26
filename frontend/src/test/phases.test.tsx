import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/ui";
import type { Task } from "../domain/types";
import { PhaseList } from "../features/projects/PhaseList";
import { groupByPhase, type Phase } from "../features/projects/phases";
import { api } from "../services/api";

const base: Omit<Task, "id" | "title" | "status"> = { workspace_id: "w1", project_id: "p1", owner_id: null, description: "", priority: "medium", assignee_id: null, assignee_name: null, project_name: "Portal", due_date: null, estimate_minutes: null, progress: 0, phase: null, is_milestone: false, labels: [], version: 1, created_at: "", updated_at: "", parent_id: null, parent_title: null };
const task = (id: string, phase: string | null, extra: Partial<Task> = {}): Task => ({ ...base, id, title: id, status: "todo", phase, ...extra });
const phase = (id: string, name: string, position: number): Phase => ({ id, name, position, task_count: 0, done_count: 0 });

const phases = [phase("f1", "Iniciação", 0), phase("f2", "Execução", 1), phase("f3", "Encerramento", 2)];
const tasks = [
  task("Termo", "Iniciação", { status: "done" }),
  task("Contratar", "Execução"),
  task("Edital", "Execução", { parent_id: "Contratar", parent_title: "Contratar" }),
  task("Avulsa", null),
];

afterEach(() => vi.restoreAllMocks());
const wrap = (ui: ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <MemoryRouter><ToastProvider>{ui}</ToastProvider></MemoryRouter>
    </QueryClientProvider>,
  );
const show = (canWrite = true, shown = tasks, filtering = false) => {
  vi.spyOn(api, "get").mockResolvedValue({ phases, can_write: canWrite } as never);
  wrap(<PhaseList projectId="p1" workspaceId="w1" tasks={tasks} shown={shown} filtering={filtering} canWrite={canWrite} onOpen={() => {}} />);
};

describe("agrupar por fase", () => {
  it("segue a ordem das fases, mantém fase vazia e põe 'sem fase' no fim", () => {
    const g = groupByPhase(tasks, phases);
    expect(g.map((x) => [x.name, x.tasks.map((t) => t.id)])).toEqual([
      ["Iniciação", ["Termo"]],
      ["Execução", ["Contratar", "Edital"]],
      ["Encerramento", []],
      ["", ["Avulsa"]],
    ]);
  });
});

describe("lista por fase", () => {
  it("abre só as fases com trabalho em aberto e recolhe/expande ao clicar", async () => {
    show();
    const toggle = await screen.findByRole("button", { name: /Iniciação, 1 de 1 concluídas/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: /Execução, 0 de 2 concluídas/ })).toHaveAttribute("aria-expanded", "true");
    expect(within(screen.getByRole("list", { name: "Tarefas de Execução" })).getByRole("button", { name: "Edital" })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Tarefas de Iniciação" })).not.toBeInTheDocument();
    await userEvent.setup().click(toggle);
    expect(screen.getByRole("list", { name: "Tarefas de Iniciação" })).toBeInTheDocument();
  });

  it("cria tarefa já dentro da fase", async () => {
    show();
    const post = vi.spyOn(api, "post").mockResolvedValue(task("Nova", "Execução"));
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Nova tarefa em Execução"), "Assinar contrato");
    await user.click(screen.getByRole("button", { name: "Criar tarefa em Execução" }));
    expect(post).toHaveBeenCalledWith("/tasks", { workspace_id: "w1", project_id: "p1", title: "Assinar contrato", phase: "Execução" });
  });

  it("renomeia, reordena e cria fases", async () => {
    show();
    const user = userEvent.setup();
    const patch = vi.spyOn(api, "patch").mockResolvedValue({});
    const put = vi.spyOn(api, "put").mockResolvedValue({});
    const post = vi.spyOn(api, "post").mockResolvedValue({});
    await user.click(await screen.findByRole("button", { name: "Renomear a fase Execução" }));
    const input = screen.getByLabelText("Novo nome da fase Execução");
    await user.clear(input);
    await user.type(input, "Execução e testes{Enter}");
    expect(patch).toHaveBeenCalledWith("/phases/f2", { name: "Execução e testes" });
    await user.click(screen.getByRole("button", { name: "Subir a fase Encerramento" }));
    expect(put).toHaveBeenCalledWith("/projects/p1/phases/order", { ids: ["f1", "f3", "f2"] });
    await user.click(screen.getByRole("button", { name: "Nova fase" }));
    await user.type(screen.getByLabelText("Nome da nova fase"), "Homologação{Enter}");
    expect(post).toHaveBeenCalledWith("/projects/p1/phases", { name: "Homologação" });
  });

  it("quem só lê não vê como mexer nas fases nem criar tarefa", async () => {
    show(false);
    await screen.findByRole("button", { name: /Execução/ });
    expect(screen.queryByRole("button", { name: "Nova fase" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Renomear a fase/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Nova tarefa em/)).not.toBeInTheDocument();
  });

  it("com filtro, mostra só as fases com resultado, todas abertas", async () => {
    show(true, [tasks[0]], true);
    expect(await screen.findByRole("list", { name: "Tarefas de Iniciação" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Fase Execução" })).not.toBeInTheDocument();
  });
});
