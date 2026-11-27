import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Copy, Download, Layers, Network, Plus, Search, ShieldCheck, SlidersHorizontal, Trash2, UserPlus, Users, type LucideIcon } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { Avatar } from "../../components/Avatar";
import { Empty, ErrorBox, Loading, useToast } from "../../components/ui";
import { ROLE_LABEL, can, type Member, type Permission, type Role, type Workspace } from "../../domain/types";
import { api } from "../../services/api";
import { useSession } from "../../app/session";
import { OrgSection } from "./OrgSection";

const TZS = ["America/Sao_Paulo", "America/Manaus", "America/Fortaleza", "America/Rio_Branco", "America/Noronha", "Europe/Lisbon", "UTC"];
const ROLES = Object.keys(ROLE_LABEL) as Role[];
const RANK: Record<Role, number> = { viewer: 0, member: 1, manager: 2, admin: 3 };

/** Perfis que quem convida pode conceder; o servidor aplica a mesma regra. */
export function invitableRoles(mine: Role): Role[] {
  return mine === "admin" ? ROLES : ROLES.filter((r) => r !== "admin" && RANK[r] <= RANK[mine]);
}

type SectionId = "preferencias" | "espaco" | "pessoas" | "permissoes" | "organizacao" | "espacos";
interface SectionDef { id: SectionId; label: string; hint: string; icon: LucideIcon }

/** Uma seção por vez, escolhida no menu ao lado (no celular, em abas roláveis no topo). A seção
 *  aberta fica na URL (?secao=) para o link e o "voltar" do navegador levarem ao mesmo lugar. */
export function SettingsPage() {
  const { workspace, workspaces, setWorkspaceId, refresh } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const isAdmin = workspace.role === "admin";
  const isTeam = workspace.kind === "team";
  const canInvite = isTeam && can(workspace, "workspace.invite");
  const inviteRoles = invitableRoles(workspace.role);
  const done = (msg: string) => () => (refresh(), qc.invalidateQueries({ queryKey: ["ws"] }), toast(msg));
  const fail = (e: unknown) => toast((e as Error).message);

  const sections: SectionDef[] = [
    { id: "preferencias", label: "Preferências", hint: "Fuso horário e avisos", icon: SlidersHorizontal },
    { id: "espaco", label: "Este espaço", hint: "Nome, fuso e exportação", icon: Building2 },
    { id: "pessoas", label: "Pessoas", hint: isTeam ? "Membros e convites" : "Quem está no espaço", icon: Users },
    ...(isTeam
      ? ([
          { id: "permissoes", label: "Permissões", hint: "O que cada perfil pode fazer", icon: ShieldCheck },
          { id: "organizacao", label: "Organização", hint: "Organograma e compartilhamento", icon: Network },
        ] as SectionDef[])
      : []),
    { id: "espacos", label: "Seus espaços", hint: "Trocar, criar e importar", icon: Layers },
  ];
  const [sp, setSp] = useSearchParams();
  const asked = sp.get("secao");
  const current = sections.find((s) => s.id === asked) ?? sections[0];
  const go = (id: SectionId) => setSp(id === sections[0].id ? {} : { secao: id });

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">Configurações</p>
          <h1>{current.label}</h1>
          <p className="muted" style={{ marginTop: 4 }}>
            Espaço atual: <strong>{workspace.name}</strong> · {workspace.kind === "personal" ? "Pessoal" : "Equipe"} · você é {ROLE_LABEL[workspace.role]}
          </p>
        </div>
      </div>

      <div className="set-layout">
        <nav className="set-nav" aria-label="Seções das configurações">
          {sections.map((s) => (
            <button key={s.id} type="button" className="set-nav-item" aria-current={s.id === current.id ? "page" : undefined} onClick={() => go(s.id)}>
              <s.icon size={18} aria-hidden />
              <span>
                <span className="set-nav-label">{s.label}</span>
                <span className="set-nav-hint">{s.hint}</span>
              </span>
            </button>
          ))}
        </nav>

        <div className="set-body">
          {current.id === "preferencias" && <PreferencesSection onDone={done} onError={fail} />}
          {current.id === "espaco" && <WorkspaceSection isAdmin={isAdmin} onDone={done} onError={fail} />}
          {current.id === "pessoas" && <PeopleSection isAdmin={isAdmin} canInvite={canInvite} inviteRoles={inviteRoles} onDone={done} onError={fail} />}
          {current.id === "permissoes" && <PermissionsMatrix workspaceId={workspace.id} editable={isAdmin} onSaved={done("Permissões atualizadas")} onError={fail} />}
          {current.id === "organizacao" && <OrgSection workspaceId={workspace.id} onError={fail} onDone={(m) => toast(m)} />}
          {current.id === "espacos" && (
            <SpacesSection
              current={workspace}
              workspaces={workspaces}
              open={setWorkspaceId}
              onDone={done}
              onError={fail}
            />
          )}
        </div>
      </div>
    </>
  );
}

