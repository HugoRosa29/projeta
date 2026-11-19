import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project, Task } from "../domain/types";
import { attributeIndex, attributeValue, nestTasks, projectProgress, subtaskCounts } from "../domain/work";
import { ProjectDetails } from "../features/projects/ProjectDetails";
import { TaskDialog, TaskList } from "../features/tasks/TaskParts";
import { api } from "../services/api";

const base: Omit<Task, "id" | "title" | "status"> = { workspace_id: "w1", project_id: "p1", owner_id: null, description: "", priority: "medium", assignee_id: null, assignee_name: null, project_name: "CNPJ", due_date: null, estimate_minutes: null, progress: 0, phase: null, is_milestone: false, labels: [], version: 1, created_at: "", updated_at: "" };
const task = (id: string, title: string, extra: Partial<Task> = {}): Task => ({ ...base, id, title, status: "todo", parent_id: null, parent_title: null, ...extra });

afterEach(() => vi.restoreAllMocks());
const wrap = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>{ui}</QueryClientProvider>);

describe("subtarefas na lista", () => {
  const mae = task("m", "Adequar sistemas");
  const a = task("a", "GAI", { parent_id: "m", parent_title: "Adequar sistemas", status: "done" });
  const b = task("b", "Portal", { parent_id: "m", parent_title: "Adequar sistemas" });
  const solta = task("s", "Outra");

  it("agrupa sob a mãe e mostra a subtarefa sozinha quando a mãe foi filtrada", () => {
    expect(nestTasks([a, mae, solta, b]).map((n) => [n.task.id, n.children.map((c) => c.id)])).toEqual([
      ["m", ["a", "b"]],
      ["s", []],
    ]);
    expect(nestTasks([b]).map((n) => n.task.id)).toEqual(["b"]);
    expect(subtaskCounts([mae, a, b]).get("m")).toEqual([1, 2]);
  });

  it("exibe a contagem na mãe e recua as subtarefas", () => {
    wrap(<MemoryRouter><TaskList tasks={[mae, a, b]} onOpen={() => {}} /></MemoryRouter>);
    expect(screen.getByLabelText("1 de 2 subtarefas concluídas")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Portal" }).closest("li")).toHaveClass("subtask");
  });
});

describe("campos livres", () => {
  it("indexa nomes sem diferenciar maiúsculas e ordena valores", () => {
    const idx = attributeIndex([[{ name: "Complexidade", value: "Média" }], [{ name: "complexidade", value: "Alta" }, { name: "PDTI", value: "Sim" }], undefined]);
    expect([...idx.keys()]).toEqual(["Complexidade", "PDTI"]);
    expect(idx.get("Complexidade")).toEqual(["Alta", "Média"]);
    expect(attributeValue([{ name: "PDTI", value: "Sim" }], "pdti")).toBe("Sim");
  });

  it("salva os campos junto com a ficha do projeto", async () => {
    const project: Project = { id: "p1", workspace_id: "w1", name: "ERP", description: "", status: "active", task_count: 0, done_count: 0, last_activity: null, attributes: [{ name: "PDTI", value: "Sim" }] };
    vi.spyOn(api, "get").mockResolvedValue({ projects: [project] });
    const patch = vi.spyOn(api, "patch").mockResolvedValue({});
    const user = userEvent.setup();
    wrap(<ProjectDetails project={project} canManage />);
    expect(screen.getByText("PDTI")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Editar informações" }));
    await user.click(screen.getByRole("button", { name: "Adicionar campo" }));
    await user.type(screen.getByLabelText("Nome do campo 2"), "Complexidade");
    await user.type(screen.getByLabelText("Valor de Complexidade"), "Alta");
    await user.click(screen.getByRole("button", { name: "Remover PDTI" }));
    await user.click(screen.getByRole("button", { name: "Salvar informações" }));
    expect(patch).toHaveBeenCalledWith("/projects/p1", expect.objectContaining({ attributes: [{ name: "Complexidade", value: "Alta" }] }));
  });
});

describe("ficha da tarefa", () => {
  const mae = task("m", "Adequar sistemas");
  const filha = task("a", "GAI", { parent_id: "m", parent_title: "Adequar sistemas" });
  const comment = { id: "c1", author_name: "Ana", body: "Fábrica entregou\n2 sistemas", created_at: "2026-11-13T12:00:00Z", edited_at: null, can_edit: true, can_delete: true };

  function mockGet(canWrite: boolean) {
    return vi.spyOn(api, "get").mockImplementation(async (path: string) => {
      if (path.endsWith("/comments")) return { comments: [comment] };
      return { task: mae, can_write: canWrite, can_comment: canWrite, depends_on: [], subtasks: [filha] };
    });
  }

  it("lista e cria subtarefas ligadas à mãe", async () => {
    mockGet(true);
    const post = vi.spyOn(api, "post").mockResolvedValue(filha);
    const user = userEvent.setup();
    wrap(<TaskDialog taskId="m" onClose={() => {}} />);
    const section = await screen.findByRole("region", { name: /Subtarefas/ });
    expect(within(section).getByText("GAI")).toBeInTheDocument();
    await user.type(within(section).getByLabelText("Nova subtarefa"), "Portal{Enter}");
    expect(post).toHaveBeenCalledWith("/tasks", { workspace_id: "w1", project_id: "p1", title: "Portal", parent_id: "m" });
  });

  it("mostra comentários em texto puro e envia um novo", async () => {
    mockGet(true);
    const post = vi.spyOn(api, "post").mockResolvedValue(comment);
    const user = userEvent.setup();
    wrap(<TaskDialog taskId="m" onClose={() => {}} />);
    expect(await screen.findByText(/Fábrica entregou/)).toHaveClass("comment-body");
    await user.type(screen.getByLabelText("Novo comentário"), "Meta da semana: 4 sistemas");
    await user.click(screen.getByRole("button", { name: "Comentar" }));
    expect(post).toHaveBeenCalledWith("/tasks/m/comments", { body: "Meta da semana: 4 sistemas" });
  });

  it("leitura não oferece comentar nem criar subtarefa", async () => {
    mockGet(false);
    wrap(<TaskDialog taskId="m" onClose={() => {}} />);
    expect(await screen.findByText(/Fábrica entregou/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Novo comentário")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Nova subtarefa")).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "GAI" })).toBeDisabled();
  });
});

