import { useState } from "react";

/** Iniciais do primeiro e do último nome ("Hugo Sousa Rosa" → "HR"). */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (parts[0][0] + last).toUpperCase();
}

/** A versão (data da última troca) entra na URL: trocar a foto invalida o cache do navegador. */
export const userPhotoUrl = (userId: string, version: string) =>
  `/api/v1/users/${encodeURIComponent(userId)}/photo?v=${encodeURIComponent(version)}`;

/** Foto da pessoa, ou as iniciais quando não há foto (ou ela não carrega). Decorativo: o nome
 * sempre aparece ao lado, então a imagem não repete o nome para leitores de tela. */
export function Avatar({ id, name, photoVersion, size = 32, className = "" }: { id: string; name: string; photoVersion?: string | null; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  const showPhoto = photoVersion && !failed;
  return (
    <span className={`avatar ${className}`} style={{ width: size, height: size, fontSize: size * 0.38 }} title={name} aria-hidden>
      {showPhoto ? <img src={userPhotoUrl(id, photoVersion)} alt="" onError={() => setFailed(true)} /> : initials(name)}
    </span>
  );
}
