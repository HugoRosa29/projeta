import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Empty, ErrorBox, Loading, useToast } from "../../components/ui";
import { ROLE_LABEL, can, type Member, type Permission, type Role, type Workspace } from "../../domain/types";
import { api } from "../../services/api";
import { useSession } from "../../app/session";

const TZS = ["America/Sao_Paulo", "America/Manaus", "America/Fortaleza", "America/Rio_Branco", "America/Noronha", "Europe/Lisbon", "UTC"];
const ROLES = Object.keys(ROLE_LABEL) as Role[];
const RANK: Record<Role, number> = { viewer: 0, member: 1, manager: 2, admin: 3 };

/** Perfis que quem convida pode conceder; o servidor aplica a mesma regra. */
export function invitableRoles(mine: Role): Role[] {
  return mine === "admin" ? ROLES : ROLES.filter((r) => r !== "admin" && RANK[r] <= RANK[mine]);
}

export function SettingsPage() {
  const { workspace, workspaces, user, setWorkspaceId, refresh } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const isAdmin = workspace.role === "admin";
  const canInvite = workspace.kind === "team" && can(workspace, "workspace.invite");
  const inviteRoles = invitableRoles(workspace.role);
  const done = (msg: string) => () => (refresh(), qc.invalidateQueries({ queryKey: ["ws"] }), toast(msg));
  const fail = (e: unknown) => toast((e as Error).message);

  const members = useQuery({ queryKey: ["ws", "members", workspace.id], queryFn: () => api.get<{ members: Member[] }>(`/workspaces/${workspace.id}/members`) });
  const invites = useQuery({
    queryKey: ["ws", "invites", workspace.id],
    queryFn: () => api.get<{ invitations: { id: string; email: string; role: Role; expires_at: string }[] }>(`/workspaces/${workspace.id}/invitations`),
    enabled: canInvite,
  });

  const [teamName, setTeamName] = useState("");
  const createTeam = useMutation({
    mutationFn: () => api.post<{ id: string }>("/workspaces", { name: teamName }),
    onSuccess: (w) => (setTeamName(""), setWorkspaceId(w.id), done("Espaço criado")()),
    onError: fail,
  });
  const [wsName, setWsName] = useState(workspace.name);
  const patchWs = useMutation({ mutationFn: (b: object) => api.patch(`/workspaces/${workspace.id}`, b), onSuccess: done("Espaço atualizado"), onError: fail });
  const setRole = useMutation({ mutationFn: (v: { id: string; role: Role }) => api.patch(`/workspaces/${workspace.id}/members/${v.id}`, { role: v.role }), onSuccess: done("Papel atualizado"), onError: fail });
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/workspaces/${workspace.id}/members/${id}`), onSuccess: done("Pessoa removida"), onError: fail });
  const [invEmail, setInvEmail] = useState("");
  const [invRole, setInvRole] = useState<Role>(inviteRoles.includes("member") ? "member" : inviteRoles[0]);
  const [link, setLink] = useState<string | null>(null);
  const invite = useMutation({
    mutationFn: () => api.post<{ token: string }>(`/workspaces/${workspace.id}/invitations`, { email: invEmail, role: invRole }),
    onSuccess: (r) => {
      setLink(`${window.location.origin}/convite/${r.token}`);
      setInvEmail("");
      done("Convite criado")();
    },
    onError: fail,
  });
  const revoke = useMutation({ mutationFn: (id: string) => api.del(`/workspaces/${workspace.id}/invitations/${id}`), onSuccess: done("Convite revogado"), onError: fail });
  const prefs = useMutation({ mutationFn: (b: object) => api.patch(`/workspaces/${workspace.id}/me`, b), onSuccess: done("Preferência salva"), onError: fail });
  const [exporting, setExporting] = useState(false);
  const exportWs = () => {
    setExporting(true);
    api
      .download(`/workspaces/${workspace.id}/export`, exportFilename(workspace.name))
      .then(() => toast("Exportação baixada"), fail)
      .finally(() => setExporting(false));
  };
  const tz = useMutation({ mutationFn: (timezone: string) => api.patch("/me/timezone", { timezone }), onSuccess: done("Fuso atualizado"), onError: fail });

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">Configurações</p>
          <h1>Configurações</h1>
        </div>
      </div>

      <section className="card">
        <h2>Espaços</h2>
        <ul className="task-list" style={{ margin: "12px 0" }}>
          {workspaces.map((w) => (
            <li key={w.id} className="task-row">
              <span style={{ flex: 1 }}>{w.name} <span className="badge">{w.kind === "personal" ? "Pessoal" : "Equipe"}</span> <span className="muted">{ROLE_LABEL[w.role]}</span></span>
              {w.id !== workspace.id ? <button className="btn btn-line btn-sm" onClick={() => setWorkspaceId(w.id)}>Abrir</button> : <span className="badge ok">Atual</span>}
            </li>
          ))}
        </ul>
        <ImportWorkspace targets={workspaces.filter((w) => w.role === "admin")} onDone={(id) => (setWorkspaceId(id), done("Espaço importado")())} onError={fail} />
        <form className="row" onSubmit={(e: FormEvent) => (e.preventDefault(), createTeam.mutate())}>
          <label className="sr-only" htmlFor="team-name">Nome do novo espaço de equipe</label>
          <input id="team-name" className="input grow" placeholder="Novo espaço de equipe…" value={teamName} onChange={(e) => setTeamName(e.target.value)} />
          <button className="btn btn-primary" disabled={teamName.trim().length < 2}>Criar espaço de equipe</button>
        </form>
      </section>

      <section className="card">
        <h2>Preferências</h2>
        <div className="row" style={{ marginTop: 12 }}>
          <div className="field grow">
            <label htmlFor="tz">Seu fuso horário (datas de “hoje” e lembretes)</label>
            <select id="tz" className="select" value={user.timezone} onChange={(e) => tz.mutate(e.target.value)}>
              {[...new Set([user.timezone, ...TZS])].map((z) => <option key={z}>{z}</option>)}
            </select>
          </div>
        </div>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label" style={{ fontWeight: 600, fontSize: "0.8125rem", marginBottom: 6 }}>Notificações neste espaço</legend>
          <label className="row" style={{ gap: 8 }}><input type="checkbox" className="check" checked={workspace.notify_inapp} onChange={(e) => prefs.mutate({ notify_inapp: e.target.checked })} /> Avisos dentro do app</label>
          <label className="row" style={{ gap: 8, marginTop: 6 }}><input type="checkbox" className="check" checked={workspace.notify_email} onChange={(e) => prefs.mutate({ notify_email: e.target.checked })} /> Resumo por e-mail <span className="badge warn">envio ainda não configurado</span></label>
        </fieldset>
      </section>

      {isAdmin && (
        <section className="card">
          <h2>Espaço “{workspace.name}”</h2>
          <form className="row" style={{ marginTop: 12 }} onSubmit={(e: FormEvent) => (e.preventDefault(), patchWs.mutate({ name: wsName }))}>
            <label className="sr-only" htmlFor="ws-name">Nome do espaço</label>
            <input id="ws-name" className="input grow" value={wsName} onChange={(e) => setWsName(e.target.value)} />
            <select className="select grow" aria-label="Fuso horário do espaço" value={workspace.timezone} onChange={(e) => patchWs.mutate({ timezone: e.target.value })}>
              {[...new Set([workspace.timezone, ...TZS])].map((z) => <option key={z}>{z}</option>)}
            </select>
            <button className="btn btn-line">Salvar nome</button>
          </form>
          <div className="row" style={{ marginTop: 12, gap: 8 }}>
            <button className="btn btn-line" disabled={exporting} onClick={exportWs}>{exporting ? "Exportando…" : "Exportar espaço"}</button>
            <span className="muted">Baixa um arquivo com projetos, tarefas, comentários, histórico e pessoas, para importar em outra instalação.</span>
          </div>
        </section>
      )}

      <section className="card">
        <h2>Equipe</h2>
        {members.isLoading && <Loading />}
        {members.isError && <ErrorBox error={members.error} onRetry={() => members.refetch()} />}
        <ul className="task-list" style={{ marginTop: 12 }}>
          {members.data?.members.map((m) => (
            <li key={m.id} className="task-row">
              <span style={{ flex: 1, minWidth: 0 }}>{m.name} <span className="muted">{m.email}</span></span>
              {isAdmin ? (
                <>
                  <select className="select" style={{ width: "auto" }} aria-label={`Papel de ${m.name}`} value={m.role} onChange={(e) => setRole.mutate({ id: m.id, role: e.target.value as Role })}>
                    {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </select>
                  {m.id !== user.id && <button className="btn btn-danger btn-sm" onClick={() => confirm(`Remover ${m.name} do espaço?`) && remove.mutate(m.id)}>Remover</button>}
                </>
              ) : <span className="badge">{ROLE_LABEL[m.role]}</span>}
            </li>
          ))}
        </ul>
      </section>

      {workspace.kind === "team" && <PermissionsMatrix workspaceId={workspace.id} editable={isAdmin} onSaved={done("Permissões atualizadas")} onError={fail} />}

      {canInvite && (
        <section className="card">
          <h2>Convites</h2>
          <form className="row" style={{ marginTop: 12 }} onSubmit={(e: FormEvent) => (e.preventDefault(), invite.mutate())}>
            <label className="sr-only" htmlFor="inv-email">E-mail</label>
            <input id="inv-email" className="input grow" type="email" required placeholder="email@pessoa.com" value={invEmail} onChange={(e) => setInvEmail(e.target.value)} />
            <select className="select grow" aria-label="Papel do convidado" value={invRole} onChange={(e) => setInvRole(e.target.value as Role)}>
              {inviteRoles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
            <button className="btn btn-primary">Convidar</button>
          </form>
          {link && (
            <p className="card" style={{ marginTop: 12, overflowWrap: "anywhere" }} role="status">
              Envie este link à pessoa (vale por 7 dias e só para o e-mail convidado):<br /><strong>{link}</strong>{" "}
              <button className="btn btn-ghost" onClick={() => navigator.clipboard?.writeText(link).then(() => toast("Link copiado"))}>Copiar</button>
            </p>
          )}
          {invites.data && (invites.data.invitations.length === 0 ? <Empty title="Sem convites pendentes" /> : (
            <ul className="task-list" style={{ marginTop: 12 }}>
              {invites.data.invitations.map((i) => (
                <li key={i.id} className="task-row">
                  <span style={{ flex: 1 }}>{i.email} <span className="badge">{ROLE_LABEL[i.role]}</span></span>
                  <button className="btn btn-ghost" onClick={() => revoke.mutate(i.id)}>Revogar</button>
                </li>
              ))}
            </ul>
          ))}
        </section>
      )}
    </>
  );
}

interface Matrix {
  catalog: { id: Permission; label: string }[];
  roles: { id: Exclude<Role, "admin">; label: string }[];
  permissions: Record<Exclude<Role, "admin">, Permission[]>;
}

/** O Gestor marca o que cada perfil pode fazer; os demais veem a mesma tabela só para leitura. */
export function PermissionsMatrix({ workspaceId, editable, onSaved, onError }: { workspaceId: string; editable: boolean; onSaved: () => void; onError: (e: unknown) => void }) {
  const q = useQuery({ queryKey: ["ws", "permissions", workspaceId], queryFn: () => api.get<Matrix>(`/workspaces/${workspaceId}/permissions`) });
  const [draft, setDraft] = useState<Matrix["permissions"] | null>(null);
  const save = useMutation({
    mutationFn: (permissions: Matrix["permissions"]) => api.put<Matrix>(`/workspaces/${workspaceId}/permissions`, { permissions }),
    onSuccess: () => (setDraft(null), onSaved()),
    onError,
  });
  if (q.isLoading) return <section className="card"><h2>Perfis e permissões</h2><Loading /></section>;
  if (q.isError) return <section className="card"><h2>Perfis e permissões</h2><ErrorBox error={q.error} onRetry={() => q.refetch()} /></section>;
  const m = q.data!;
  const current = draft ?? m.permissions;
  const toggle = (role: keyof Matrix["permissions"], p: Permission, on: boolean) =>
    setDraft({ ...current, [role]: on ? [...current[role], p] : current[role].filter((x) => x !== p) });

  return (
    <section className="card">
      <h2>Perfis e permissões</h2>
      <p className="muted" style={{ marginTop: 6 }}>
        {editable ? "Marque o que cada perfil pode fazer neste espaço." : "O que cada perfil pode fazer neste espaço. Só o Gestor altera."} O Gestor sempre pode tudo.
      </p>
      <div style={{ overflowX: "auto", marginTop: 12 }}>
        <table className="perm-table" style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th scope="col" style={{ textAlign: "left" }}>Permissão</th>
              {m.roles.map((r) => <th key={r.id} scope="col">{r.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {m.catalog.map((p) => (
              <tr key={p.id}>
                <th scope="row" style={{ textAlign: "left", fontWeight: 400, padding: "6px 8px 6px 0" }}>{p.label}</th>
                {m.roles.map((r) => (
                  <td key={r.id} style={{ textAlign: "center" }}>
                    <input
                      type="checkbox"
                      className="check"
                      aria-label={`${r.label}: ${p.label}`}
                      checked={current[r.id].includes(p.id)}
                      disabled={!editable || save.isPending}
                      onChange={(e) => toggle(r.id, p.id, e.target.checked)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editable && draft && (
        <div className="row" style={{ marginTop: 12, gap: 8 }}>
          <button className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate(draft)}>Salvar permissões</button>
          <button className="btn btn-ghost" onClick={() => setDraft(null)}>Descartar</button>
        </div>
      )}
    </section>
  );
}

export function exportFilename(name: string, today = new Date()): string {
  const slug = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "espaco";
  return `projeta-${slug}-${today.toISOString().slice(0, 10)}.json`;
}

interface ImportSummary {
  workspace_id: string;
  projects: number;
  tasks: number;
  comments: number;
  activity: number;
  people_linked: number;
  people_invited: number;
  people_missing: string[];
}

/** Importa um arquivo de "Exportar espaço" como espaço novo ou dentro de um espaço onde é Gestor. */
export function ImportWorkspace({ targets, onDone, onError }: { targets: Workspace[]; onDone: (id: string) => void; onError: (e: unknown) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [target, setTarget] = useState("new");
  const [name, setName] = useState("");
  const [result, setResult] = useState<ImportSummary | null>(null);
  const run = useMutation({
    mutationFn: () => api.sendFile<ImportSummary>("/workspaces/import", file!, target === "new" ? { name: name.trim() || undefined } : { workspace_id: target }),
    onSuccess: (r) => (setResult(r), setFile(null), onDone(r.workspace_id)),
    onError,
  });
  return (
    <form className="card" style={{ margin: "12px 0" }} onSubmit={(e: FormEvent) => (e.preventDefault(), run.mutate())}>
      <h3 style={{ margin: 0 }}>Importar espaço</h3>
      <p className="muted" style={{ marginTop: 4 }}>Use o arquivo gerado em “Exportar espaço” em outra instalação. Nada do destino é sobrescrito: projetos e tarefas entram como novos.</p>
      <div className="row" style={{ marginTop: 8 }}>
        <label className="sr-only" htmlFor="imp-file">Arquivo de exportação</label>
        <input id="imp-file" type="file" accept="application/json,.json" className="input grow" onChange={(e) => (setFile(e.target.files?.[0] ?? null), setResult(null))} />
        <label className="sr-only" htmlFor="imp-target">Destino</label>
        <select id="imp-target" className="select grow" value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="new">Novo espaço de equipe</option>
          {targets.map((w) => <option key={w.id} value={w.id}>Dentro de “{w.name}”</option>)}
        </select>
        {target === "new" && (
          <>
            <label className="sr-only" htmlFor="imp-name">Nome do novo espaço</label>
            <input id="imp-name" className="input grow" placeholder="Nome (padrão: o do arquivo)" value={name} onChange={(e) => setName(e.target.value)} />
          </>
        )}
        <button className="btn btn-primary" disabled={!file || run.isPending}>{run.isPending ? "Importando…" : "Importar"}</button>
      </div>
      {result && (
        <p role="status" style={{ marginTop: 8 }}>
          Importados {result.projects} projetos, {result.tasks} tarefas, {result.comments} comentários e {result.activity} registros de histórico.
          {result.people_linked > 0 && ` ${result.people_linked} pessoas vinculadas.`}
          {result.people_invited > 0 && ` ${result.people_invited} convites pendentes por matrícula.`}
          {result.people_missing.length > 0 && ` Sem conta aqui: ${result.people_missing.join(", ")}.`}
        </p>
      )}
    </form>
  );
}
