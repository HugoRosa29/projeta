import { describe, expect, it } from "vitest";
import type { Status, Task } from "../domain/types";
import { localToday, projectRisk } from "../domain/work";

const base: Omit<Task, "id" | "title" | "status" | "due_date"> = { workspace_id: "w1", project_id: "p1", owner_id: null, description: "", priority: "medium", assignee_id: null, assignee_name: null, project_name: "CNPJ", estimate_minutes: null, progress: 0, phase: null, is_milestone: false, labels: [], version: 1, created_at: "", updated_at: "", parent_id: null, parent_title: null };
const t = (id: string, due: string | null, status: Status = "todo"): Task => ({ ...base, id, title: id, status, due_date: due });

describe("o que precisa de atenção no projeto", () => {
  const today = "2026-11-24";
  const tasks = [
    t("atrasada", "2026-11-20"),
    t("atrasada-e-bloqueada", "2026-11-22", "blocked"),
    t("bloqueada-sem-prazo", null, "blocked"),
    t("vence-hoje", "2026-11-24"),
    t("vence-na-semana", "2026-12-01"),
    t("longe", "2026-12-20"),
    t("concluida-atrasada", "2026-11-01", "done"),
  ];
  const r = projectRisk(tasks, today);

  it("ignora concluídas e separa atrasadas, bloqueadas e as que vencem em 7 dias", () => {
    expect(r.late.map((x) => x.id)).toEqual(["atrasada", "atrasada-e-bloqueada"]);
    expect(r.blocked.map((x) => x.id)).toEqual(["atrasada-e-bloqueada", "bloqueada-sem-prazo"]);
    expect(r.dueSoon.map((x) => x.id)).toEqual(["vence-hoje", "vence-na-semana"]);
  });

  it("lista cada tarefa uma vez, pelo motivo mais grave", () => {
    expect(r.attention.map((x) => [x.task.id, x.reason])).toEqual([
      ["atrasada", "late"],
      ["atrasada-e-bloqueada", "late"],
      ["bloqueada-sem-prazo", "blocked"],
      ["vence-hoje", "soon"],
      ["vence-na-semana", "soon"],
    ]);
  });

  it("próximas entregas ficam nos próximos 7 dias, em ordem de prazo", () => {
    expect(r.upcoming.map((x) => x.id)).toEqual(["vence-hoje", "vence-na-semana"]);
  });

  it("hoje é a data local, não a UTC", () => {
    expect(localToday(new Date(2026, 0, 5, 23, 30))).toBe("2026-01-05");
  });
});
