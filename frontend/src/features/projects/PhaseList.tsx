import { ArrowDown, ArrowUp, ChevronRight, Layers, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import { Loading, useToast } from "../../components/ui";
import type { Task } from "../../domain/types";
import { TaskList } from "../tasks/TaskParts";
import { useCreateTask, useUpdateTask } from "../tasks/hooks";
import { DEFAULT_PHASES, NO_PHASE, groupByPhase, usePhaseActions, usePhases, type Phase } from "./phases";

/** Lista do projeto agrupada por fase. Cada fase recolhe (menos rolagem), mostra o andamento e
 * recebe tarefas: criadas ali mesmo ou arrastadas até o cabeçalho. Quem edita tarefas também
 * cria, renomeia, reordena e exclui fases; o servidor confere a permissão em cada uma. */
export function PhaseList({ projectId, workspaceId, tasks, shown, filtering, canWrite, onOpen }: {
  projectId: string;
  workspaceId: string;
  /** Todas as tarefas do projeto (contagens e dependências). */
  tasks: Task[];
  /** As que passam nos filtros. */
  shown: Task[];
  filtering: boolean;
  canWrite: boolean;
  onOpen: (id: string) => void;
}) {
  const phasesQ = usePhases(projectId);
  const phases = phasesQ.data?.phases ?? [];
  const actions = usePhaseActions(projectId);
  const update = useUpdateTask();
  const toast = useToast();
  const [drag, setDrag] = useState<string | null>(null);
  const [overGroup, setOverGroup] = useState<string | null>(null);
  const [openState, setOpenState] = useState<Record<string, boolean>>({});
  const [adding, setAdding] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null); // renomeia uma fase por vez
  const renaming = (p: Phase) => renamingId === p.id;

  if (phasesQ.isLoading) return <Loading />; // sem a ordem das fases, os grupos pulariam de lugar
  const all = groupByPhase(tasks, phases);
  const visible = groupByPhase(shown, phases);
  const totals = new Map(all.map((g) => [g.name, g]));
  const groups = visible.filter((g) => !filtering || g.tasks.length > 0);
  const phaseOf = new Map(phases.map((p) => [p.name, p]));
  // Aberta por padrão só a fase com trabalho em aberto; com filtro, tudo que sobrou aparece.
  const isOpen = (name: string) => filtering || (openState[name] ?? (totals.get(name)?.tasks.some((t) => t.status !== "done") ?? false));
  const setAll = (open: boolean) => setOpenState(Object.fromEntries(groups.map((g) => [g.name, open])));
  const anyOpen = groups.some((g) => isOpen(g.name));

  const dragged = drag ? tasks.find((t) => t.id === drag) : undefined;
  const canDropOn = (name: string) => canWrite && !!dragged && !dragged.parent_id && (dragged.phase ?? NO_PHASE) !== name;
  const dropProps = (name: string) => ({
    onDragOver: (e: DragEvent) => {
      if (!canDropOn(name)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "link"; // a linha arrastada só permite "link" (é a mesma das dependências)
      setOverGroup(name);
    },
    onDragLeave: () => setOverGroup(null),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setOverGroup(null);
      setDrag(null);
      if (dragged && canDropOn(name)) {
        update.mutate({ task: dragged, patch: { phase: name || null } }, { onSuccess: () => toast(name ? `${dragged.title} → ${name}` : `${dragged.title} ficou sem fase`) });
      }
    },
  });

  const move = (p: Phase, delta: number) => {
    const ids = phases.map((x) => x.id);
    const i = ids.indexOf(p.id);
    const j = i + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    actions.reorder.mutate(ids);
  };
  const remove = (p: Phase) => {
    const n = totals.get(p.name)?.tasks.length ?? 0;
    const msg = n ? `Excluir a fase “${p.name}”? As ${n} tarefas dela continuam, sem fase.` : `Excluir a fase “${p.name}”?`;
    if (confirm(msg)) actions.remove.mutate(p.id, { onSuccess: () => toast("Fase excluída") });
  };

  return (
    <div className="phase-list">
      <div className="phase-list-bar">
        {canWrite && (
          <button type="button" className="btn btn-line btn-sm" onClick={() => setAdding(true)}>
            <Plus size={15} aria-hidden /> Nova fase
          </button>
        )}
        {canWrite && phases.length === 0 && !phasesQ.isLoading && (
          <button type="button" className="btn btn-ghost btn-sm" disabled={actions.create.isPending} onClick={() => actions.create.mutate(DEFAULT_PHASES, { onSuccess: () => toast("Fases criadas: renomeie ou exclua as que não servirem") })}>
            <Layers size={15} aria-hidden /> Usar fases padrão
          </button>
        )}
        <span className="grow" />
        {!filtering && groups.length > 1 && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAll(!anyOpen)}>
            {anyOpen ? "Recolher todas" : "Expandir todas"}
          </button>
        )}
      </div>
      {adding && (
        <NameForm
          label="Nome da nova fase"
          placeholder="Ex.: Homologação"
          busy={actions.create.isPending}
          onCancel={() => setAdding(false)}
          onSave={(name) => actions.create.mutate([name], { onSuccess: () => (setAdding(false), setOpenState((s) => ({ ...s, [name]: true })), toast("Fase criada")) })}
        />
      )}
      {groups.length === 0 && <p className="muted phase-empty">Sem tarefas ainda. {canWrite ? "Crie as fases do projeto e adicione as tarefas dentro de cada uma." : ""}</p>}
      <div className="phase-groups">
        {groups.map((g) => {
          const total = totals.get(g.name)?.tasks ?? [];
          const done = total.filter((t) => t.status === "done").length;
          const pct = total.length ? Math.round((done / total.length) * 100) : 0;
          const p = phaseOf.get(g.name);
          const open = isOpen(g.name);
          const title = g.name || "Sem fase";
          const key = p?.id ?? `nome:${g.name}`; // fase só nas tarefas (sem registro) ou "sem fase"
          const bodyId = `phase-body-${key}`;
          return (
            <section key={key} className="phase-group" aria-label={`Fase ${title}`}>
              {/* Só o cabeçalho recebe: soltar sobre uma tarefa continua criando dependência. */}
              <div className={`phase-head ${overGroup === g.name ? "over" : ""}`} {...dropProps(g.name)}>
                {p && renaming(p) ? null : (
                  <button type="button" className="phase-toggle" aria-label={`${title}, ${done} de ${total.length} concluídas`} aria-expanded={open} aria-controls={bodyId} disabled={filtering} onClick={() => setOpenState((s) => ({ ...s, [g.name]: !open }))}>
                    <ChevronRight size={16} className="chev" aria-hidden />
                    <span className="phase-name">{title}</span>
                    <span className="phase-count" aria-hidden>{done}/{total.length}</span>
                  </button>
                )}
                {p && renaming(p) && (
                  <NameForm
                    label={`Novo nome da fase ${p.name}`}
                    initial={p.name}
                    busy={actions.rename.isPending}
                    onCancel={() => setRenamingId(null)}
                    onSave={(name) => actions.rename.mutate({ id: p.id, name }, { onSuccess: () => (setRenamingId(null), toast("Fase renomeada")) })}
                  />
                )}
                {total.length > 0 && !(p && renaming(p)) && (
                  <div className="progress phase-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`Andamento de ${title}`}>
                    <span style={{ width: `${pct}%` }} />
                  </div>
                )}
                {canWrite && p && !renaming(p) && (
                  <div className="phase-actions">
                    <button type="button" className="btn btn-ghost btn-sm" aria-label={`Subir a fase ${p.name}`} title="Subir" disabled={phases[0]?.id === p.id || actions.reorder.isPending} onClick={() => move(p, -1)}><ArrowUp size={15} aria-hidden /></button>
                    <button type="button" className="btn btn-ghost btn-sm" aria-label={`Descer a fase ${p.name}`} title="Descer" disabled={phases.at(-1)?.id === p.id || actions.reorder.isPending} onClick={() => move(p, 1)}><ArrowDown size={15} aria-hidden /></button>
                    <button type="button" className="btn btn-ghost btn-sm" aria-label={`Renomear a fase ${p.name}`} title="Renomear" onClick={() => setRenamingId(p.id)}><Pencil size={15} aria-hidden /></button>
                    <button type="button" className="btn btn-ghost btn-sm" aria-label={`Excluir a fase ${p.name}`} title="Excluir" onClick={() => remove(p)}><Trash2 size={15} aria-hidden /></button>
                  </div>
                )}
              </div>
              {open && (
                <div className="phase-body" id={bodyId}>
                  {g.tasks.length > 0 ? (
                    <TaskList tasks={g.tasks} all={tasks} onOpen={onOpen} dependencies={{ canWrite, drag, setDrag }} label={`Tarefas de ${title}`} />
                  ) : (
                    <p className="muted phase-empty">Nenhuma tarefa nesta fase{canWrite ? ". Crie abaixo ou arraste uma tarefa até o título da fase." : "."}</p>
                  )}
                  {canWrite && <PhaseAdd workspaceId={workspaceId} projectId={projectId} phase={g.name} title={title} />}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function NameForm({ label, initial = "", placeholder, busy, onSave, onCancel }: { label: string; initial?: string; placeholder?: string; busy: boolean; onSave: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  // O campo aparece porque a pessoa pediu para nomear: o foco vai para ele.
  useEffect(() => ref.current?.select(), []);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    if (n === initial) return onCancel();
    onSave(n);
  };
  return (
    <form className="phase-name-form" onSubmit={submit}>
      <label className="sr-only" htmlFor={`pn-${label}`}>{label}</label>
      <input
        id={`pn-${label}`}
        className="input"
        value={name}
        maxLength={200}
        placeholder={placeholder}
        ref={ref}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
      />
      <button className="btn btn-primary btn-sm" disabled={busy || !name.trim()}>Salvar</button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancelar</button>
    </form>
  );
}

/** Criar tarefa já dentro da fase. */
function PhaseAdd({ workspaceId, projectId, phase, title }: { workspaceId: string; projectId: string; phase: string; title: string }) {
  const [text, setText] = useState("");
  const create = useCreateTask();
  const toast = useToast();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    create.mutate({ workspace_id: workspaceId, project_id: projectId, title: t, phase: phase || null }, { onSuccess: () => setText(""), onError: (er) => toast((er as Error).message) });
  };
  return (
    <form className="phase-add" onSubmit={submit}>
      <label className="sr-only" htmlFor={`pa-${phase || "none"}`}>Nova tarefa em {title}</label>
      <input id={`pa-${phase || "none"}`} className="input" value={text} maxLength={200} placeholder={`Nova tarefa em ${title}…`} onChange={(e) => setText(e.target.value)} />
      <button className="btn btn-line btn-sm" disabled={create.isPending || !text.trim()} aria-label={`Criar tarefa em ${title}`}>
        <Plus size={15} aria-hidden />
      </button>
    </form>
  );
}
