import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/ui";
import { needsReview, responseLate, riskCode, riskLevel, sortRisks, summarizeRisks, type Risk } from "../domain/risk";
import type { Member } from "../domain/types";
import { RisksCard, RisksPanel } from "../features/projects/RisksPanel";
import { api } from "../services/api";

const now = new Date("2026-11-26T12:00:00Z");
const today = "2026-11-26";
const recent = "2026-11-20T12:00:00Z";
const base: Omit<Risk, "id" | "number" | "title" | "probability" | "impact" | "score"> = {
  kind: "threat", cause: "", effect: "", category: "technical", affects: [], strategy: null, response: "", contingency: "", trigger_signal: "",
  owner_id: null, owner_name: null, response_due: null, status: "open", reviewed_at: recent, version: 1, created_at: recent, updated_at: recent,
};
const risk = (number: number, title: string, p: number, i: number, extra: Partial<Risk> = {}): Risk => ({ ...base, id: `r${number}`, number, title, probability: p, impact: i, score: p * i, ...extra });

const risks = [
  risk(1, "Atraso do fornecedor", 4, 5, { category: "commercial", strategy: "mitigate", response_due: "2026-11-20" }),
  risk(2, "Mudança na legislação", 3, 3, { category: "external", reviewed_at: "2026-10-01T12:00:00Z" }),
  risk(3, "Licença sai antes", 2, 2, { kind: "opportunity", strategy: "exploit" }),
  risk(4, "Servidor caiu", 5, 5, { status: "occurred" }),
  risk(5, "Equipe reduzida", 3, 4, { status: "closed" }),
];