type Done = (msg: string) => () => void;
type Fail = (e: unknown) => void;

function SectionHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="set-head">
      <h2>{title}</h2>
      {children && <p className="muted">{children}</p>}
    </div>
  );
}

function PreferencesSection({ onDone, onError }: { onDone: Done; onError: Fail }) {
  const { workspace, user } = useSession();
  const prefs = useMutation({ mutationFn: (b: object) => api.patch(`/workspaces/${workspace.id}/me`, b), onSuccess: onDone("Preferência salva"), onError });
  const tz = useMutation({ mutationFn: (timezone: string) => api.patch("/me/timezone", { timezone }), onSuccess: onDone("Fuso atualizado"), onError });
  return (
    <>
      <section className="card">
        <SectionHead title="Fuso horário">Define o que conta como “hoje” e quando chegam os lembretes. Vale para todos os seus espaços.</SectionHead>
        <div className="field" style={{ maxWidth: 360, marginBottom: 0 }}>
          <label htmlFor="tz">Seu fuso horário</label>
          <select id="tz" className="select" value={user.timezone} onChange={(e) => tz.mutate(e.target.value)}>
            {[...new Set([user.timezone, ...TZS])].map((z) => <option key={z}>{z}</option>)}
          </select>
        </div>
      </section>
      <section className="card">
        <SectionHead title="Notificações">Só para o espaço “{workspace.name}”. Troque de espaço para ajustar os outros.</SectionHead>
        <div className="set-toggles">
          <label className="set-toggle">
            <input type="checkbox" className="check" checked={workspace.notify_inapp} onChange={(e) => prefs.mutate({ notify_inapp: e.target.checked })} />
            <span className="set-toggle-text">Avisos dentro do app</span>
          </label>
          <label className="set-toggle">
            <input type="checkbox" className="check" checked={workspace.notify_email} onChange={(e) => prefs.mutate({ notify_email: e.target.checked })} />
            <span className="set-toggle-text">Resumo por e-mail <span className="badge warn">envio ainda não configurado</span></span>
          </label>
        </div>
      </section>
    </>
  );
}

function WorkspaceSection({ isAdmin, onDone, onError }: { isAdmin: boolean; onDone: Done; onError: Fail }) {
  const { workspace } = useSession();
  const toast = useToast();
  const [wsName, setWsName] = useState(workspace.name);
  const patchWs = useMutation({ mutationFn: (b: object) => api.patch(`/workspaces/${workspace.id}`, b), onSuccess: onDone("Espaço atualizado"), onError });
  const [exporting, setExporting] = useState(false);
  const exportWs = () => {
    setExporting(true);
    api
      .download(`/workspaces/${workspace.id}/export`, exportFilename(workspace.name))
      .then(() => toast("Exportação baixada"), onError)
      .finally(() => setExporting(false));
  };

  if (!isAdmin) {
    return (
      <section className="card">
        <SectionHead title="Dados do espaço">Só o Gestor do espaço altera estes dados.</SectionHead>
        <dl className="set-dl">
          <dt>Nome</dt><dd>{workspace.name}</dd>
          <dt>Tipo</dt><dd>{workspace.kind === "personal" ? "Pessoal" : "Equipe"}</dd>
          <dt>Fuso do espaço</dt><dd>{workspace.timezone}</dd>
          <dt>Seu perfil</dt><dd>{ROLE_LABEL[workspace.role]}</dd>
        </dl>
      </section>
    );
  }
  return (
    <>
      <section className="card">
        <SectionHead title="Dados do espaço">O nome aparece no seletor de espaços para todo mundo que participa.</SectionHead>
        <form className="field" style={{ maxWidth: 520 }} onSubmit={(e: FormEvent) => (e.preventDefault(), patchWs.mutate({ name: wsName }))}>
          <label htmlFor="ws-name">Nome do espaço</label>
          <div className="row">
            <input id="ws-name" className="input grow" value={wsName} onChange={(e) => setWsName(e.target.value)} />
            <button className="btn btn-line" disabled={wsName.trim().length < 2 || wsName === workspace.name || patchWs.isPending}>Salvar nome</button>
          </div>
        </form>
        <div className="field" style={{ maxWidth: 360, marginBottom: 0 }}>
          <label htmlFor="ws-tz">Fuso horário do espaço</label>
          <select id="ws-tz" className="select" value={workspace.timezone} onChange={(e) => patchWs.mutate({ timezone: e.target.value })}>
            {[...new Set([workspace.timezone, ...TZS])].map((z) => <option key={z}>{z}</option>)}
          </select>
          <span className="muted set-note">Salvo assim que você troca.</span>
        </div>
      </section>
      <section className="card">
        <SectionHead title="Exportar">Baixa um arquivo com projetos, tarefas, comentários, histórico e pessoas, para importar em outra instalação.</SectionHead>
        <button className="btn btn-line" disabled={exporting} onClick={exportWs}>
          <Download size={16} aria-hidden /> {exporting ? "Exportando…" : "Exportar espaço"}
        </button>
      </section>
    </>
  );
}

