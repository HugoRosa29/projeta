import { useEffect } from "react";

/**
 * Movimento discreto da interface, sem dependências: revelação ao rolar.
 * Nada reage ao ponteiro do mouse.
 *
 * Tudo é aprimoramento: sem JS, sem IntersectionObserver ou com "reduzir movimento" ligado,
 * o conteúdo aparece normal e nada fica escondido.
 */

const REVEAL = ".card, .page-head, .empty, .column, .timeline, .cal, .quick-add, .hero, .pf-card";
const SKIP = ".overlay, .assistant-panel";

const media = (q: string) => typeof window.matchMedia === "function" && window.matchMedia(q).matches;

export function useMotion() {
  useEffect(() => {
    if (media("(prefers-reduced-motion: reduce)")) return;
    const cleanups: Array<() => void> = [];

    /* ---------- revelação ao rolar ---------- */
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (!e.isIntersecting) continue;
            (e.target as HTMLElement).dataset.rv = "1";
            io.unobserve(e.target);
          }
        },
        { threshold: 0.08, rootMargin: "0px 0px -6% 0px" },
      );
      let frame = 0;
      const scan = () => {
        frame = 0;
        const fresh = Array.from(document.querySelectorAll<HTMLElement>(REVEAL)).filter((el) => !el.dataset.rv && !el.closest(SKIP));
        fresh.forEach((el, i) => {
          const r = el.getBoundingClientRect();
          // Já passou da tela (ex.: voltou a uma página rolada): não esconde.
          if (r.bottom < 0) return void (el.dataset.rv = "1");
          el.style.setProperty("--rv-d", `${Math.min(i, 6) * 70}ms`);
          el.dataset.rv = "0";
          io.observe(el);
        });
      };
      const schedule = () => {
        if (!frame) frame = requestAnimationFrame(scan);
      };
      const mo = new MutationObserver(schedule);
      mo.observe(document.body, { childList: true, subtree: true });
      schedule();
      cleanups.push(() => {
        mo.disconnect();
        io.disconnect();
        if (frame) cancelAnimationFrame(frame);
      });
    }

    return () => cleanups.forEach((fn) => fn());
  }, []);
}