describe("domínio dos riscos", () => {
  it("classifica a pontuação nas quatro faixas da matriz 5×5", () => {
    expect([1, 4, 5, 9, 10, 14, 15, 25].map(riskLevel)).toEqual(["low", "low", "moderate", "moderate", "high", "high", "critical", "critical"]);
    expect([riskCode(3), riskCode(12)]).toEqual(["R-03", "R-12"]);
  });

  it("resume só os ativos em nível, categoria e matriz, e todos na situação", () => {
    const s = summarizeRisks(risks, today, now);
    expect(s.active.map((r) => r.number)).toEqual([1, 2, 3]);
    expect(s.byLevel).toEqual({ low: 1, moderate: 1, high: 0, critical: 1 });
    expect(s.byCategory).toEqual({ technical: 1, management: 0, commercial: 1, external: 1 });
    expect(s.byStatus).toEqual({ open: 3, responding: 0, occurred: 1, closed: 1 });
    expect(s.matrix[3][4]).toBe(1); // P4 × I5
    expect(s.matrix[4][4]).toBe(0); // o ocorrido não entra
    expect(s.noResponse.map((r) => r.number)).toEqual([2]);
    expect(s.review.map((r) => r.number)).toEqual([2]);
    expect(s.late.map((r) => r.number)).toEqual([1]);
  });

  it("revisão e prazo só cobram de riscos ativos", () => {
    expect(needsReview({ status: "closed", reviewed_at: "2026-01-01T00:00:00Z" }, now)).toBe(false);
    expect(responseLate({ status: "occurred", response_due: "2026-01-01" }, today)).toBe(false);
  });

  it("ordena ativos primeiro e pela pontuação", () => {
    expect(sortRisks(risks).map((r) => r.number)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("aba Riscos", () => {
  const members: Member[] = [{ id: "u1", name: "Ana", email: "ana@ex.com", role: "manager" }];
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    vi.spyOn(api, "get").mockImplementation((path: string) => {
      if (path === "/projects/p1/risks") return Promise.resolve({ risks, can_write: true, can_manage: true }) as never;
      return Promise.reject(new Error(`inesperado: ${path}`)) as never;
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const wrap = (ui: ReactNode = <RisksPanel projectId="p1" members={members} />) =>
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
        <ToastProvider>{ui}</ToastProvider>
      </QueryClientProvider>,
    );

  it("mostra indicadores e filtra o registro pela matriz, pela rosca e pelo tipo", async () => {
    wrap();
    const user = userEvent.setup();
    const register = await screen.findByRole("region", { name: /Registro de riscos/ });
    // Por padrão, só os ativos.
    expect(within(register).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Sem resposta definida: 1. Filtrar o registro" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Probabilidade alta, impacto muito alto: nível crítico, 1 risco/ }));
    expect(within(register).getAllByRole("listitem")).toHaveLength(1);
    expect(within(register).getByText("Atraso do fornecedor")).toBeInTheDocument();
    await user.click(within(register).getByRole("button", { name: "Limpar filtro" }));

    // Uma rosca por vez: a de situação fica na aba "Situação".
    await user.click(screen.getByRole("radio", { name: "Situação" }));
    await user.click(screen.getByRole("button", { name: /Ocorreu/ }));
    expect(within(register).getByText("Servidor caiu")).toBeInTheDocument();
    expect(within(register).getAllByRole("listitem")).toHaveLength(1);
    await user.click(within(register).getByRole("button", { name: "Limpar filtro" }));

    await user.click(screen.getByRole("radio", { name: "Oportunidades" }));
    expect(within(register).getAllByRole("listitem")).toHaveLength(1);
    expect(within(register).getByText("Licença sai antes")).toBeInTheDocument();
  });

  it("registra um risco escolhendo a célula da matriz e a estratégia", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue(risk(6, "Chuva forte", 4, 3));
    wrap();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Novo risco" }));
    const dialog = screen.getByRole("dialog", { name: "Novo risco" });
    await user.type(within(dialog).getByLabelText(/Evento de risco/), "Chuva forte");
    await user.type(within(dialog).getByLabelText(/Causa/), "época de chuvas");
    expect(within(dialog).getByText(/Porque/)).toHaveTextContent("Porque época de chuvas, pode ocorrer: Chuva forte.");
    await user.click(within(dialog).getByRole("button", { name: "Probabilidade alta, impacto médio" }));
    expect(within(dialog).getByText("Alto · 12")).toBeInTheDocument();
    // Ameaça não oferece "Explorar" (estratégia de oportunidade).
    expect(within(dialog).queryByRole("radio", { name: /Explorar/ })).toBeNull();
    await user.click(within(dialog).getByRole("radio", { name: /Mitigar/ }));
    await user.click(within(dialog).getByRole("checkbox", { name: "Prazo" }));
    await user.click(within(dialog).getByRole("button", { name: "Registrar risco" }));
    expect(post).toHaveBeenCalledWith("/projects/p1/risks", expect.objectContaining({
      kind: "threat", title: "Chuva forte", cause: "época de chuvas", probability: 4, impact: 3, strategy: "mitigate", affects: ["schedule"], owner_id: "",
    }));
  });

  it("na edição envia só o que mudou, com a versão lida", async () => {
    const patch = vi.spyOn(api, "patch").mockResolvedValue({ ...risks[1], status: "responding", version: 2 });
    wrap();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Mudança na legislação/ }));
    const dialog = screen.getByRole("dialog", { name: "R-02 · Ameaça" });
    await user.selectOptions(within(dialog).getByLabelText("Situação"), "responding");
    await user.click(within(dialog).getByRole("button", { name: "Salvar" }));
    expect(patch).toHaveBeenCalledWith("/projects/p1/risks/r2", { version: 1, status: "responding" });
  });

  it("abre direto a ficha do risco pedido pela visão geral", async () => {
    const opened = vi.fn();
    wrap(<RisksPanel projectId="p1" members={members} openRisk="r2" onOpenedRisk={opened} />);
    expect(await screen.findByRole("dialog", { name: "R-02 · Ameaça" })).toBeInTheDocument();
    expect(opened).toHaveBeenCalledOnce();
  });

  it("cartão da visão geral mostra o perfil e só os mais graves, e leva à aba", async () => {
    const onOpen = vi.fn();
    const many = [...risks, risk(6, "Chuva forte", 3, 2), risk(7, "Greve dos Correios", 1, 2)];
    vi.mocked(api.get).mockResolvedValue({ risks: many, can_write: true, can_manage: true } as never);
    wrap(<RisksCard projectId="p1" onOpen={onOpen} />);
    const card = await screen.findByRole("region", { name: /Riscos do projeto/ });
    await screen.findByText("Atraso do fornecedor");
    expect(within(card).getByRole("img", { name: "5 riscos ativos: 1 crítico, 2 moderados, 2 baixos" })).toBeInTheDocument();
    // Só os 3 mais graves (ocorrido e encerrado ficam de fora); o resto vira um atalho.
    expect(within(card).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["CríticoAtraso do fornecedor", "ModeradoMudança na legislação", "ModeradoChuva forte"]);
    const user = userEvent.setup();
    await user.click(within(card).getByRole("button", { name: /Mudança na legislação/ }));
    expect(onOpen).toHaveBeenCalledWith("r2");
    await user.click(within(card).getByRole("button", { name: "+ 2 outros riscos" }));
    expect(onOpen).toHaveBeenLastCalledWith(null);
  });
});
