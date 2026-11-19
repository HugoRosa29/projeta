import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { ProposalCard } from "../features/assistant/ProposalCard";
import type { Proposal } from "../features/assistant/types";
import { api } from "../services/api";

vi.mock("../app/session", () => ({ useSession: () => ({ workspace: { id: "ws" } }) }));
vi.mock("../components/ui", () => ({ useToast: () => vi.fn() }));

afterEach(() => vi.restoreAllMocks());

function proposal(): Proposal {
  return {
    id: "proposal", kind: "update_task", status: "pending", expires_at: "2026-11-09T23:59:00Z",
    payload: { task_id: "task", changes: { status: "done" } },
    preview: { tasks: [{ task_id: "task", title: "Configurar DNS", project: null,
      href: "/minhas-tarefas?task=task", changes: [{ field: "status", label: "Estado", before: "A fazer", after: "Concluída" }] }] },
    result: null,
  };
}

function show(p: Proposal) {
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><ProposalCard proposal={p} /></MemoryRouter></QueryClientProvider>);
}

it("edita o estado e mostra o novo valor na prévia antes de enviar", async () => {
  const patch = vi.spyOn(api, "patch");
  const post = vi.spyOn(api, "post");
  show(proposal());
  await userEvent.setup().selectOptions(screen.getByLabelText("Estado"), "blocked");
  const diff = within(screen.getByLabelText("Antes e depois"));
  expect(diff.getByText("Bloqueada")).toBeInTheDocument();
  expect(diff.queryByText("Concluída")).not.toBeInTheDocument();
  expect(patch).not.toHaveBeenCalled();
  expect(post).not.toHaveBeenCalled();
});

it("exige novo clique após conflito e mantém o rascunho retornado pelo servidor", async () => {
  const user = userEvent.setup();
  const p = proposal();
  const edited = { ...p, payload: { task_id: "task", changes: { status: "blocked" } } };
  const stale = { ...edited, preview: { tasks: [{ ...p.preview.tasks![0], changes: [
    { field: "status", label: "Estado", before: "Em andamento", after: "Bloqueada" },
  ] }] } };
  const patch = vi.spyOn(api, "patch").mockResolvedValue(edited);
  const post = vi.spyOn(api, "post")
    .mockResolvedValueOnce({ status: "stale", proposal: stale })
    .mockResolvedValueOnce({ status: "confirmed", proposal: { ...stale, status: "confirmed" } });
  show(p);
  await user.selectOptions(screen.getByLabelText("Estado"), "blocked");
  await user.click(screen.getByRole("button", { name: "Confirmar" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("A tarefa mudou");
  expect(within(screen.getByLabelText("Antes e depois")).getByText("Em andamento")).toBeInTheDocument();
  expect(post).toHaveBeenCalledTimes(1);
  expect(patch).toHaveBeenCalledWith("/assistant/proposals/proposal", { payload: edited.payload });
  await user.click(screen.getByRole("button", { name: "Confirmar" }));
  expect(await screen.findByRole("status")).toHaveTextContent("confirmado");
  expect(patch).toHaveBeenCalledTimes(1);
  expect(post).toHaveBeenCalledTimes(2);
});

it("não confirma quando salvar o rascunho falha", async () => {
  const user = userEvent.setup();
  vi.spyOn(api, "patch").mockRejectedValue(new Error("offline"));
  const post = vi.spyOn(api, "post");
  show(proposal());
  await user.selectOptions(screen.getByLabelText("Estado"), "blocked");
  await user.click(screen.getByRole("button", { name: "Confirmar" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível confirmar");
  expect(post).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Estado")).toHaveValue("blocked");
});
