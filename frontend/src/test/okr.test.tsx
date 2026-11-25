import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NO_KR_FILTER, boardStats, fmtCost, cheer, filterBoard, isLead, objectiveSummary, periodLabel, progressOf, since, staleByOwner, type KeyResult, type MyOkrs, type Objective, type OkrBoard as Board } from "../domain/okr";
import { CheckinDialog } from "../features/okrs/CheckinDialog";
import { OkrBoard } from "../features/okrs/OkrBoard";
import { MyCheckins } from "../features/okrs/OkrCards";
import { nextPeriods } from "../features/okrs/OkrEditors";
import { api } from "../services/api";

afterEach(() => vi.restoreAllMocks());

const kr = (over: Partial<KeyResult> = {}): KeyResult => ({
  id: "k1",
  objective_id: "o1",
  objective_title: "Atender mais rápido",
  title: "Reduzir prazo médio",
  owner_id: "u1",
  owner_name: "Ana Souza",
  kind: "number",
  start_value: 30,
  target_value: 10,
  current_value: 30,
  unit: "dias",
  project_id: null,
  project_name: null,
  cost: null,
  confidence: "on_track",
  last_checkin_at: null,
  progress: 0,
  stale: true,
  behind_pace: false,
  mine: true,
  can_checkin: true,
  ...over,
});

