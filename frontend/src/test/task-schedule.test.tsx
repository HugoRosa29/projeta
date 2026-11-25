import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Task } from "../domain/types";
import { dependencyCandidates, scheduleConflicts } from "../domain/work";
import { Timeline } from "../features/projects/Timeline";
import { DueBadge, TaskList } from "../features/tasks/TaskParts";
import { api } from "../services/api";

const base: Omit<Task, "id" | "title" | "status"> = { workspace_id: "w1", project_id: "p1", owner_id: null, description: "", priority: "medium", assignee_id: null, assignee_name: null, project_name: "CNPJ", due_date: null, estimate_minutes: null, progress: 0, phase: null, is_milestone: false, labels: [], version: 2, created_at: "", updated_at: "", parent_id: null, parent_title: null };
const task = (id: string, extra: Partial<Task> = {}): Task => ({ ...base, id, title: id.toUpperCase(), status: "todo", ...extra });

afterEach(() => vi.restoreAllMocks());
const wrap = (ui: ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );

describe("candidatas a dependência", () => {
  it("não oferece a própria tarefa, as já ligadas nem as que formariam ciclo", () => {
    // c depende de b, que depende de a: a não pode passar a depender de b nem de c.
    const a = task("a");
    const b = task("b", { depends_on_ids: ["a"] });
    const c = task("c", { depends_on_ids: ["b"] });
    const d = task("d");
    const outro = task("x", { project_id: "p2" });
    const all = [a, b, c, d, outro];
    expect(dependencyCandidates(a, all).map((t) => t.id)).toEqual(["d"]);
    expect(dependencyCandidates(c, all).map((t) => t.id)).toEqual(["a", "d"]);
    expect(dependencyCandidates(task("p", { project_id: null }), all)).toEqual([]);
  });
});

describe("conflito de datas", () => {
  const prev = task("a", { due_date: "2026-12-10" });
  it("aponta dependência que termina depois do início", () => {
    expect(scheduleConflicts(task("b", { start_date: "2026-12-05", due_date: "2026-12-20", depends_on_ids: ["a"] }), [prev])).toEqual([prev]);
  });
  it("aceita começar no dia em que a anterior termina, e ignora a anterior concluída", () => {
    expect(scheduleConflicts(task("b", { start_date: "2026-12-10", depends_on_ids: ["a"] }), [prev])).toEqual([]);
    expect(scheduleConflicts(task("b", { start_date: "2026-12-05", depends_on_ids: ["a"] }), [{ ...prev, status: "done" }])).toEqual([]);
  });
  it("sem início, compara com o prazo", () => {
    expect(scheduleConflicts(task("b", { due_date: "2026-12-08", depends_on_ids: ["a"] }), [prev])).toEqual([prev]);
  });
});

describe("selo de datas", () => {
  it("mostra o período quando há início", () => {
    wrap(<DueBadge task={task("a", { start_date: "2026-12-01", due_date: "2026-12-10" })} today="2026-11-24" />);
    expect(screen.getByText("01/12/26 → 10/12/26")).toBeInTheDocument();
  });
});

describe("dependência pela lista", () => {
  const a = task("a", { title: "Levantar requisitos" });
  const b = task("b", { title: "Homologar", depends_on_ids: [] });

  it("liga uma tarefa a outra sem abrir a ficha", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue(undefined);
    wrap(<TaskList tasks={[a, b]} onOpen={() => {}} dependencies={{ canWrite: true }} />);
    await userEvent.setup().selectOptions(screen.getByLabelText("Dependências de Homologar"), "add:a");
    expect(post).toHaveBeenCalledWith("/tasks/b/dependencies", { depends_on_id: "a" });
  });

  it("desliga e mostra o que a tarefa aguarda", async () => {
    const del = vi.spyOn(api, "del").mockResolvedValue(undefined);
    const linked = { ...b, depends_on_ids: ["a"] };
    wrap(<TaskList tasks={[a, linked]} onOpen={() => {}} dependencies={{ canWrite: true }} />);
    expect(screen.getByText(/Aguarda Levantar requisitos/)).toBeInTheDocument();
    await userEvent.setup().selectOptions(screen.getByLabelText("Dependências de Homologar"), "del:a");
    expect(del).toHaveBeenCalledWith("/tasks/b/dependencies/a");
  });

  it("quem só lê vê a dependência, mas não o seletor", () => {
    wrap(<TaskList tasks={[a, { ...b, depends_on_ids: ["a"] }]} onOpen={() => {}} dependencies={{ canWrite: false }} />);
    expect(screen.getByText(/Aguarda Levantar requisitos/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Dependências de Homologar")).toBeNull();
  });
});

describe("arrastar na lista", () => {
  const a = task("a", { title: "Levantar requisitos" });
  const b = task("b", { title: "Homologar" });
  const dt = () => ({ setData: () => {}, getData: () => "", effectAllowed: "", dropEffect: "" });

  it("soltar uma tarefa sobre outra faz a de baixo depender da arrastada", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue(undefined);
    wrap(<TaskList tasks={[a, b]} onOpen={() => {}} dependencies={{ canWrite: true }} />);
    const [rowA, rowB] = screen.getAllByRole("listitem");
    const dataTransfer = dt();
    fireEvent.dragStart(rowA, { dataTransfer });
    fireEvent.dragOver(rowB, { dataTransfer });
    expect(screen.getByText(/Solte: começa depois de/)).toBeInTheDocument();
    fireEvent.drop(rowB, { dataTransfer });
    await vi.waitFor(() => expect(post).toHaveBeenCalledWith("/tasks/b/dependencies", { depends_on_id: "a" }));
  });

  it("não aceita soltar onde formaria ciclo", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue(undefined);
    wrap(<TaskList tasks={[a, { ...b, depends_on_ids: ["a"] }]} onOpen={() => {}} dependencies={{ canWrite: true }} />);
    const [rowA, rowB] = screen.getAllByRole("listitem");
    const dataTransfer = dt();
    fireEvent.dragStart(rowB, { dataTransfer });
    fireEvent.drop(rowA, { dataTransfer });
    await new Promise((r) => setTimeout(r, 20));
    expect(post).not.toHaveBeenCalled();
  });
});

describe("cronograma com dependências", () => {
  const a = task("a", { title: "Levantar requisitos", start_date: "2026-12-01", due_date: "2026-12-05" });
  const b = task("b", { title: "Homologar", start_date: "2026-12-08", due_date: "2026-12-12" });

  it("clicar na bolinha e depois na tarefa cria a dependência", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue(undefined);
    wrap(<Timeline tasks={[a, b]} canWrite onOpen={() => {}} />);
    const user = userEvent.setup();
    await user.click(screen.getByLabelText("Ligar “Levantar requisitos” a uma tarefa que vem depois"));
    expect(screen.getByRole("status")).toHaveTextContent("só começa depois de Levantar requisitos");
    await user.click(screen.getByRole("button", { name: "Homologar" }));
    expect(post).toHaveBeenCalledWith("/tasks/b/dependencies", { depends_on_id: "a" });
  });

  it("pelo teclado também liga, e Esc cancela", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue(undefined);
    wrap(<Timeline tasks={[a, b]} canWrite onOpen={() => {}} />);
    const user = userEvent.setup();
    screen.getByLabelText("Ligar “Levantar requisitos” a uma tarefa que vem depois").focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("status")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("status")).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });

  it("quem só lê não vê as alças de ligação", () => {
    wrap(<Timeline tasks={[a, b]} canWrite={false} onOpen={() => {}} />);
    expect(screen.queryByLabelText(/Ligar “/)).toBeNull();
  });
});