function PeopleSection({ isAdmin, canInvite, inviteRoles, onDone, onError }: { isAdmin: boolean; canInvite: boolean; inviteRoles: Role[]; onDone: Done; onError: Fail }) {
  const { workspace, user } = useSession();
  const toast = useToast();
  const [filter, setFilter] = useState("");
  const members = useQuery({ queryKey: ["ws", "members", workspace.id], queryFn: () => api.get<{ members: Member[] }>(`/workspaces/${workspace.id}/members`) });
  const invites = useQuery({
    queryKey: ["ws", "invites", workspace.id],
    queryFn: () => api.get<{ invitations: { id: string; email: string; role: Role; expires_at: string }[] }>(`/workspaces/${workspace.id}/invitations`),
    enabled: canInvite,
  });
  const setRole = useMutation({ mutationFn: (v: { id: string; role: Role }) => api.patch(`/workspaces/${workspace.id}/members/${v.id}`, { role: v.role }), onSuccess: onDone("Papel atualizado"), onError });
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/workspaces/${workspace.id}/members/${id}`), onSuccess: onDone("Pessoa removida"), onError });
  const [invEmail, setInvEmail] = useState("");
  const [invRole, setInvRole] = useState<Role>(inviteRoles.includes("member") ? "member" : inviteRoles[0]);
  const [link, setLink] = useState<string | null>(null);
  const invite = useMutation({
    mutationFn: () => api.post<{ token: string }>(`/workspaces/${workspace.id}/invitations`, { email: invEmail, role: invRole }),
    onSuccess: (r) => {
      setLink(`${window.location.origin}/convite/${r.token}`);
      setInvEmail("");
      onDone("Convite criado")();
    },
    onError,
  });
  const revoke = useMutation({ mutationFn: (id: string) => api.del(`/workspaces/${workspace.id}/invitations/${id}`), onSuccess: onDone("Convite revogado"), onError });

  const all = members.data?.members ?? [];
  const f = filter.trim().toLowerCase();
  const list = f ? all.filter((m) => `${m.name} ${m.email}`.toLowerCase().includes(f)) : all;
  const pending = invites.data?.invitations ?? [];

  return (
    <>
      {canInvite && (
        <section className="card">
          <SectionHead title="Convidar pessoa">A pessoa recebe um link que vale por 7 dias e só funciona para o e-mail convidado.</SectionHead>
          <form className="row" onSubmit={(e: FormEvent) => (e.preventDefault(), invite.mutate())}>
            <label className="sr-only" htmlFor="inv-email">E-mail</label>
            <input id="inv-email" className="input grow" type="email" required placeholder="email@pessoa.com" value={invEmail} onChange={(e) => setInvEmail(e.target.value)} />
            <select className="select" style={{ width: "auto" }} aria-label="Papel do convidado" value={invRole} onChange={(e) => setInvRole(e.target.value as Role)}>
              {inviteRoles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
            <button className="btn btn-primary" disabled={invite.isPending}><UserPlus size={16} aria-hidden /> Convidar</button>
          </form>
          {link && (
            <div className="set-link" role="status">
              <span>Envie este link à pessoa:</span>
              <code>{link}</code>
              <button className="btn btn-line btn-sm" onClick={() => navigator.clipboard?.writeText(link).then(() => toast("Link copiado"))}><Copy size={14} aria-hidden /> Copiar</button>
            </div>
          )}
          {pending.length > 0 && (
            <>
              <h3 className="set-sub">Convites pendentes <span className="badge">{pending.length}</span></h3>
              <ul className="set-list">
                {pending.map((i) => (
                  <li key={i.id} className="set-item">
                    <span className="set-item-main"><strong>{i.email}</strong><span className="muted">expira em {new Date(i.expires_at).toLocaleDateString("pt-BR")}</span></span>
                    <span className="badge">{ROLE_LABEL[i.role]}</span>
                    <button className="btn btn-ghost btn-sm" onClick={() => revoke.mutate(i.id)}>Revogar</button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {invites.data && pending.length === 0 && <p className="muted set-note" style={{ marginTop: 10 }}>Sem convites pendentes.</p>}
        </section>
      )}

      <section className="card">
        <div className="set-head set-head-row">
          <div>
            <h2>Membros {members.data && <span className="badge">{all.length}</span>}</h2>
            <p className="muted">{isAdmin ? "Mude o perfil de alguém no seletor ao lado do nome." : "Só o Gestor altera perfis e remove pessoas."}</p>
          </div>
          {all.length > 6 && (
            <label className="orgc-search set-filter">
              <Search size={15} aria-hidden />
              <span className="sr-only">Filtrar membros</span>
              <input className="input" type="search" placeholder="Filtrar por nome ou e-mail…" value={filter} onChange={(e) => setFilter(e.target.value)} />
            </label>
          )}
        </div>
        {members.isLoading && <Loading />}
        {members.isError && <ErrorBox error={members.error} onRetry={() => members.refetch()} />}
        {members.data && list.length === 0 && <Empty title="Ninguém com esse nome" />}
        <ul className="set-list">
          {list.map((m) => (
            <li key={m.id} className="set-item">
              <Avatar id={m.id} name={m.name} photoVersion={m.photo_version} size={32} />
              <span className="set-item-main">
                <strong>{m.name}{m.id === user.id && <span className="muted"> (você)</span>}</strong>
                <span className="muted">{m.email}</span>
              </span>
              {isAdmin ? (
                <>
                  <select className="select" style={{ width: "auto" }} aria-label={`Papel de ${m.name}`} value={m.role} onChange={(e) => setRole.mutate({ id: m.id, role: e.target.value as Role })}>
                    {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </select>
                  {m.id !== user.id ? (
                    <button className="btn btn-ghost btn-sm set-danger" aria-label={`Remover ${m.name}`} title="Remover do espaço" onClick={() => confirm(`Remover ${m.name} do espaço?`) && remove.mutate(m.id)}>
                      <Trash2 size={16} aria-hidden />
                    </button>
                  ) : <span className="set-item-spacer" aria-hidden />}
                </>
              ) : <span className="badge">{ROLE_LABEL[m.role]}</span>}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function SpacesSection({ current, workspaces, open, onDone, onError }: { current: Workspace; workspaces: Workspace[]; open: (id: string) => void; onDone: Done; onError: Fail }) {
  const [teamName, setTeamName] = useState("");
  const createTeam = useMutation({
    mutationFn: () => api.post<{ id: string }>("/workspaces", { name: teamName }),
    onSuccess: (w) => (setTeamName(""), open(w.id), onDone("Espaço criado")()),
    onError,
  });
  return (
    <>
      <section className="card">
        <SectionHead title="Espaços em que você participa">Cada espaço tem seus projetos, pessoas e permissões. As outras seções desta página valem para o espaço atual.</SectionHead>
        <ul className="set-list">
          {workspaces.map((w) => (
            <li key={w.id} className={`set-item${w.id === current.id ? " is-current" : ""}`}>
              <span className="set-item-main">
                <strong>{w.name}</strong>
                <span className="muted">{w.kind === "personal" ? "Pessoal" : "Equipe"} · {ROLE_LABEL[w.role]}</span>
              </span>
              {w.id !== current.id ? <button className="btn btn-line btn-sm" onClick={() => open(w.id)}>Abrir</button> : <span className="badge ok">Atual</span>}
            </li>
          ))}
        </ul>
      </section>
      <section className="card">
        <SectionHead title="Criar espaço de equipe">Você vira Gestor do novo espaço e pode convidar pessoas em seguida.</SectionHead>
        <form className="row" onSubmit={(e: FormEvent) => (e.preventDefault(), createTeam.mutate())}>
          <label className="sr-only" htmlFor="team-name">Nome do novo espaço de equipe</label>
          <input id="team-name" className="input grow" placeholder="Nome do espaço…" value={teamName} onChange={(e) => setTeamName(e.target.value)} />
          <button className="btn btn-primary" disabled={teamName.trim().length < 2 || createTeam.isPending}><Plus size={16} aria-hidden /> Criar espaço</button>
        </form>
      </section>
      <ImportWorkspace targets={workspaces.filter((w) => w.role === "admin")} onDone={(id) => (open(id), onDone("Espaço importado")())} onError={onError} />
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
    <form className="card" onSubmit={(e: FormEvent) => (e.preventDefault(), run.mutate())}>
      <h2>Importar espaço</h2>
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
