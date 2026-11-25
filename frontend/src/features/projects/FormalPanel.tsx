import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Empty, ErrorBox, Loading, useToast } from "../../components/ui";
import {
  APPROACH_LABEL,
  HEALTH_LABEL,
  PHASE_LABEL,
  TERM_FIELDS,
  TERM_TITLE,
  asText,
  downloadText,
  termToMarkdown,
  type Health,
  type Phase,
  type TermKind,
} from "../../domain/formal";
import type { Member, Project } from "../../domain/types";
import { api } from "../../services/api";

interface Props {
  project: Project;
  members: Member[];
  canManage: boolean;
}

const SECTIONS = [
  ["classificacao", "Classificação"],
  ["funcoes", "Funções"],
  ["semanal", "Acompanhamento semanal"],
  ["tap", "Termo de abertura (TAP)"],
  ["tep", "Termo de encerramento (TEP)"],
] as const;
type Section = (typeof SECTIONS)[number][0];

/** Uma seção por vez, escolhida no menu lateral: os termos são longos e, empilhados, obrigavam a rolar a página inteira. */
export function FormalPanel({ project, members, canManage }: Props) {
  const [section, setSection] = useState<Section>("classificacao");
  return (
    <div className="formal-layout">
      <nav className="formal-nav" aria-label="Seções do projeto formal">
        {SECTIONS.map(([key, label]) => (
          <button key={key} type="button" aria-current={section === key ? "true" : undefined} onClick={() => setSection(key)}>
            {label}
          </button>
        ))}
      </nav>
      <div className="formal-pane">
        {section === "classificacao" && <Classification project={project} canManage={canManage} />}
        {section === "funcoes" && <Roles project={project} members={members} canManage={canManage} />}
        {section === "semanal" && <StatusNotes project={project} canManage={canManage} />}
        {section === "tap" && <Term key="tap" project={project} kind="tap" canManage={canManage} />}
        {section === "tep" && <Term key="tep" project={project} kind="tep" canManage={canManage} />}
      </div>
    </div>
  );
}

function useRefresh() {
  const qc = useQueryClient();
  return () => {
    for (const k of ["project", "projects", "portfolio"]) qc.invalidateQueries({ queryKey: [k] });
  };
}

