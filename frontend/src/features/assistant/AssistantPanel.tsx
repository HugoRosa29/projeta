import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, Check, CheckCircle2, Copy, CalendarPlus, MessageSquareText, ExternalLink, ListChecks, CalendarClock, OctagonAlert, FileText, LayoutGrid, Maximize2, Minimize2, Sparkles, Trash2, Users, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link } from "react-router";
import { useProjectContext } from "../../app/projectContext";
import { useSession } from "../../app/session";
import { Markdown } from "../../components/Markdown";
import { ErrorBox, useToast } from "../../components/ui";
import { api } from "../../services/api";
import { ProposalCard } from "./ProposalCard";
import type { ChatMessage, Conversation, StreamEvent } from "./types";

// Com um projeto aberto, as sugestões falam dele; fora, do panorama da pessoa e do espaço.
const SUGGESTIONS = [
  { text: "Como está meu dia?", icon: CalendarClock },
  { text: "Panorama do portfólio", icon: LayoutGrid },
  { text: "Quem está sobrecarregado?", icon: Users },
  { text: "Qual projeto ficou parado?", icon: ListChecks },
];
const PROJECT_SUGGESTIONS = [
  { text: "Resuma o projeto para a reunião", icon: FileText },
  { text: "O que está bloqueando a entrega?", icon: OctagonAlert },
  { text: "Como está meu dia?", icon: CalendarClock },
  { text: "Quem está sobrecarregado?", icon: Users },
];

// Modelos de atualização: preenchem o campo (não enviam), para a pessoa completar com a tarefa.
const UPDATE_TEMPLATES = [
  { label: "Concluir uma tarefa", text: "Conclua a tarefa ", icon: CheckCircle2 },
  { label: "Registrar andamento", text: "Comente na tarefa ", icon: MessageSquareText },
  { label: "Mudar um prazo", text: "Mude o prazo da tarefa ", icon: CalendarPlus },
];

