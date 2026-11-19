import { Fragment, type ReactNode } from "react";
import { Link } from "react-router";

/* Markdown mínimo e seguro para as respostas do assistente: só monta elementos React
   (nunca HTML bruto), então o texto do modelo continua sendo dado, não marcação executável. */

const INLINE = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|\[[^\]\n]+\]\([^)\s]+\))/g;

function inline(text: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    if (!part) return null;
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) return <code key={i}>{part.slice(1, -1)}</code>;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return <strong key={i}>{inline(part.slice(2, -2))}</strong>;
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) return <em key={i}>{inline(part.slice(1, -1))}</em>;
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    if (link) {
      const [, label, href] = link;
      if (href.startsWith("/") && !href.startsWith("//")) return <Link key={i} to={href}>{label}</Link>;
      if (/^https:\/\//.test(href)) return <a key={i} href={href} target="_blank" rel="noopener noreferrer">{label}</a>;
      return <Fragment key={i}>{label}</Fragment>;
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

const BULLET = /^\s*[-*•]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.trimStart().startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) code.push(lines[i++]);
      i++;
      out.push(<pre key={key++}><code>{code.join("\n")}</code></pre>);
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      out.push(<p key={key++} className="md-h">{inline(h[2])}</p>);
      i++;
      continue;
    }
    if (BULLET.test(line) || ORDERED.test(line)) {
      const ordered = ORDERED.test(line) && !BULLET.test(line);
      const rx = ordered ? ORDERED : BULLET;
      const items: ReactNode[] = [];
      while (i < lines.length && rx.test(lines[i])) {
        items.push(<li key={items.length}>{inline(rx.exec(lines[i])![1])}</li>);
        i++;
      }
      out.push(ordered ? <ol key={key++}>{items}</ol> : <ul key={key++}>{items}</ul>);
      continue;
    }
    if (line.startsWith(">")) {
      const q: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) q.push(lines[i++].replace(/^>\s?/, ""));
      out.push(<blockquote key={key++}>{inline(q.join(" "))}</blockquote>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !BULLET.test(lines[i]) && !ORDERED.test(lines[i]) && !/^#{1,4}\s/.test(lines[i]) && !lines[i].trimStart().startsWith("```") && !lines[i].startsWith(">")) para.push(lines[i++]);
    out.push(
      <p key={key++}>
        {para.map((p, n) => (
          <Fragment key={n}>
            {n > 0 && <br />}
            {inline(p)}
          </Fragment>
        ))}
      </p>,
    );
  }
  return <div className="md">{out}</div>;
}
