import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "../../components/ui";
import { api } from "../../services/api";

/** A versão (data da última troca) entra na URL: trocar a foto invalida o cache do navegador. */
export const photoUrl = (version: string) => `/api/v1/me/photo?v=${encodeURIComponent(version)}`;

const SIZE = 512;

/** Recorta o centro em quadrado e reduz no navegador: o servidor aceita até 1 MB. */
async function prepare(file: File): Promise<Blob> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("Formato não aceito. Envie uma imagem PNG, JPEG ou WebP.");
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const out = Math.min(SIZE, side);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = out;
  canvas.getContext("2d")!.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, out, out);
  bmp.close();
  const toBlob = (type: string) => new Promise<Blob | null>((ok) => canvas.toBlob(ok, type, 0.88));
  const blob = (await toBlob("image/webp")) ?? (await toBlob("image/jpeg"));
  if (!blob) throw new Error("Não foi possível preparar a imagem. Tente outro arquivo.");
  return blob;
}

export function usePhotoActions() {
  const qc = useQueryClient();
  const toast = useToast();
  const refresh = () => qc.invalidateQueries({ queryKey: ["me", "profile"] });
  const upload = useMutation({
    mutationFn: async (file: File) => api.upload("/me/photo", await prepare(file)),
    onSuccess: () => (refresh(), toast("Foto atualizada")),
    onError: (e) => toast((e as Error).message),
  });
  const remove = useMutation({
    mutationFn: () => api.del("/me/photo"),
    onSuccess: () => (refresh(), toast("Foto removida")),
    onError: (e) => toast((e as Error).message),
  });
  return { upload, remove };
}
