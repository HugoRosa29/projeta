import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AssistantContext } from "../app/assistantContext";
import { SessionProvider } from "../app/session";
import type { Task, User, Workspace } from "../domain/types";
import { addDays, postponeOptions } from "../domain/work";
import { AssistantPanel } from "../features/assistant/AssistantPanel";
import { TaskDialog, TaskList } from "../features/tasks/TaskParts";
import { api } from "../services/api";

const base: Omit<Task, "id" | "title" | "status"> = { workspace_id: "w1", project_id: "p1", owner_id: null, description: "", priority: "medium", assignee_id: null, assignee_name: null, project_name: "CNPJ", due_date: "2026-11-20", estimate_minutes: null, progress: 0, phase: null, is_milestone: false, labels: [], version: 4, created_at: "", updated_at: "", parent_id: null, parent_title: null };
const task = (extra: Partial<Task> = {}): Task => ({ ...base, id: "t1", title: "Revisar acessos", status: "todo", ...extra });

afterEach(() => vi.restoreAllMocks());
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
const wrap = (ui: ReactNode) => render(<QueryClientProvider client={client()}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);

describe("datas de adiamento", () => {
  it("soma dias como data de calendário, atravessando mês e ano", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-12-29", 7)).toBe("2027-01-05");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });
  it("conta as opções a partir de hoje, não do prazo atual", () => {
    expect(postponeOptions("2026-11-24").map((o) => o.date)).toEqual(["2026-11-25", "2026-11-27", "2026-12-01"]);
  });
});

describe("ações rápidas na lista", () => {
  it("muda o estado sem abrir a ficha, enviando a versão conhecida", async () => {
    const patch = vi.spyOn(api, "patch").mockResolvedValue(task());
    wrap(<TaskList tasks={[task()]} today="2026-11-24" onOpen={() => {}} quick />);
    await userEvent.setup().selectOptions(screen.getByLabelText("Estado de Revisar acessos"), "blocked");
    expect(patch).toHaveBeenCalledWith("/tasks/t1", { status: "blocked", expected_version: 4 });
  });

  it("adia o prazo a partir de hoje", async () => {
    const patch = vi.spyOn(api, "patch").mockResolvedValue(task());
    wrap(<TaskList tasks={[task()]} today="2026-11-24" onOpen={() => {}} quick />);
    await userEvent.setup().selectOptions(screen.getByLabelText("Adiar o prazo de Revisar acessos"), "Amanhã (25/11/26)");
    expect(patch).toHaveBeenCalledWith("/tasks/t1", { due_date: "2026-11-25", expected_version: 4 });
  });

  it("registra o andamento como comentário da tarefa", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue({});
    const user = userEvent.setup();
    wrap(<TaskList tasks={[task()]} today="2026-11-24" onOpen={() => {}} quick />);
    await user.click(screen.getByRole("button", { name: "Anotar andamento de Revisar acessos" }));
    const input = screen.getByLabelText("Andamento de Revisar acessos");
    expect(input).toHaveFocus();
    await user.type(input, "  Aguardando o RH  ");
    await user.click(screen.getByRole("button", { name: "Registrar" }));
    expect(post).toHaveBeenCalledWith("/tasks/t1/comments", { body: "Aguardando o RH" });
  });

  it("não mostra ações em tarefa concluída nem em listas sem o modo rápido", () => {
    const { unmount } = wrap(<TaskList tasks={[task({ status: "done" })]} today="2026-11-24" onOpen={() => {}} quick />);
    expect(screen.queryByLabelText("Estado de Revisar acessos")).not.toBeInTheDocument();
    unmount();
    wrap(<TaskList tasks={[task()]} today="2026-11-24" onOpen={() => {}} />);
    expect(screen.queryByLabelText("Estado de Revisar acessos")).not.toBeInTheDocument();
  });

  it("sem a data de hoje, não oferece adiar", () => {
    wrap(<TaskList tasks={[task()]} onOpen={() => {}} quick />);
    expect(screen.getByLabelText("Estado de Revisar acessos")).toBeInTheDocument();
    expect(screen.queryByLabelText("Adiar o prazo de Revisar acessos")).not.toBeInTheDocument();
  });
});

describe("atualizar pelo assistente", () => {
  // jsdom não implementa rolagem; o painel rola a conversa ao montar.
  beforeAll(() => {
    Element.prototype.scrollTo ??= () => {};
  });

  it("a ficha abre o assistente com o comentário começado e se fecha", async () => {
    vi.spyOn(api, "get").mockImplementation(async (path: string) =>
      (path.endsWith("/comments") ? { comments: [] } : { task: task(), can_write: true, can_comment: true, depends_on: [], blocks: [], subtasks: [] }) as never,
    );
    const openAssistant = vi.fn();
    const onClose = vi.fn();
    wrap(<AssistantContext.Provider value={{ openAssistant }}><TaskDialog taskId="t1" onClose={onClose} /></AssistantContext.Provider>);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Contar ao assistente" }));
    expect(openAssistant).toHaveBeenCalledWith("Comente na tarefa Revisar acessos: ");
    expect(onClose).toHaveBeenCalled();
  });

  it("sem permissão de comentar, a ficha não oferece o atalho", async () => {
    vi.spyOn(api, "get").mockImplementation(async (path: string) =>
      (path.endsWith("/comments") ? { comments: [] } : { task: task(), can_write: false, can_comment: false, depends_on: [], blocks: [], subtasks: [] }) as never,
    );
    wrap(<TaskDialog taskId="t1" onClose={() => {}} />);
    await screen.findByText("Você tem acesso somente de leitura a esta tarefa.");
    expect(screen.queryByRole("button", { name: "Contar ao assistente" })).not.toBeInTheDocument();
  });

  const me = { user: { id: "u1", name: "Ana" } as User, workspaces: [{ id: "w1", name: "Equipe", kind: "team" } as Workspace] };
  const panel = (draft: { text: string; seq: number } | null) => (
    <SessionProvider me={me}>
      <AssistantPanel draft={draft} expanded={false} onToggleExpand={() => {}} onClose={() => {}} />
    </SessionProvider>
  );

  it("o rascunho vai para o campo e não é enviado sozinho", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ messages: [] });
    const post = vi.spyOn(api, "post");
    wrap(panel({ text: "Comente na tarefa Revisar acessos: ", seq: 1 }));
    expect(await screen.findByLabelText("Mensagem para o assistente")).toHaveValue("Comente na tarefa Revisar acessos: ");
    expect(post).not.toHaveBeenCalled();
  });

  it("os modelos de atualização preenchem o campo sem enviar", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ messages: [] });
    const post = vi.spyOn(api, "post");
    wrap(panel(null));
    await userEvent.setup().click(await screen.findByRole("button", { name: "Concluir uma tarefa" }));
    expect(screen.getByLabelText("Mensagem para o assistente")).toHaveValue("Conclua a tarefa ");
    expect(post).not.toHaveBeenCalled();
  });
});
