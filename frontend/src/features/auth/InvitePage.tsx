import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router";
import { AuthStage } from "../../components/AuthStage";
import { Logo } from "../../components/ui";
import { ThemeToggle } from "../../components/ThemeToggle";
import { api } from "../../services/api";
import { useSession } from "../../app/session";

export function InvitePage() {
  const { token = "" } = useParams();
  const { user, setWorkspaceId } = useSession();
  const qc = useQueryClient();
  const nav = useNavigate();
  const accept = useMutation({
    mutationFn: () => api.post<{ workspace_id: string }>("/invitations/accept", { token }),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ["me"] });
      setWorkspaceId(r.workspace_id);
      nav("/", { replace: true });
    },
  });
  return (
    <AuthStage>
      <div className="auth-card">
        <div className="auth-theme"><ThemeToggle /></div>
        <div className="brand"><Logo height={40} /></div>
        <h1>Convite para um espaço</h1>
        <p>Você está entrando como <strong>{user.email}</strong>. O convite só vale para o e-mail que foi convidado.</p>
        {accept.isError && <p className="form-error" role="alert" style={{ marginTop: 12 }}>{(accept.error as Error).message}</p>}
        <div className="row" style={{ marginTop: 18 }}>
          <button className="btn btn-primary" onClick={() => accept.mutate()} disabled={accept.isPending}>Aceitar convite</button>
          <Link to="/" className="btn btn-line">Agora não</Link>
        </div>
      </div>
    </AuthStage>
  );
}