describe("percentual do projeto", () => {
  it("usa o informado quando existe e calcula pelas tarefas quando não", () => {
    expect(projectProgress({ progress: 90, task_count: 3, done_count: 0 })).toEqual({ pct: 90, informed: true });
    expect(projectProgress({ progress: 0, task_count: 2, done_count: 2 })).toEqual({ pct: 0, informed: true });
    expect(projectProgress({ progress: null, task_count: 4, done_count: 1 })).toEqual({ pct: 25, informed: false });
    expect(projectProgress({ task_count: 0, done_count: 0 })).toEqual({ pct: 0, informed: false });
  });

  it("envia o percentual informado e null quando o campo fica vazio", async () => {
    const project: Project = { id: "p1", workspace_id: "w1", name: "ERP", description: "", status: "active", task_count: 0, done_count: 0, last_activity: null, progress: 60 };
    vi.spyOn(api, "get").mockResolvedValue({ projects: [project] });
    const patch = vi.spyOn(api, "patch").mockResolvedValue({});
    const user = userEvent.setup();
    wrap(<ProjectDetails project={project} canManage />);
    await user.click(screen.getByRole("button", { name: "Editar informações" }));
    const input = screen.getByLabelText("% concluído informado");
    expect(input).toHaveValue(60);
    await user.clear(input);
    await user.type(input, "80");
    await user.click(screen.getByRole("button", { name: "Salvar informações" }));
    expect(patch).toHaveBeenLastCalledWith("/projects/p1", expect.objectContaining({ progress: 80 }));
    await user.click(screen.getByRole("button", { name: "Editar informações" }));
    await user.clear(screen.getByLabelText("% concluído informado"));
    await user.click(screen.getByRole("button", { name: "Salvar informações" }));
    expect(patch).toHaveBeenLastCalledWith("/projects/p1", expect.objectContaining({ progress: null }));
  });
});
