import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { Task } from "../domain/types";
import { QuickAdd } from "../features/tasks/TaskParts";
import { api } from "../services/api";

const t = (over: Partial<Task>) => ({ id: "x", title: "x", parent_id: null, is_milestone: false, ...over }) as Task;
const tasks = [t({ id: "a", title: "Mãe" }), t({ id: "b", title: "Filha", parent_id: "a" }), t({ id: "m", title: "Marco", is_milestone: true })];
const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
afterEach(() => vi.restoreAllMocks());

it("cria marco com data no projeto", async () => {
  const post = vi.spyOn(api, "post").mockResolvedValue({});
  wrap(<QuickAdd workspaceId="w" projectId="p" tasks={tasks} />);
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText("Tipo do item"), "milestone");
  await user.type(screen.getByLabelText("Título: marco"), "Go-live");
  expect(screen.getByRole("button", { name: "Criar" })).toBeDisabled(); // sem data, não cria
  await user.type(screen.getByLabelText("Data do marco"), "2027-02-18");
  await user.click(screen.getByRole("button", { name: "Criar" }));
  expect(post).toHaveBeenCalledWith("/tasks", { workspace_id: "w", project_id: "p", title: "Go-live", is_milestone: true, due_date: "2027-02-18" });
});

it("subtarefa escolhe só tarefas principais como mãe", async () => {
  const post = vi.spyOn(api, "post").mockResolvedValue({});
  wrap(<QuickAdd workspaceId="w" projectId="p" tasks={tasks} />);
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText("Tipo do item"), "subtask");
  const parent = screen.getByLabelText("Tarefa-mãe");
  expect([...parent.querySelectorAll("option")].map((o) => o.textContent)).toEqual(["Tarefa-mãe…", "Mãe"]);
  await user.type(screen.getByLabelText("Título: subtarefa"), "Detalhe");
  await user.selectOptions(parent, "a");
  await user.click(screen.getByRole("button", { name: "Criar" }));
  expect(post).toHaveBeenCalledWith("/tasks", { workspace_id: "w", project_id: "p", title: "Detalhe", parent_id: "a" });
});

it("fora de projeto continua criando só tarefa", () => {
  wrap(<QuickAdd workspaceId="w" />);
  expect(screen.queryByLabelText("Tipo do item")).not.toBeInTheDocument();
});
