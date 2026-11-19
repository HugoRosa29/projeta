import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ProjectDetails } from "../features/projects/ProjectDetails";
import { api } from "../services/api";
import type { Project } from "../domain/types";

const project: Project = { id: "p1", workspace_id: "w1", name: "Projeto", summary: "Resumo", description: "Descrição longa", responsible: "Ana", requester: "TI", external_ref: "Jira COMP-1", status: "active", task_count: 0, done_count: 0, last_activity: null };
afterEach(() => vi.restoreAllMocks());
function show(canManage = true) {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}><ProjectDetails project={project} canManage={canManage} /></QueryClientProvider>);
}
it("separa a ficha e permite salvar resumo sem perder os demais dados", async () => {
  const patch = vi.spyOn(api, "patch").mockResolvedValue({});
  const user = userEvent.setup();
  show();
  expect(screen.getByText("Ana")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Editar informações" }));
  await user.clear(screen.getByLabelText("Resumo"));
  await user.type(screen.getByLabelText("Resumo"), "Novo resumo");
  await user.click(screen.getByRole("button", { name: "Salvar informações" }));
  expect(patch).toHaveBeenCalledWith("/projects/p1", expect.objectContaining({ summary: "Novo resumo", description: "Descrição longa", responsible: "Ana" }));
});
it("mantém leitura sem controles de edição para quem não gerencia", () => {
  show(false);
  expect(screen.getByText("Descrição longa")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Editar informações" })).not.toBeInTheDocument();
});
it("preserva o formulário quando o servidor recusa a gravação", async () => {
  vi.spyOn(api, "patch").mockRejectedValue(new Error("Não foi possível salvar"));
  const user = userEvent.setup();
  show();
  await user.click(screen.getByRole("button", { name: "Editar informações" }));
  await user.click(screen.getByRole("button", { name: "Salvar informações" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível salvar");
  expect(screen.getByLabelText("Resumo")).toHaveValue("Resumo");
});
