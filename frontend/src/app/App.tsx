import { Navigate, Route, Routes, useLocation } from "react-router";
import { ErrorBox, Loading } from "../components/ui";
import { ApiError } from "../services/api";
import { AgendaPage } from "../features/agenda/AgendaPage";
import { InvitePage } from "../features/auth/InvitePage";
import { LoginPage } from "../features/auth/AuthPages";
import { OkrPage } from "../features/okrs/OkrPage";
import { PortfolioPage } from "../features/portfolio/PortfolioPage";
import { ProfilePage } from "../features/profile/ProfilePage";
import { ProjectPage } from "../features/projects/ProjectPage";
import { ProjectsPage } from "../features/projects/ProjectsPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { MyTasksPage } from "../features/tasks/MyTasksPage";
import { TodayPage } from "../features/today/TodayPage";
import { AppLayout } from "./AppLayout";
import { ProjectContextProvider } from "./projectContext";
import { SessionProvider, useMe } from "./session";

function Protected() {
  const me = useMe();
  const loc = useLocation();
  if (me.isLoading) return <div className="auth"><Loading label="Carregando sua conta…" /></div>;
  if (me.isError) {
    if (me.error instanceof ApiError && me.error.status === 401) {
      const next = loc.pathname + loc.search;
      return <Navigate to={next === "/" ? "/entrar" : `/entrar?next=${encodeURIComponent(next)}`} replace />;
    }
    return <div className="auth"><ErrorBox error={me.error} onRetry={() => me.refetch()} /></div>;
  }
  return (
    <SessionProvider me={me.data!}>
      <ProjectContextProvider>
        <Routes>
          <Route path="convite/:token" element={<InvitePage />} />
          <Route element={<AppLayout />}>
            <Route index element={<TodayPage />} />
            <Route path="projetos" element={<ProjectsPage />} />
            <Route path="projetos/:id" element={<ProjectPage />} />
            <Route path="portfolio" element={<PortfolioPage />} />
            <Route path="metas" element={<OkrPage />} />
            <Route path="minhas-tarefas" element={<MyTasksPage />} />
            <Route path="agenda" element={<AgendaPage />} />
            <Route path="configuracoes" element={<SettingsPage />} />
            <Route path="perfil" element={<ProfilePage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </ProjectContextProvider>
    </SessionProvider>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/entrar" element={<LoginPage />} />
      <Route path="/*" element={<Protected />} />
    </Routes>
  );
}
