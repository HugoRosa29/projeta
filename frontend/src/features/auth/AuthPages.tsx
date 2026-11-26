import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { AuthStage } from "../../components/AuthStage";
import { Logo } from "../../components/ui";
import { ThemeToggle } from "../../components/ThemeToggle";
import { api } from "../../services/api";

function AuthShell({ title, children, foot }: { title: string; children: React.ReactNode; foot: React.ReactNode }) {
  return (
    <AuthStage>
      <div className="auth-card">
        <div className="auth-theme"><ThemeToggle /></div>
        <div className="brand">
          <Logo height={40} />
        </div>
        <h1>{title}</h1>
        {children}
        <p className="muted" style={{ marginTop: 18 }}>
          {foot}
        </p>
      </div>
    </AuthStage>
  );
}

function useAuthSubmit(path: string) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent, body: unknown) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(path, body);
      await qc.invalidateQueries({ queryKey: ["me"] });
      const next = sp.get("next");
      nav(next && next.startsWith("/") && !next.startsWith("//") ? next : "/", { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { error, busy, submit };
}

type Mode = "gia" | "local" | "cadastro";

const MODES: { key: Mode; label: string; title: string; foot: string }[] = [
  { key: "gia", label: "GIA", title: "Entrar", foot: "Use a mesma matrícula e senha do GIA." },
  { key: "local", label: "E-mail", title: "Entrar", foot: "Para quem criou conta com e-mail e senha no Projeta." },
  { key: "cadastro", label: "Criar conta", title: "Criar conta", foot: "A conta por e-mail é independente do GIA e não entra no espaço de nenhuma lotação." },
];

function GiaForm() {
  const [matricula, setMatricula] = useState("");
  const [password, setPassword] = useState("");
  const { error, busy, submit } = useAuthSubmit("/auth/login");
  return (
    <form onSubmit={(e) => submit(e, { matricula, password })}>
      <div className="field">
        <label htmlFor="matricula">Matrícula</label>
        <input id="matricula" className="input" autoComplete="username" autoCapitalize="characters" required value={matricula} onChange={(e) => setMatricula(e.target.value)} data-autofocus />
      </div>
      <div className="field">
        <label htmlFor="password">Senha</label>
        <input id="password" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="btn btn-primary" style={{ width: "100%" }} disabled={busy}>Entrar com GIA</button>
    </form>
  );
}

function EmailForm({ register }: { register: boolean }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { error, busy, submit } = useAuthSubmit(register ? "/auth/register" : "/auth/login-local");
  return (
    <form onSubmit={(e) => submit(e, register ? { name, email, password } : { email, password })}>
      {register && (
        <div className="field">
          <label htmlFor="name">Nome</label>
          <input id="name" className="input" autoComplete="name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} data-autofocus />
        </div>
      )}
      <div className="field">
        <label htmlFor="email">E-mail</label>
        <input id="email" className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} data-autofocus={!register || undefined} />
      </div>
      <div className="field">
        <label htmlFor="local-password">Senha</label>
        <input id="local-password" className="input" type="password" autoComplete={register ? "new-password" : "current-password"} required minLength={register ? 8 : undefined} value={password} onChange={(e) => setPassword(e.target.value)} />
        {register && <small className="muted">Mínimo de 8 caracteres.</small>}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="btn btn-primary" style={{ width: "100%" }} disabled={busy}>{register ? "Criar conta" : "Entrar"}</button>
    </form>
  );
}

export function LoginPage() {
  const [mode, setMode] = useState<Mode>("gia");
  const current = MODES.find((m) => m.key === mode)!;
  return (
    <AuthShell title={current.title} foot={current.foot}>
      <div role="tablist" aria-label="Forma de entrada" style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        {MODES.map((m) => (
          <button key={m.key} type="button" role="tab" aria-selected={mode === m.key} className={`btn ${mode === m.key ? "btn-primary" : ""}`} style={{ flex: 1 }} onClick={() => setMode(m.key)}>
            {m.label}
          </button>
        ))}
      </div>
      {mode === "gia" ? <GiaForm key="gia" /> : <EmailForm key={mode} register={mode === "cadastro"} />}
    </AuthShell>
  );
}