function Classification({ project, canManage }: { project: Project; canManage: boolean }) {
  const toast = useToast();
  const refresh = useRefresh();
  const [sei, setSei] = useState(project.sei_process ?? "");
  useEffect(() => setSei(project.sei_process ?? ""), [project.sei_process]);
  const save = useMutation({
    mutationFn: (patch: Record<string, string>) => api.patch(`/projects/${project.id}`, patch),
    onSuccess: () => {
      refresh();
      toast("Projeto atualizado");
    },
    onError: (e) => toast((e as Error).message),
  });
  return (
    <section className="card">
      <h2>Projeto formal</h2>
      <p className="muted">Opcional. Escolher uma fase liga o acompanhamento semanal e o portfólio.</p>
      <div className="field">
        <label htmlFor="f-phase">Fase</label>
        <select
          id="f-phase"
          className="select"
          disabled={!canManage}
          value={project.phase ?? ""}
          onChange={(e) => e.target.value && save.mutate({ phase: e.target.value })}
        >
          <option value="">Projeto comum</option>
          {(Object.keys(PHASE_LABEL) as Phase[]).map((p) => (
            <option key={p} value={p}>
              {PHASE_LABEL[p]}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="f-appr">Abordagem</label>
        <select
          id="f-appr"
          className="select"
          disabled={!canManage}
          value={project.approach ?? ""}
          onChange={(e) => e.target.value && save.mutate({ approach: e.target.value })}
        >
          <option value="">Não definida</option>
          {Object.entries(APPROACH_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="f-sei">Nº do processo SEI</label>
        <div className="row">
          <input
            id="f-sei"
            className="input grow"
            maxLength={60}
            disabled={!canManage}
            value={sei}
            onChange={(e) => setSei(e.target.value)}
          />
          {canManage && (
            <button
              className="btn btn-line btn-sm"
              disabled={sei === (project.sei_process ?? "")}
              onClick={() => save.mutate({ sei_process: sei })}
            >
              Salvar
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

interface Ref {
  roles: { id: string; label: string }[];
}

function Roles({ project, members, canManage }: { project: Project; members: Member[]; canManage: boolean }) {
  const toast = useToast();
  const refresh = useRefresh();
  const ref = useQuery({
    queryKey: ["formal-ref"],
    queryFn: () => api.get<Ref>("/formal/reference"),
    staleTime: Infinity,
  });
  const set = useMutation({
    mutationFn: (v: { id: string; roles: string[] }) =>
      api.put(`/projects/${project.id}/members/${v.id}/roles`, { roles: v.roles }),
    onSuccess: refresh,
    onError: (e) => toast((e as Error).message),
  });
  if (ref.isLoading)
    return (
      <section className="card">
        <Loading />
      </section>
    );
  if (ref.isError)
    return (
      <section className="card">
        <ErrorBox error={ref.error} onRetry={() => ref.refetch()} />
      </section>
    );
  const roles = ref.data!.roles;
  return (
    <section className="card">
      <h2>Funções no projeto</h2>
      <p className="muted">Qualidade e segurança não podem ser da mesma pessoa que projeta ou executa.</p>
      <ul className="task-list" style={{ marginTop: 10 }}>
        {members.map((m) => {
          const mine = m.project_roles ?? [];
          return (
            <li key={m.id} className="task-row" style={{ display: "block" }}>
              <strong>{m.name}</strong>
              <div className="task-meta" role="group" aria-label={`Funções de ${m.name}`}>
                {roles.map((r) => (
                  <label key={r.id} className="badge" style={{ cursor: canManage ? "pointer" : "default" }}>
                    <input
                      type="checkbox"
                      disabled={!canManage || set.isPending}
                      checked={mine.includes(r.id)}
                      onChange={(e) =>
                        set.mutate({
                          id: m.id,
                          roles: e.target.checked ? [...mine, r.id] : mine.filter((x) => x !== r.id),
                        })
                      }
                    />{" "}
                    {r.label}
                  </label>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

interface Note {
  id: string;
  state: Health;
  delay_reason: string;
  done: string;
  pending: string;
  blockers: string;
  author_name: string;
  created_at: string;
}
interface Draft {
  state: Health;
  delay_reason: string;
  done: string;
  pending: string;
  blockers: string;
}

function StatusNotes({ project, canManage }: { project: Project; canManage: boolean }) {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["notes", project.id],
    queryFn: () => api.get<{ notes: Note[] }>(`/projects/${project.id}/status-notes`),
  });
  const [form, setForm] = useState<Draft | null>(null);
  const draft = useMutation({
    mutationFn: () => api.get<Draft>(`/projects/${project.id}/status-notes/draft`),
    onSuccess: (d) => setForm(d),
    onError: (e) => toast((e as Error).message),
  });
  const publish = useMutation({
    mutationFn: (f: Draft) => api.post(`/projects/${project.id}/status-notes`, f),
    onSuccess: () => {
      setForm(null);
      qc.invalidateQueries({ queryKey: ["notes", project.id] });
      qc.invalidateQueries({ queryKey: ["portfolio"] });
      toast("Nota publicada");
    },
    onError: (e) => toast((e as Error).message),
  });
  const set = (k: keyof Draft, v: string) => setForm((f) => (f ? { ...f, [k]: v } : f));
  return (
    <section className="card">
      <h2>Acompanhamento semanal</h2>
      {canManage && !form && (
        <button className="btn btn-sm" onClick={() => draft.mutate()} disabled={draft.isPending}>
          Preparar nota da semana
        </button>
      )}
      {form && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            publish.mutate(form);
          }}
        >
          <p className="muted">Rascunho calculado das tarefas. Revise antes de publicar.</p>
          <div className="field">
            <label htmlFor="n-state">Situação</label>
            <select id="n-state" className="select" value={form.state} onChange={(e) => set("state", e.target.value)}>
              {(Object.keys(HEALTH_LABEL) as Health[]).map((h) => (
                <option key={h} value={h}>
                  {HEALTH_LABEL[h]}
                </option>
              ))}
            </select>
          </div>
          {form.state === "late" && (
            <TextField
              id="n-delay"
              label="Justificativa do atraso (obrigatória)"
              value={form.delay_reason}
              onChange={(v) => set("delay_reason", v)}
            />
          )}
          <TextField id="n-done" label="O que já foi realizado" value={form.done} onChange={(v) => set("done", v)} />
          <TextField id="n-pend" label="O que está pendente" value={form.pending} onChange={(v) => set("pending", v)} />
          <TextField id="n-block" label="Impedimentos" value={form.blockers} onChange={(v) => set("blockers", v)} />
          <div className="row">
            <button className="btn" disabled={publish.isPending}>
              Publicar nota
            </button>
            <button type="button" className="btn btn-line" onClick={() => setForm(null)}>
              Descartar
            </button>
          </div>
        </form>
      )}
      {q.isLoading ? (
        <Loading />
      ) : q.isError ? (
        <ErrorBox error={q.error} onRetry={() => q.refetch()} />
      ) : q.data!.notes.length === 0 ? (
        <Empty title="Sem notas ainda">
          A nota semanal registra situação, atrasos, realizado, pendências e impedimentos.
        </Empty>
      ) : (
        <ul className="task-list" style={{ marginTop: 14 }}>
          {q.data!.notes.map((n) => (
            <li key={n.id} className="task-row" style={{ display: "block" }}>
              <strong>{HEALTH_LABEL[n.state]}</strong>{" "}
              <span className="coord">
                {n.author_name} · {new Date(n.created_at).toLocaleDateString("pt-BR")}
              </span>
              {n.delay_reason && (
                <p>
                  <em>Justificativa:</em> {n.delay_reason}
                </p>
              )}
              {n.done && (
                <p style={{ whiteSpace: "pre-line" }}>
                  <em>Realizado:</em> {n.done}
                </p>
              )}
              {n.pending && (
                <p style={{ whiteSpace: "pre-line" }}>
                  <em>Pendente:</em> {n.pending}
                </p>
              )}
              {n.blockers && (
                <p style={{ whiteSpace: "pre-line" }}>
                  <em>Impedimentos:</em> {n.blockers}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <textarea id={id} className="textarea" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

interface TermData {
  content: Record<string, unknown>;
  version: number;
}

function Term({ project, kind, canManage }: { project: Project; kind: TermKind; canManage: boolean }) {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["term", project.id, kind],
    queryFn: () => api.get<TermData>(`/projects/${project.id}/terms/${kind}`),
  });
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (q.data) setForm(Object.fromEntries(TERM_FIELDS[kind].map(([k]) => [k, asText(q.data.content[k])])));
  }, [q.data, kind]);
  const save = useMutation({
    mutationFn: () =>
      api.put(`/projects/${project.id}/terms/${kind}`, {
        content: Object.fromEntries(Object.entries(form ?? {}).filter(([, v]) => v.trim())),
        expected_version: q.data!.version,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["term", project.id, kind] });
      toast("Termo salvo");
    },
    onError: (e) => toast((e as Error).message),
  });
  const prefill = useMutation({
    mutationFn: () => api.get<Record<string, unknown>>(`/projects/${project.id}/terms/tep/draft`),
    onSuccess: (d) =>
      setForm((f) => ({
        ...(f ?? {}),
        ...Object.fromEntries(TERM_FIELDS.tep.map(([k]) => [k, asText(d[k]) || (f?.[k] ?? "")])),
      })),
    onError: (e) => toast((e as Error).message),
  });
  const exportMd = () =>
    form &&
    downloadText(
      `${kind}-${project.name.replace(/\W+/g, "-").toLowerCase()}.md`,
      termToMarkdown(kind, project.name, project.sei_process, form),
    );
  return (
    <section className="card">
      <h2>{TERM_TITLE[kind]}</h2>
      <p className="muted">{q.data?.version ? `Versão ${q.data.version}` : "Ainda não preenchido"}</p>
      <div className="row">
        <button className="btn btn-line btn-sm" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? "Recolher" : "Abrir"}
        </button>
        {form && (
          <button className="btn btn-line btn-sm" onClick={exportMd}>
            Baixar em Markdown
          </button>
        )}
      </div>
      {open &&
        (q.isError ? (
          <ErrorBox error={q.error} onRetry={() => q.refetch()} />
        ) : (
          form && (
            <form
              style={{ marginTop: 12 }}
              onSubmit={(e) => {
                e.preventDefault();
                save.mutate();
              }}
            >
              {kind === "tep" && canManage && (
                <button type="button" className="btn btn-line btn-sm" onClick={() => prefill.mutate()}>
                  Pré-preencher com o planejado e o realizado
                </button>
              )}
              {TERM_FIELDS[kind].map(([k, label]) => (
                <TextField
                  key={k}
                  id={`${kind}-${k}`}
                  label={label}
                  value={form[k] ?? ""}
                  onChange={(v) => setForm({ ...form, [k]: v })}
                />
              ))}
              {canManage && (
                <button className="btn" disabled={save.isPending}>
                  Salvar termo
                </button>
              )}
            </form>
          )
        ))}
    </section>
  );
}
