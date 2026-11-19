export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

function qs(q?: Query): string {
  if (!q) return "";
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

async function request<T>(method: string, path: string, body?: unknown, query?: Query): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}${qs(query)}`, {
      method,
      credentials: "same-origin",
      headers: { "X-Requested-With": "projeta-web", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "network", "Sem conexão com o servidor. Verifique a internet e tente de novo.");
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = data?.error;
    throw new ApiError(res.status, e?.code ?? "error", e?.message ?? "Algo deu errado. Tente novamente.", e?.details);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>("GET", path, undefined, query),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  del: <T>(path: string, query?: Query) => request<T>("DELETE", path, undefined, query),
  /** Envia o arquivo cru (sem multipart); o servidor decide o tipo pelo conteúdo. */
  upload: async <T>(path: string, file: Blob): Promise<T> => {
    let res: Response;
    try {
      res = await fetch(`/api/v1${path}`, { method: "PUT", credentials: "same-origin", headers: { "X-Requested-With": "projeta-web", "Content-Type": file.type || "application/octet-stream" }, body: file });
    } catch {
      throw new ApiError(0, "network", "Sem conexão com o servidor. Verifique a internet e tente de novo.");
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? "error", data?.error?.message ?? "Não foi possível enviar a imagem. Tente novamente.");
    return data as T;
  },
  /** Baixa uma resposta como arquivo (ex.: exportação do espaço). */
  download: async (path: string, filename: string): Promise<void> => {
    let res: Response;
    try {
      res = await fetch(`/api/v1${path}`, { credentials: "same-origin", headers: { "X-Requested-With": "projeta-web" } });
    } catch {
      throw new ApiError(0, "network", "Sem conexão com o servidor. Verifique a internet e tente de novo.");
    }
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new ApiError(res.status, data?.error?.code ?? "error", data?.error?.message ?? "Não foi possível baixar o arquivo. Tente novamente.");
    }
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement("a"), { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
  /** Envia um arquivo cru por POST (o servidor valida o conteúdo). */
  sendFile: async <T>(path: string, file: Blob, query?: Query): Promise<T> => {
    let res: Response;
    try {
      res = await fetch(`/api/v1${path}${qs(query)}`, { method: "POST", credentials: "same-origin", headers: { "X-Requested-With": "projeta-web", "Content-Type": "application/json" }, body: file });
    } catch {
      throw new ApiError(0, "network", "Sem conexão com o servidor. Verifique a internet e tente de novo.");
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? "error", data?.error?.message ?? "Não foi possível enviar o arquivo. Tente novamente.");
    return data as T;
  },
};