function wrap(children: ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("regras de OKR", () => {
  it("calcula o progresso como o servidor, inclusive meta decrescente", () => {
    expect(progressOf(30, 10, 20)).toBe(50);
    expect(progressOf(0, 10, 15)).toBe(100);
    expect(progressOf(0, 10, -1)).toBe(0);
    expect(progressOf(5, 5, 5)).toBe(100);
  });
  it("nomeia o trimestre e sugere o próximo para planejar", () => {
    expect(periodLabel("2026-T4")).toBe("4º trimestre de 2026");
    expect(nextPeriods(["2026-T4", "2026-T3"])).toEqual(["2027-T1", "2026-T4", "2026-T3"]);
  });
  it("diz há quanto tempo o KR não é atualizado", () => {
    const now = new Date("2026-11-24T12:00:00Z");
    expect(since(null, now)).toBe("nunca atualizado");
    expect(since("2026-11-24T08:00:00Z", now)).toBe("atualizado hoje");
    expect(since("2026-11-19T08:00:00Z", now)).toBe("atualizado há 5 dias");
  });
  it("reconhece o avanço depois do check-in", () => {
    expect(cheer(40, 100, 0)).toMatch(/Meta atingida/);
    expect(cheer(40, 52, 3)).toBe("Avançou 12 pontos. 3 semanas seguidas atualizando.");
    expect(cheer(40, 40, 1)).toBe("Check-in registrado.");
  });
  it("agrupa pendências por responsável, quem tem mais primeiro", () => {
    const o = { key_results: [kr({ id: "a" }), kr({ id: "b", owner_name: "Bruno" }), kr({ id: "c" }), kr({ id: "d", stale: false })] } as Objective;
    expect(staleByOwner([o]).map((g) => [g.owner, g.items.length])).toEqual([["Ana Souza", 2], ["Bruno", 1]]);
  });
  it("separa a home de gestão da home de execução", () => {
    expect(isLead({ role: "admin" })).toBe(true);
    expect(isLead({ role: "manager", permissions: ["okr.manage"] })).toBe(true);
    expect(isLead({ role: "member", permissions: ["task.write"] })).toBe(false);
  });
});

describe("check-in", () => {
  it("mostra a prévia do avanço e envia valor e confiança", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue({ key_result: kr({ progress: 50, current_value: 20 }), previous_progress: 0 });
    const user = userEvent.setup();
    wrap(<CheckinDialog queue={[kr()]} streak={2} onClose={() => {}} />);
    const input = screen.getByLabelText(/Valor atual/);
    await user.clear(input);
    await user.type(input, "20");
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("+50 p.p.")).toBeInTheDocument();
    await user.click(screen.getByLabelText(/Em risco/));
    await user.click(screen.getByRole("button", { name: "Registrar check-in" }));
    expect(post).toHaveBeenCalledWith("/key-results/k1/checkins", { value: 20, confidence: "at_risk", note: "" });
    expect(await screen.findByText("Avançou 50 pontos. 2 semanas seguidas atualizando.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Concluir" })).toHaveFocus();
  });

  it("em fila, oferece o próximo resultado-chave", async () => {
    vi.spyOn(api, "post").mockResolvedValue({ key_result: kr({ progress: 0 }), previous_progress: 0 });
    const user = userEvent.setup();
    wrap(<CheckinDialog queue={[kr(), kr({ id: "k2", title: "Satisfação" })]} onClose={() => {}} />);
    expect(screen.getByRole("dialog", { name: "Check-in 1 de 2" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Registrar check-in" }));
    await user.click(await screen.findByRole("button", { name: "Próximo resultado-chave" }));
    expect(screen.getByText("Satisfação")).toBeInTheDocument();
  });

  it("KR de projeto não pede valor, só a confiança", () => {
    wrap(<CheckinDialog queue={[kr({ kind: "project", project_id: "p1", project_name: "Portal", progress: 40 })]} onClose={() => {}} />);
    expect(screen.queryByLabelText(/Valor atual/)).not.toBeInTheDocument();
    expect(screen.getByText("Portal")).toBeInTheDocument();
  });
});

describe("meus resultados-chave", () => {
  const mine: MyOkrs = { period: "2026-T4", pace: 60, key_results: [kr(), kr({ id: "k2", title: "Satisfação", stale: false })], pending: 1, streak_weeks: 3, checkins_this_week: 0 };

  it("chama para o check-in dos pendentes e mostra a sequência", async () => {
    vi.spyOn(api, "get").mockResolvedValue(mine);
    wrap(<MyCheckins workspaceId="w1" />);
    expect(await screen.findByText("1 resultado-chave pede atualização.")).toBeInTheDocument();
    expect(screen.getByText(/3 semanas seguidas/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fazer check-in" })).toBeInTheDocument();
  });

  it("sem KR próprio, não ocupa a home", async () => {
    const get = vi.spyOn(api, "get").mockResolvedValue({ ...mine, key_results: [], pending: 0 });
    const { container } = wrap(<MyCheckins workspaceId="w1" />);
    await vi.waitFor(() => expect(get).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});

const obj = (over: Partial<Objective> = {}): Objective => ({
  id: "o1",
  title: "Atender mais rápido",
  description: "",
  owner_id: "u1",
  owner_name: "Ana Souza",
  period: "2026-T4",
  progress: 40,
  confidence: "at_risk",
  key_results: [
    kr({ id: "a", progress: 80, stale: false, confidence: "on_track", last_checkin_at: "2026-11-20T10:00:00Z" }),
    kr({ id: "b", title: "Satisfação do cidadão", owner_id: "u2", owner_name: "Bruno Lima", progress: 0, confidence: "at_risk" }),
  ],
  ...over,
});

const board = (objectives: Objective[]): Board => ({
  period: "2026-T4",
  periods: ["2026-T4"],
  pace: 60,
  can_manage: true,
  objectives,
  summary: { objectives: objectives.length, key_results: 3, progress: 45, confidence: { on_track: 2, at_risk: 1, off_track: 0 }, stale: 1, behind_pace: 0, updated_this_week: 2, without_owner: 0, cost: 0 },
});

describe("quadro de OKRs: regras", () => {
  const o2 = obj({ id: "o2", title: "Digitalizar a renegociação", progress: 50, key_results: [kr({ id: "c", title: "Portal no ar", kind: "project", project_id: "p1", project_name: "Portal", progress: 50, stale: false })] });

  it("busca sem acento no KR, no responsável e no objetivo", () => {
    expect(filterBoard([obj(), o2], { ...NO_KR_FILTER, q: "satisfacao" }).map((o) => o.key_results.map((k) => k.id))).toEqual([["b"]]);
    expect(filterBoard([obj(), o2], { ...NO_KR_FILTER, q: "bruno" })[0].key_results.map((k) => k.id)).toEqual(["b"]);
    // Casar com o objetivo mostra todos os KRs dele.
    expect(filterBoard([obj(), o2], { ...NO_KR_FILTER, q: "renegociacao" }).map((o) => o.id)).toEqual(["o2"]);
  });
  it("filtra por responsável, avaliação e pendência, e tira objetivo vazio do recorte", () => {
    expect(filterBoard([obj(), o2], { ...NO_KR_FILTER, owner: "u2" }).map((o) => o.id)).toEqual(["o1"]);
    expect(filterBoard([obj(), o2], { ...NO_KR_FILTER, confidence: "at_risk" })[0].key_results.map((k) => k.id)).toEqual(["b"]);
    expect(filterBoard([obj(), o2], { ...NO_KR_FILTER, pending: true }).flatMap((o) => o.key_results.map((k) => k.id))).toEqual(["b"]);
    // Sem filtro, objetivo sem KR continua no quadro.
    expect(filterBoard([obj({ key_results: [] })], NO_KR_FILTER)).toHaveLength(1);
  });
  it("ordena por menor progresso e por maior risco", () => {
    expect(filterBoard([obj()], NO_KR_FILTER, "progress")[0].key_results.map((k) => k.id)).toEqual(["b", "a"]);
    expect(filterBoard([obj()], NO_KR_FILTER, "risk")[0].key_results.map((k) => k.id)).toEqual(["b", "a"]);
  });
  it("mostra o custo curto e soma só o que foi informado", () => {
    expect([null, 0, 900, 40000, 1300000].map(fmtCost)).toEqual(["—", "interno", "R$ 900", "R$ 40 mil", "R$ 1,3 mi"]);
    const o = obj({ key_results: [kr({ id: "a", cost: 40000 }), kr({ id: "b", cost: 0 }), kr({ id: "c" })] });
    expect(objectiveSummary(o)).toMatchObject({ cost: 40000, costMissing: 1 });
    expect(objectiveSummary(obj()).cost).toBeNull();
  });
  it("resume o objetivo e a faixa do topo", () => {
    expect(objectiveSummary(o2)).toMatchObject({ owners: 1, projects: 1, pending: 0 });
    // O KR "b" nunca teve check-in: a confiança dele é só o padrão e não conta como avaliação.
    expect(objectiveSummary(obj())).toMatchObject({ owners: 2, pending: 1, unrated: 1, confidence: { on_track: 1, at_risk: 0, off_track: 0 } });
    // Ritmo 60: o1 (40%) está a 20 pontos, dentro da folga de 25; um objetivo com 10% não.
    expect(boardStats(board([obj(), obj({ id: "o3", progress: 10 })]))).toMatchObject({ objectives: 2, onPace: 1, atRisk: 1, pending: 2 });
  });
});

describe("quadro de OKRs: tela", () => {
  const actions = { onNewObjective: vi.fn(), onEditObjective: vi.fn(), onDeleteObjective: vi.fn(), onAddKr: vi.fn(), onEditKr: vi.fn(), onDeleteKr: vi.fn() };

  it("mostra um grupo por objetivo e filtra pela busca", async () => {
    const user = userEvent.setup();
    wrap(<OkrBoard d={board([obj()])} onCheckin={() => {}} manage={actions} />);
    expect(screen.getByRole("table", { name: "Atender mais rápido" })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: /Satisfação do cidadão/ })).toBeInTheDocument();
    expect(screen.getByText("Sem avaliação")).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText(/Buscar/), "reduzir");
    expect(screen.queryByRole("rowheader", { name: /Satisfação do cidadão/ })).not.toBeInTheDocument();
    expect(screen.getByText(/1 resultado-chave em 1 objetivo no recorte/)).toBeInTheDocument();
  });

  it("quem gere adiciona KR pelo grupo; quem só lê não vê edição", async () => {
    const user = userEvent.setup();
    const { unmount } = wrap(<OkrBoard d={board([obj()])} onCheckin={() => {}} manage={actions} />);
    await user.click(screen.getByRole("button", { name: "Adicionar KR" }));
    expect(actions.onAddKr).toHaveBeenCalledWith(expect.objectContaining({ id: "o1" }));
    unmount();
    wrap(<OkrBoard d={{ ...board([obj()]), can_manage: false }} onCheckin={() => {}} />);
    expect(screen.queryByRole("button", { name: "Adicionar KR" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Novo objetivo" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Editar/ })).not.toBeInTheDocument();
  });

  it("recolhe o grupo e troca para o gráfico", async () => {
    const user = userEvent.setup();
    wrap(<OkrBoard d={board([obj()])} onCheckin={() => {}} />);
    await user.click(screen.getByRole("button", { name: /Atender mais rápido/, expanded: true }));
    expect(screen.queryByRole("rowheader", { name: /Satisfação/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Gráfico/ }));
    expect(screen.getByRole("heading", { name: "Progresso por objetivo" })).toBeInTheDocument();
    expect(screen.getByText("Quem precisa atualizar")).toBeInTheDocument();
  });
});
