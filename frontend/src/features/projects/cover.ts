import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "../../components/ui";
import { api } from "../../services/api";

/** A versão (data da última troca) entra na URL: trocar a imagem invalida o cache do navegador. */
export const coverUrl = (projectId: string, version: string) => `/api/v1/projects/${projectId}/cover?v=${encodeURIComponent(version)}`;

const MAX_WIDTH = 1800;

/** Reduz no navegador antes de enviar: capa de banner não precisa de foto em 12 MP. */
async function prepare(file: File): Promise<Blob> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("Formato não aceito. Envie uma imagem PNG, JPEG ou WebP.");
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, MAX_WIDTH / bmp.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const toBlob = (type: string) => new Promise<Blob | null>((ok) => canvas.toBlob(ok, type, 0.86));
  const out = (await toBlob("image/webp")) ?? (await toBlob("image/jpeg"));
  if (!out) throw new Error("Não foi possível preparar a imagem. Tente outro arquivo.");
  return out;
}

export function useCoverActions(projectId: string) {
  const qc = useQueryClient();
  const toast = useToast();
  const refresh = () => {
    for (const k of ["project", "projects"]) qc.invalidateQueries({ queryKey: [k] });
  };
  const upload = useMutation({
    mutationFn: async (file: File) => api.upload(`/projects/${projectId}/cover`, await prepare(file)),
    onSuccess: () => (refresh(), toast("Imagem do projeto atualizada")),
    onError: (e) => toast((e as Error).message),
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/projects/${projectId}/cover`),
    onSuccess: () => (refresh(), toast("Imagem removida")),
    onError: (e) => toast((e as Error).message),
  });
  return { upload, remove };
}
