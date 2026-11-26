import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { TaskDialog, TaskTags } from "../features/tasks/TaskParts";
import { api } from "../services/api";

const task = { id: "t1", title: "Entrega", priority: "medium", labels: ["EXISTENTE"], status: "todo", version: 3, description: "", project_id: null, due_date: null };
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
afterEach(() => vi.restoreAllMocks());

it("exibe prioridade e tags em conjunto, com urgente em destaque", () => {
  render(<TaskTags task={{ priority: "urgent", labels: ["REVISÃO"] }} />);
  expect(screen.getByLabelText("Prioridade: Urgente")).toHaveTextContent("URGENTE");
  expect(screen.getByLabelText("Prioridade: Urgente")).toHaveClass("priority-tag-urgent");
  expect(screen.getByText("REVISÃO")).toBeInTheDocument();
});

it("salva prioridade urgente e tags sem apagar etiquetas anteriores", async () => {
  vi.spyOn(api, "get").mockResolvedValue({ task, can_write: true, depends_on: [], blocks: [] });
  const patch = vi.spyOn(api, "patch").mockResolvedValue(task);
  render(<QueryClientProvider client={client()}><TaskDialog taskId="t1" onClose={() => {}} /></QueryClientProvider>);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("radio", { name: "Urgente" }));
  await user.type(screen.getByLabelText("Tags"), ", revisão, revisão");
  await user.click(screen.getByRole("button", { name: "Salvar" }));
  expect(patch).toHaveBeenCalledWith("/tasks/t1", { expected_version: 3, priority: "urgent", labels: ["EXISTENTE", "REVISÃO"] });
});

it("impede edição das etiquetas para acesso somente leitura", async () => {
  vi.spyOn(api, "get").mockResolvedValue({ task, can_write: false, depends_on: [], blocks: [] });
  render(<QueryClientProvider client={client()}><TaskDialog taskId="t1" onClose={() => {}} /></QueryClientProvider>);
  expect(await screen.findByLabelText("Tags")).toBeDisabled();
  expect(screen.getByRole("group", { name: "Prioridade" })).toBeDisabled();
  expect(screen.getByRole("radio", { name: "Urgente" })).toBeDisabled();
});

it("tarefa de projeto escolhe a sprint; encerradas não aparecem como destino", async () => {
  const projTask = { ...task, project_id: "p1", sprint_id: null };
  vi.spyOn(api, "get").mockImplementation((path: string) =>
    Promise.resolve(
      path === "/projects/p1/sprints"
        ? { sprints: [
            { id: "s1", name: "Sprint 1", status: "closed" },
            { id: "s2", name: "Sprint 2", status: "active" },
          ] }
        : { task: projTask, can_write: true, depends_on: [], blocks: [] },
    ) as never,
  );
  const patch = vi.spyOn(api, "patch").mockResolvedValue(projTask);
  render(<QueryClientProvider client={client()}><TaskDialog taskId="t1" members={[]} onClose={() => {}} /></QueryClientProvider>);
  const user = userEvent.setup();
  const select = await screen.findByLabelText("Sprint");
  await screen.findByRole("option", { name: "Sprint 2 (em andamento)" });
  expect(screen.queryByRole("option", { name: /Sprint 1/ })).not.toBeInTheDocument();
  await user.selectOptions(select, "s2");
  await user.click(screen.getByRole("button", { name: "Salvar" }));
  expect(patch).toHaveBeenCalledWith("/tasks/t1", { expected_version: 3, sprint_id: "s2" });
});

it("tags viram fichas: Enter adiciona, o X remove, e o estado troca com um clique", async () => {
  vi.spyOn(api, "get").mockResolvedValue({ task, can_write: true, depends_on: [], blocks: [] });
  const patch = vi.spyOn(api, "patch").mockResolvedValue(task);
  render(<QueryClientProvider client={client()}><TaskDialog taskId="t1" onClose={() => {}} /></QueryClientProvider>);
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Tags"), "gov.br{Enter}");
  expect(screen.getByText("GOV.BR")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Remover tag EXISTENTE" }));
  await user.click(screen.getByRole("radio", { name: "Em andamento" }));
  await user.click(screen.getByRole("button", { name: "Salvar" }));
  expect(patch).toHaveBeenCalledWith("/tasks/t1", { expected_version: 3, status: "doing", labels: ["GOV.BR"] });
});

it("sem alteração, Salvar fica indisponível; com alteração, fechar pede confirmação", async () => {
  vi.spyOn(api, "get").mockResolvedValue({ task, can_write: true, depends_on: [], blocks: [] });
  const onClose = vi.fn();
  const ask = vi.spyOn(window, "confirm").mockReturnValue(false);
  render(<QueryClientProvider client={client()}><TaskDialog taskId="t1" onClose={onClose} /></QueryClientProvider>);
  const user = userEvent.setup();
  expect(await screen.findByRole("button", { name: "Salvar" })).toBeDisabled();
  await user.type(screen.getByLabelText("Descrição"), "Contexto");
  expect(screen.getByText("Alterações não salvas")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Cancelar" }));
  expect(ask).toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});
