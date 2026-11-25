import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { ErrorBox, Loading } from "../../components/ui";
import { ROLE_LABEL, type Role } from "../../domain/types";
import { api } from "../../services/api";
import { useSession } from "../../app/session";

export interface Profile {
  id: string;
  name: string;
  email: string;
  matricula: string | null;
  allotment: string | null;
  timezone: string;
  created_at: string;
  origin: "gia" | "local";
  unit: { sigla: string; label: string } | null;
  heads_of: { sigla: string; label: string }[];
  workspaces: { id: string; name: string; kind: "personal" | "team"; org_unit: string | null; role: Role }[];
}

/** Mês e ano por extenso a partir do instante UTC do cadastro, no fuso da pessoa. */
function since(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone });
}

export function ProfilePage() {
  const { workspace, setWorkspaceId } = useSession();
  const q = useQuery({ queryKey: ["me", "profile"], queryFn: () => api.get<Profile>("/me/profile") });

  if (q.isLoading) return <Loading label="Carregando seu perfil…" />;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const p = q.data!;
  const facts: [string, string][] = [
    ["Matrícula", p.matricula ?? "Sem matrícula (conta local)"],
    ["E-mail", p.email],
    ["Entrada", p.origin === "gia" ? "Pelo GIA" : "E-mail e senha"],
    ["Fuso horário", p.timezone],
    ["Na plataforma desde", since(p.created_at, p.timezone)],
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">Perfil</p>
          <h1>{p.name}</h1>
        </div>
      </div>

      <section className="card" aria-labelledby="perfil-dados">
        <h2 id="perfil-dados">Seus dados</h2>
        <dl className="pv-facts">
          {facts.map(([label, value]) => (
            <div key={label}><dt className="coord">{label}</dt><dd>{value}</dd></div>
          ))}
        </dl>
        <p className="muted" style={{ marginTop: 14 }}>
          {p.origin === "gia"
            ? "Nome, e-mail e lotação vêm do GIA e são atualizados a cada entrada; correções são feitas no próprio GIA."
            : <>O fuso horário pode ser alterado em <Link to="/configuracoes">Configurações</Link>.</>}
        </p>
      </section>

      <section className="card" aria-labelledby="perfil-unidade">
        <h2 id="perfil-unidade">Lotação e unidade</h2>
        <dl className="pv-facts">
          <div><dt className="coord">Lotação no GIA</dt><dd>{p.allotment || "Não informada"}</dd></div>
          <div>
            <dt className="coord">Unidade no organograma</dt>
            <dd>{p.unit ? p.unit.label : p.allotment ? "Lotação sem sigla do organograma" : "Sem unidade"}</dd>
          </div>
          {p.heads_of.length > 0 && (
            <div><dt className="coord">Titular de</dt><dd>{p.heads_of.map((u) => u.label).join(", ")}</dd></div>
          )}
        </dl>
      </section>

      <section className="card" aria-labelledby="perfil-espacos">
        <h2 id="perfil-espacos">Seus espaços</h2>
        <ul className="task-list" style={{ marginTop: 12 }}>
          {p.workspaces.map((w) => (
            <li key={w.id} className="task-row">
              <span style={{ flex: 1, minWidth: 0 }}>
                {w.name}{" "}
                <span className="badge">{w.kind === "personal" ? "Pessoal" : w.org_unit ? `Unidade ${w.org_unit}` : "Equipe"}</span>{" "}
                <span className="muted">{ROLE_LABEL[w.role]}</span>
              </span>
              {w.id !== workspace.id ? <button className="btn btn-line btn-sm" onClick={() => setWorkspaceId(w.id)}>Abrir</button> : <span className="badge ok">Atual</span>}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