export function AssistantPanel({ onClose, expanded, onToggleExpand, draft }: { onClose: () => void; expanded: boolean; onToggleExpand: () => void; draft?: { text: string; seq: number } | null }) {
  const { workspace } = useSession();
  const { project } = useProjectContext();
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState("");
  const [pendingText, setPendingText] = useState<string | null>(null);
  const [lastFailed, setLastFailed] = useState<string | null>(null);
  // Resposta chegando: texto parcial e a ferramenta em uso (antes do primeiro trecho).
  const [streamText, setStreamText] = useState("");
  const [toolLabel, setToolLabel] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const key = ["assistant", workspace.id];

  const conv = useQuery({ queryKey: key, queryFn: () => api.get<Conversation>("/assistant/conversation", { workspace_id: workspace.id }) });
  const messages = conv.data?.messages ?? [];

  const send = useMutation({
    mutationFn: (message: string) =>
      api.stream<StreamEvent>("/assistant/chat/stream", { workspace_id: workspace.id, project_id: project?.id ?? null, message }, (ev) => {
        if (ev.type === "delta") setStreamText((t) => t + ev.text);
        else if (ev.type === "reset") setStreamText("");
        else if (ev.type === "tool") setToolLabel(ev.label);
      }),
    onMutate: (m) => (setPendingText(m), setLastFailed(null), setStreamText(""), setToolLabel(null)),
    onError: (_e, m) => setLastFailed(m),
    onSettled: async () => {
      await qc.invalidateQueries({ queryKey: key });
      setPendingText(null);
      setStreamText("");
      setToolLabel(null);
    },
  });
  const resolve = useMutation({
    mutationFn: (v: { pending_action: unknown; task_id: string }) => api.post("/assistant/resolve", { workspace_id: workspace.id, project_id: project?.id ?? null, ...v }),
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e) => toast((e as Error).message),
  });
  const clear = useMutation({
    mutationFn: () => api.del("/assistant/conversation", { workspace_id: workspace.id }),
    onSuccess: () => (qc.invalidateQueries({ queryKey: key }), toast("Histórico do assistente excluído")),
  });

  const prefill = (value: string) => {
    setText(value);
    const el = inputRef.current;
    if (!el) return;
    // Espera o React gravar o valor para posicionar o cursor no fim e ajustar a altura.
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(value.length, value.length);
      grow(el);
    });
  };
  const draftSeq = draft?.seq;
  useEffect(() => {
    if (draft) prefill(draft.text);
    // Só reage a um pedido novo (seq), não a cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftSeq]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && onToggleExpand();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [expanded, onToggleExpand]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [messages.length, pendingText, send.isError, streamText, toolLabel]);

  const submit = (e: FormEvent, override?: string) => {
    e.preventDefault();
    const m = (override ?? text).trim();
    if (!m || send.isPending) return;
    setText("");
    if (inputRef.current) inputRef.current.style.height = "";
    send.mutate(m);
  };
  const grow = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) submit(e);
  };

  return (
    <aside className={`assistant-panel ${expanded ? "full" : ""}`} id="assistant" aria-label="Assistente">
      <div className="as-head">
        <div className="top">
          <h2>Assistente</h2>
          <button className="icon-btn" aria-label="Excluir histórico do assistente" title="Excluir histórico" onClick={() => confirm("Excluir todo o seu histórico com o assistente neste espaço? Isso não pode ser desfeito.") && clear.mutate()}>
            <Trash2 size={18} />
          </button>
          <button className="icon-btn" aria-label={expanded ? "Sair da tela cheia" : "Abrir em tela cheia"} title={expanded ? "Sair da tela cheia (Esc)" : "Tela cheia"} onClick={onToggleExpand}>
            {expanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
          <button className="icon-btn" aria-label="Fechar assistente" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <p className="coord" aria-live="polite">
          Consultando: {workspace.name}
          {project ? ` › ${project.name}` : " › espaço inteiro"}
        </p>
      </div>

      <div className="as-body" ref={bodyRef} role="log" aria-live="polite" aria-label="Conversa">
        <div className="as-thread">
          {conv.isError && <ErrorBox error={conv.error} onRetry={() => conv.refetch()} />}
          {messages.length === 0 && !pendingText && (
            <div className="as-empty">
              <span className="as-logo" aria-hidden><Sparkles size={22} /></span>
              <h3>Como posso ajudar hoje?</h3>
              <p>Pergunte sobre prazos, projetos, pessoas e riscos, conte o que mudou numa tarefa, ou descreva um objetivo e eu proponho fases, tarefas e marcos. Nada é criado ou alterado sem a sua confirmação.</p>
              <div className="as-suggest">
                {(project ? PROJECT_SUGGESTIONS : SUGGESTIONS).map(({ text: t, icon: Icon }) => (
                  <button key={t} type="button" className="as-card" onClick={(e) => submit(e, t)}>
                    <Icon size={18} aria-hidden /> <span>{t}</span>
                  </button>
                ))}
              </div>
              <p className="as-subtitle">Atualizar sem abrir telas</p>
              <div className="as-suggest" role="group" aria-label="Modelos de atualização">
                {UPDATE_TEMPLATES.map(({ label, text: t, icon: Icon }) => (
                  <button key={label} type="button" className="as-card" onClick={() => prefill(t)}>
                    <Icon size={18} aria-hidden /> <span>{label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m) => (
            <MessageView key={m.id} m={m} onChoose={(task_id) => m.pending_action && resolve.mutate({ pending_action: m.pending_action, task_id })} />
          ))}
          {pendingText && (
            <>
              <div className="as-row user"><div className="as-bubble">{pendingText}</div></div>
              <div className="as-row assistant" role="status" aria-label="O assistente está respondendo" aria-busy="true">
                <span className="as-avatar" aria-hidden><Sparkles size={16} /></span>
                <div className="as-content">
                  {streamText ? (
                    <Markdown text={streamText} />
                  ) : (
                    <>
                      <span className="as-dots" aria-hidden><i /><i /><i /></span>
                      {toolLabel && <span className="as-working">{toolLabel}…</span>}
                    </>
                  )}
                </div>
              </div>
            </>
          )}
          {send.isError && lastFailed && <ErrorBox error={send.error} onRetry={() => send.mutate(lastFailed)} />}
        </div>
      </div>

      <form className="as-foot" onSubmit={submit}>
        <div className="as-composer">
          <label className="sr-only" htmlFor="as-input">Mensagem para o assistente</label>
          <textarea
            id="as-input"
            ref={inputRef}
            rows={1}
            value={text}
            maxLength={2000}
            onChange={(e) => (setText(e.target.value), grow(e.target))}
            onKeyDown={onKey}
            placeholder="Pergunte alguma coisa…"
            autoComplete="off"
          />
          <button className="as-send" aria-label="Enviar" disabled={send.isPending || !text.trim()}>
            <ArrowUp size={18} aria-hidden />
          </button>
        </div>
        <p className="as-hint">Enter envia · Shift+Enter quebra a linha</p>
      </form>
    </aside>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="as-copy"
      aria-label="Copiar resposta"
      title="Copiar"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          window.setTimeout(() => setDone(false), 1500);
        }, () => {});
      }}
    >
      {done ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
    </button>
  );
}

function MessageView({ m, onChoose }: { m: ChatMessage; onChoose: (taskId: string) => void }) {
  if (m.role === "user") {
    return (
      <div className="as-row user">
        <div className="as-bubble">{m.content}</div>
      </div>
    );
  }
  return (
    <div className="as-row assistant">
      <span className="as-avatar" aria-hidden><Sparkles size={16} /></span>
      <div className="as-content">
        <Markdown text={m.content} />
        {m.links.length > 0 && (
          <div className="as-links">
            {m.links.map((l) => (
              <Link key={l.href} to={l.href} className="as-link">
                <ExternalLink size={14} aria-hidden /> {l.label}
              </Link>
            ))}
          </div>
        )}
        {m.candidates && m.candidates.length > 0 && (
          <div className="proposal" role="group" aria-label="Escolha a tarefa correta">
            <h3>Qual tarefa você quer dizer?</h3>
            <ul>
              {m.candidates.map((c) => (
                <li key={c.task_id}>
                  <button type="button" className="btn btn-line btn-sm" style={{ width: "100%", justifyContent: "flex-start" }} onClick={() => onChoose(c.task_id)}>
                    {c.label} <span className="muted">· {c.project ?? "pessoal"}{c.due_date ? ` · prazo ${c.due_date.split("-").reverse().join("/")}` : ""}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {m.proposal && <ProposalCard proposal={m.proposal} />}
        <div className="as-actions"><CopyButton text={m.content} /></div>
      </div>
    </div>
  );
}
