import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { ProposalCard } from "../features/assistant/ProposalCard";
import type { ActionsPayload, Proposal } from "../features/assistant/types";
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
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Ajustar" }));
  await user.selectOptions(screen.getByLabelText("Estado"), "blocked");
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
  await user.click(screen.getByRole("button", { name: "Ajustar" }));
  await user.selectOptions(screen.getByLabelText("Estado"), "blocked");
  await user.click(screen.getByRole("button", { name: "Pode fazer" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("A tarefa mudou");
  expect(within(screen.getByLabelText("Antes e depois")).getByText("Em andamento")).toBeInTheDocument();
  expect(post).toHaveBeenCalledTimes(1);
  expect(patch).toHaveBeenCalledWith("/assistant/proposals/proposal", { payload: edited.payload });
  await user.click(screen.getByRole("button", { name: "Pode fazer" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Feito");
  expect(patch).toHaveBeenCalledTimes(1);
  expect(post).toHaveBeenCalledTimes(2);
});

it("não confirma quando salvar o rascunho falha", async () => {
  const user = userEvent.setup();
  vi.spyOn(api, "patch").mockRejectedValue(new Error("offline"));
  const post = vi.spyOn(api, "post");
  show(proposal());
  await user.click(screen.getByRole("button", { name: "Ajustar" }));
  await user.selectOptions(screen.getByLabelText("Estado"), "blocked");
  await user.click(screen.getByRole("button", { name: "Pode fazer" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível confirmar");
  expect(post).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Estado")).toHaveValue("blocked");
});

function plan(): Proposal {
  return {
    id: "plan", kind: "actions", status: "pending", expires_at: "2026-11-09T23:59:00Z",
    payload: { steps: [
      { action: "risk.create", params: { project_id: "p1", title: "Atraso", probability: 3, impact: 4 } },
      { action: "workspace.invite", params: { email: "nova@ex.com" } },
      { action: "task.delete", params: { task_id: "t1" } },
    ] },
    preview: { danger: true, steps: [
      { action: "risk.create", label: "Registrar risco", danger: false, fields: [
        { key: "project_id", label: "Projeto", value: "p1", display: "Portal", input: null },
        { key: "title", label: "Evento de risco", value: "Atraso", display: "Atraso", input: "text" },
      ] },
      { action: "workspace.invite", label: "Convidar pessoa", danger: false, fields: [
        { key: "email", label: "E-mail", value: "nova@ex.com", display: "nova@ex.com", input: "text" },
      ] },
      { action: "task.delete", label: "Excluir tarefa", danger: true, fields: [
        { key: "task_id", label: "Tarefa", value: "t1", display: "Publicar edital", input: null },
      ] },
    ] },
    result: null,
  };
}

it("plano de ações: nomes no lugar de IDs, aviso de risco, edição enviada e link de convite só na confirmação", async () => {
  const user = userEvent.setup();
  const p = plan();
  const patch = vi.spyOn(api, "patch").mockImplementation(async (_url, body) => ({ ...p, payload: (body as { payload: Proposal["payload"] }).payload }));
  const post = vi.spyOn(api, "post").mockResolvedValue({
    status: "confirmed",
    proposal: { ...p, status: "confirmed", result: { done: [{ label: "Risco R1 registrado", href: "/projetos/p1?view=riscos" }] } },
    once: [{ label: "Link", href: "/convite/segredo" }],
  });
  show(p);
  // Resumo primeiro: um passo por linha, sem formulário.
  expect(screen.getByText("Registrar risco")).toBeInTheDocument();
  expect(screen.queryByLabelText("Evento de risco")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Ajustar" }));
  expect(screen.getByText("Portal")).toBeInTheDocument();
  expect(screen.getByText("Publicar edital")).toBeInTheDocument();
  expect(screen.getAllByRole("alert")[0]).toHaveTextContent("irreversível");
  const title = screen.getByLabelText("Evento de risco");
  await user.clear(title);
  await user.type(title, "Atraso do jurídico");
  await user.click(screen.getByRole("button", { name: "Fazer mesmo assim" }));
  const steps = (p.payload as ActionsPayload).steps;
  expect(patch).toHaveBeenCalledWith("/assistant/proposals/plan", {
    payload: { steps: [{ ...steps[0], params: { ...steps[0].params, title: "Atraso do jurídico" } }, ...steps.slice(1)] },
  });
  expect(post).toHaveBeenCalledWith("/assistant/proposals/plan/confirm");
  expect(await screen.findByText("Risco R1 registrado")).toBeInTheDocument();
  expect(screen.getByText(/\/convite\/segredo/)).toBeInTheDocument();
});

it("pede ajuste conversando: descarta o rascunho e envia o pedido ao assistente", async () => {
  const user = userEvent.setup();
  const p = plan();
  const post = vi.spyOn(api, "post").mockResolvedValue({ ...p, status: "cancelled" });
  const onSend = vi.fn();
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><ProposalCard proposal={p} onSend={onSend} /></MemoryRouter></QueryClientProvider>);
  await user.type(screen.getByLabelText("Pedir ajuste ao assistente"), "tire o convite");
  await user.click(screen.getByRole("button", { name: "Pedir ajuste" }));
  expect(post).toHaveBeenCalledWith("/assistant/proposals/plan/cancel");
  expect(onSend).toHaveBeenCalledWith("Ajuste a proposta: tire o convite");
});

it("depois de criar o projeto sugere próximos passos com um clique", async () => {
  const user = userEvent.setup();
  const wbs: Proposal = {
    id: "w", kind: "apply_wbs", status: "pending", expires_at: "2026-11-09T23:59:00Z",
    payload: { project_id: null, project_name: "Censo", summary: "", assumptions: [], phases: [
      { name: "Preparação", tasks: [{ ref: "a", title: "Contratar", due_date: "2026-12-10", estimate_minutes: null, is_milestone: false, depends_on: [] }] },
    ] },
    preview: { count: 1, phases: 1, milestones: 0 }, result: null,
  };
  vi.spyOn(api, "post").mockResolvedValue({
    status: "confirmed",
    proposal: { ...wbs, status: "confirmed", result: { created: [], project: { id: "p", name: "Censo", href: "/projetos/p" } } },
  });
  const onSend = vi.fn();
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><ProposalCard proposal={wbs} onSend={onSend} /></MemoryRouter></QueryClientProvider>);
  expect(screen.getByText("Contratar")).toBeInTheDocument();
  expect(screen.getAllByText("10/12")).toHaveLength(2); // prazo final e prazo da tarefa
  await user.click(screen.getByRole("button", { name: "Criar projeto" }));
  await user.click(await screen.findByRole("button", { name: "Liste os principais riscos do projeto “Censo”" }));
  expect(onSend).toHaveBeenCalledWith("Liste os principais riscos do projeto “Censo”");
});

it("edição em lote mostra quantas e quais tarefas vão mudar", () => {
  const targets = Array.from({ length: 12 }, (_, i) => ({ title: `Migrar seção ${i}`, due: "2026-12-10" }));
  const p: Proposal = {
    id: "bulk", kind: "actions", status: "pending", expires_at: "2026-11-09T23:59:00Z",
    payload: { steps: [{ action: "task.bulk_update", params: { project_id: "p1", where_phase: "Migração", priority: "high" } }] },
    preview: { danger: false, steps: [{ action: "task.bulk_update", label: "Editar várias tarefas de uma vez", danger: false, targets, fields: [
      { key: "where_phase", label: "Filtro: fase", value: "Migração", display: "Migração", input: "text" },
      { key: "priority", label: "Nova prioridade", value: "high", display: "Alta", input: "select" },
    ] }] },
    result: null,
  };
  show(p);
  expect(screen.getByText("12 tarefas")).toBeInTheDocument();
  expect(screen.getByText("Migrar seção 11")).toBeInTheDocument();
});
