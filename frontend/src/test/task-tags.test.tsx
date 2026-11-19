import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { TaskDialog, TaskTags } from "../features/tasks/TaskParts";
import { api } from "../services/api";

const task = { id: "t1", title: "Entrega", priority: "medium", labels: ["EXISTENTE"], status: "todo", version: 3, description: "", project_id: null, due_date: null };
afterEach(() => vi.restoreAllMocks());
it("exibe prioridade e tags em conjunto", () => {
  render(<TaskTags task={{ priority: "high", labels: ["URGENTE", "REVISÃO"] }} />);
  expect(screen.getByLabelText("Prioridade: Alta")).toHaveTextContent("ALTA");
  expect(screen.getByText("URGENTE")).toHaveClass("task-tag-urgent");
  expect(screen.getByText("REVISÃO")).toBeInTheDocument();
});
it("salva urgência e tags sem apagar etiquetas anteriores", async () => {
  vi.spyOn(api, "get").mockResolvedValue({ task, can_write: true, depends_on: [] });
  const patch = vi.spyOn(api, "patch").mockResolvedValue(task);
  render(<QueryClientProvider client={new QueryClient()}><TaskDialog taskId="t1" onClose={() => {}} /></QueryClientProvider>);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "URGENTE" }));
  await user.type(screen.getByLabelText("Tags"), ", revisão, revisão");
  await user.click(screen.getByRole("button", { name: "Salvar" }));
  expect(patch).toHaveBeenCalledWith("/tasks/t1", { expected_version: 3, labels: ["EXISTENTE", "URGENTE", "REVISÃO"] });
});
it("impede edição das etiquetas para acesso somente leitura", async () => {
  vi.spyOn(api, "get").mockResolvedValue({ task, can_write: false, depends_on: [] });
  render(<QueryClientProvider client={new QueryClient()}><TaskDialog taskId="t1" onClose={() => {}} /></QueryClientProvider>);
  expect(await screen.findByLabelText("Tags")).toBeDisabled();
  expect(screen.getByRole("button", { name: "URGENTE" })).toBeDisabled();
  expect(screen.getByLabelText("Prioridade")).toBeDisabled();
});
