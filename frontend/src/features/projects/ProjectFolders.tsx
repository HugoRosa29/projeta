import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Folder as FolderIcon, FolderInput, FolderOpen, FolderOutput, FolderPlus, Layers, Pencil, Trash2 } from "lucide-react";
import { createContext, useContext, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { useContextMenu, type MenuItem } from "../../components/ContextMenu";
import { Dialog, useToast } from "../../components/ui";
import type { Folder } from "../../domain/areas";
import type { Project } from "../../domain/types";
import { useFolderMutations } from "../today/Folders";

/** Tipo do dado arrastado: só o id do projeto, para não aceitar arrastos de outras origens. */
export const DRAG_TYPE = "application/x-projeta-project";
const DEFAULT_NAME = "Nova pasta";

/** Onde a pasta está sendo renomeada: no painel lateral ou no cartão da área principal. */
type Place = "tree" | "grid";

interface Explorer {
  folders: Folder[];
  current: Folder | null;
  counts: Map<string, number>;
  canManage: boolean;
  dragging: boolean;
  renaming: { id: string; at: Place } | null;
  open: (id: string | null) => void;
  move: (projectId: string, folderId: string | null) => void;
  rename: (f: Folder, at: Place) => void;
  stopRenaming: () => void;
  saveName: (f: Folder, name: string) => void;
  askDelete: (f: Folder) => void;
  newFolder: (at: Place) => void;
  menu: (e: MouseEvent, items: MenuItem[]) => void;
  /** Props de arrastar de um projeto: vazio para quem não organiza e para projeto recebido. */
  dragProps: (p: Project) => object;
  projectMenu: (e: MouseEvent, p: Project) => void;
}

const Ctx = createContext<Explorer | null>(null);
export const useExplorer = () => {
  const x = useContext(Ctx);
  if (!x) throw new Error("useExplorer fora do ExplorerProvider");
  return x;
};

/** "Nova pasta", "Nova pasta (2)"…, como o sistema faz, sem colidir com as existentes. */
export function freeName(folders: Folder[]): string {
  const taken = new Set(folders.map((f) => f.name.toLocaleLowerCase("pt-BR")));
  if (!taken.has(DEFAULT_NAME.toLocaleLowerCase("pt-BR"))) return DEFAULT_NAME;
  let n = 2;
  while (taken.has(`${DEFAULT_NAME} (${n})`.toLocaleLowerCase("pt-BR"))) n++;
  return `${DEFAULT_NAME} (${n})`;
}

/** Estado e ações do explorador de pastas da tela de projetos. Mover é otimista: o projeto muda
 *  de lugar na hora e a lista se corrige se o servidor recusar. Quem decide é sempre o servidor. */
export function ExplorerProvider({ workspaceId, folders, projects, canManage, current, onOpen, children }: {
  workspaceId: string;
  folders: Folder[];
  projects: Project[];
  canManage: boolean;
  current: Folder | null;
  onOpen: (id: string | null) => void;
  children: ReactNode;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const m = useFolderMutations(workspaceId);
  const [menuEl, menu] = useContextMenu();
  const [renaming, setRenaming] = useState<{ id: string; at: Place } | null>(null);
  const [deleting, setDeleting] = useState<Folder | null>(null);
  const [dragging, setDragging] = useState(false);

  const known = new Set(folders.map((f) => f.id));
  const counts = new Map<string, number>();
  for (const p of projects) if (p.folder_id && known.has(p.folder_id)) counts.set(p.folder_id, (counts.get(p.folder_id) ?? 0) + 1);

  const move = (projectId: string, folderId: string | null) => {
    const p = projects.find((x) => x.id === projectId);
    if (!p || p.shared_from || (p.folder_id ?? null) === folderId) return;
    qc.setQueriesData<{ projects: Project[] }>({ queryKey: ["projects", workspaceId] }, (old) =>
      old && { ...old, projects: old.projects.map((r) => (r.id === projectId ? { ...r, folder_id: folderId } : r)) },
    );
    const target = folders.find((f) => f.id === folderId);
    m.move.mutate(
      { project: projectId, folder: folderId },
      {
        onSuccess: () => toast(target ? `“${p.name}” → ${target.name}` : `“${p.name}” saiu da pasta`),
        onError: (e) => {
          qc.invalidateQueries({ queryKey: ["projects", workspaceId] });
          toast((e as Error).message);
        },
      },
    );
  };

  const saveName = (f: Folder, name: string) => {
    setRenaming(null);
    const clean = name.trim();
    if (!clean || clean === f.name) return;
    m.rename.mutate({ id: f.id, name: clean }, { onError: (e) => toast((e as Error).message) });
  };

  const newFolder = (at: Place) =>
    m.create.mutate(freeName(folders), {
      // Como no sistema: a pasta nasce com o nome selecionado, pronto para digitar por cima.
      onSuccess: (f) => setRenaming({ id: f.id, at }),
      onError: (e) => toast((e as Error).message),
    });

  const remove = (f: Folder) =>
    m.remove.mutate(f.id, {
      onSuccess: () => {
        setDeleting(null);
        if (current?.id === f.id) onOpen(null);
        toast(`Pasta “${f.name}” excluída. Os projetos dela voltaram para fora de pasta.`);
      },
      onError: (e) => toast((e as Error).message),
    });

  const dragProps = (p: Project) =>
    canManage && !p.shared_from
      ? {
          draggable: true,
          onDragStart: (e: DragEvent) => {
            e.dataTransfer.setData(DRAG_TYPE, p.id);
            e.dataTransfer.effectAllowed = "move";
            setDragging(true);
          },
          onDragEnd: () => setDragging(false),
        }
      : {};

  const projectMenu = (e: MouseEvent, p: Project) => {
    const items: MenuItem[] = [
      { label: "Abrir", icon: <FolderOpen size={15} />, onSelect: () => nav(`/projetos/${p.id}`) },
      { label: "Abrir em nova aba", icon: <ExternalLink size={15} />, onSelect: () => window.open(`/projetos/${p.id}`, "_blank", "noopener") },
    ];
    if (canManage && !p.shared_from && folders.length) {
      items.push("sep", { heading: "Mover para" });
      for (const f of folders) {
        items.push({ label: f.name, icon: <FolderInput size={15} />, disabled: p.folder_id === f.id, onSelect: () => move(p.id, f.id) });
      }
      if (p.folder_id) items.push("sep", { label: "Tirar da pasta", icon: <FolderOutput size={15} />, onSelect: () => move(p.id, null) });
    }
    menu(e, items);
  };

  const x: Explorer = {
    folders, current, counts, canManage, dragging, renaming,
    open: onOpen, move, menu, dragProps, projectMenu, newFolder, saveName,
    rename: (f, at) => canManage && setRenaming({ id: f.id, at }),
    stopRenaming: () => setRenaming(null),
    askDelete: (f) => canManage && setDeleting(f),
  };
  const n = deleting ? counts.get(deleting.id) ?? 0 : 0;
  return (
    <Ctx.Provider value={x}>
      {children}
      {menuEl}
      {deleting && (
        <Dialog title="Excluir pasta" onClose={() => setDeleting(null)}>
          <p>
            Excluir a pasta <strong>{deleting.name}</strong>?{" "}
            {n ? `${n === 1 ? "O projeto dela não é apagado: volta" : `Os ${n} projetos dela não são apagados: voltam`} para fora de pasta.` : "Ela está vazia."}
          </p>
          <div className="row">
            <button type="button" className="btn btn-danger" onClick={() => remove(deleting)} disabled={m.remove.isPending} data-autofocus>Excluir pasta</button>
            <button type="button" className="btn btn-line" onClick={() => setDeleting(null)}>Cancelar</button>
          </div>
        </Dialog>
      )}
    </Ctx.Provider>
  );
}

/** Alvo de soltura. Conta entradas e saídas: passar sobre um filho do alvo não apaga o realce. */
function useDrop(onDrop: (projectId: string) => void, enabled: boolean) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  if (!enabled) return { over: false, props: {} };
  const accepts = (e: DragEvent) => e.dataTransfer.types.includes(DRAG_TYPE);
  return {
    over,
    props: {
      onDragEnter: (e: DragEvent) => {
        if (!accepts(e)) return;
        depth.current++;
        setOver(true);
      },
      onDragOver: (e: DragEvent) => {
        if (!accepts(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      },
      onDragLeave: (e: DragEvent) => {
        if (!accepts(e)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (!depth.current) setOver(false);
      },
      onDrop: (e: DragEvent) => {
        depth.current = 0;
        setOver(false);
        const id = e.dataTransfer.getData(DRAG_TYPE);
        if (!id) return;
        e.preventDefault();
        onDrop(id);
      },
    },
  };
}

const selectOnMount = (el: HTMLInputElement | null) => {
  if (el) {
    el.focus();
    el.select();
  }
};

/** Campo de renomear no lugar: nasce com o nome selecionado; Enter ou sair do campo salva, Esc
 *  desiste (como no explorador do sistema). */
function RenameField({ f }: { f: Folder }) {
  const x = useExplorer();
  const done = useRef(false);
  const finish = (save: boolean, value: string) => {
    if (done.current) return;
    done.current = true;
    if (save) x.saveName(f, value);
    else x.stopRenaming();
  };
  return (
    <input
      className="px-rename"
      defaultValue={f.name}
      maxLength={60}
      aria-label={`Novo nome de ${f.name}`}
      ref={selectOnMount}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(true, e.currentTarget.value);
        if (e.key === "Escape") finish(false, "");
      }}
      onBlur={(e) => finish(true, e.currentTarget.value)}
    />
  );
}

/** Uma pasta, no painel lateral ("tree") ou como cartão na área principal ("grid"). Clique abre;
 *  F2 renomeia; Delete exclui; botão direito abre o menu; soltar um projeto guarda nela. */
function FolderItem({ f, at }: { f: Folder; at: Place }) {
  const x = useExplorer();
  const drop = useDrop((pid) => x.move(pid, f.id), x.canManage);
  const editing = x.renaming?.id === f.id && x.renaming.at === at;
  const n = x.counts.get(f.id) ?? 0;
  const active = x.current?.id === f.id;
  const items: MenuItem[] = [{ label: "Abrir", icon: <FolderOpen size={15} />, onSelect: () => x.open(f.id) }];
  if (x.canManage) {
    items.push(
      "sep",
      { label: "Renomear", icon: <Pencil size={15} />, hint: "F2", onSelect: () => x.rename(f, at) },
      { label: "Excluir", icon: <Trash2 size={15} />, hint: "Del", danger: true, onSelect: () => x.askDelete(f) },
    );
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "F2") {
      e.preventDefault();
      x.rename(f, at);
    }
    if (e.key === "Delete") {
      e.preventDefault();
      x.askDelete(f);
    }
  };
  const tree = at === "tree";
  const cls = `${tree ? "px-node" : "pf-folder"}${active ? " on" : ""}${drop.over ? " pf-drop" : ""}${x.dragging && x.canManage ? " pf-target" : ""}`;
  const Icon = active ? FolderOpen : FolderIcon;
  const icon = <Icon size={tree ? 16 : 22} aria-hidden className="pf-folder-ico" />;
  return (
    <li className={cls} {...drop.props}>
      {editing ? (
        <span className={tree ? "px-node-btn" : "pf-folder-btn"}>
          {icon}
          <RenameField f={f} />
        </span>
      ) : (
        <button
          type="button"
          className={tree ? "px-node-btn" : "pf-folder-btn"}
          aria-current={active ? "page" : undefined}
          onClick={() => x.open(f.id)}
          onKeyDown={onKey}
          onContextMenu={(e) => x.menu(e, items)}
          title={x.canManage ? `${f.name} · F2 renomeia, botão direito mostra opções` : f.name}
        >
          {icon}
          <span className="pf-folder-name">{f.name}</span>
          <span className="pf-folder-n muted">{tree ? n : `${n} ${n === 1 ? "projeto" : "projetos"}`}</span>
        </button>
      )}
    </li>
  );
}

/** Painel lateral, como o de navegação do explorador: a raiz e todas as pastas, sempre à mão
 *  para soltar um projeto, mesmo com outra pasta aberta. */
export function FolderTree({ total }: { total: number }) {
  const x = useExplorer();
  const drop = useDrop((pid) => x.move(pid, null), x.canManage);
  const rootItems: MenuItem[] = [{ label: "Abrir", icon: <FolderOpen size={15} />, onSelect: () => x.open(null) }];
  if (x.canManage) rootItems.push("sep", { label: "Nova pasta", icon: <FolderPlus size={15} />, onSelect: () => x.newFolder("tree") });
  return (
    <nav className="px-tree" aria-label="Pastas de projetos">
      <ul>
        <li className={`px-node px-root${x.current ? "" : " on"}${drop.over ? " pf-drop" : ""}${x.dragging && x.canManage ? " pf-target" : ""}`} {...drop.props}>
          <button type="button" className="px-node-btn" aria-current={x.current ? undefined : "page"} onClick={() => x.open(null)} onContextMenu={(e) => x.menu(e, rootItems)} title={x.canManage ? "Solte aqui para tirar o projeto da pasta" : undefined}>
            <Layers size={16} aria-hidden className="pf-folder-ico" />
            <span className="pf-folder-name">Projetos</span>
            <span className="pf-folder-n muted">{total}</span>
          </button>
        </li>
      </ul>
      {(x.folders.length > 0 || x.canManage) && <p className="px-heading" aria-hidden>Pastas</p>}
      {x.folders.length > 0 && (
        <ul className="px-tree-folders">
          {x.folders.map((f) => <FolderItem key={f.id} f={f} at="tree" />)}
        </ul>
      )}
      {x.canManage && (
        <>
          <button type="button" className="px-node-btn px-new" onClick={() => x.newFolder("tree")}>
            <FolderPlus size={16} aria-hidden className="px-new-ico" />
            <span className="pf-folder-name">Nova pasta</span>
          </button>
          <p className="px-tip">Arraste um projeto até uma pasta para guardá-lo. Botão direito mostra mais opções; F2 renomeia.</p>
        </>
      )}
    </nav>
  );
}

/** Pastas como cartões na raiz, antes dos projetos soltos. */
export function FolderGrid() {
  const x = useExplorer();
  if (!x.folders.length) return null;
  return (
    <ul className="pf-folders" aria-label="Pastas">
      {x.folders.map((f) => <FolderItem key={f.id} f={f} at="grid" />)}
    </ul>
  );
}

/** Título da pasta aberta, com renomear e excluir à vista (além do F2 e do menu). */
export function FolderTitle({ f }: { f: Folder }) {
  const x = useExplorer();
  return (
    <div className="pf-path">
      <FolderOpen size={20} aria-hidden className="pf-folder-ico" />
      <h2 className="pf-path-name">{f.name}</h2>
      {x.canManage && (
        <>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => x.rename(f, "tree")}><Pencil size={14} aria-hidden /> Renomear</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => x.askDelete(f)}><Trash2 size={14} aria-hidden /> Excluir pasta</button>
        </>
      )}
    </div>
  );
}
