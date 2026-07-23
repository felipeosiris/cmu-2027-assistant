import { useEffect, useId, useRef } from "react";
import { marked } from "marked";
import mermaid from "mermaid";

let mermaidReady = false;

function ensureMermaid() {
  if (mermaidReady) return;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "loose",
    theme: "neutral",
    fontFamily: "Poppins, system-ui, sans-serif",
    themeVariables: {
      primaryColor: "#4472c4",
      primaryTextColor: "#002060",
      primaryBorderColor: "#002060",
      lineColor: "#5a6a80",
      secondaryColor: "#e8ecf2",
      tertiaryColor: "#f5f5f5",
      xyChart: {
        backgroundColor: "#ffffff",
        titleColor: "#002060",
        xAxisLabelColor: "#002060",
        xAxisTitleColor: "#002060",
        xAxisTickColor: "#5a6a80",
        xAxisLineColor: "#c5ced9",
        yAxisLabelColor: "#002060",
        yAxisTitleColor: "#002060",
        yAxisTickColor: "#5a6a80",
        yAxisLineColor: "#c5ced9",
        plotColorPalette: "#002060, #4472c4, #ed7d31",
      },
    },
  });
  mermaidReady = true;
}

function decodeEntities(html: string) {
  return html
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function escapeHtml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeForMermaid(source: string) {
  return source
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Convierte bloques ```mermaid en divs listos para Mermaid. */
export function markdownToHtml(md: string): string {
  const html = marked.parse(md || "") as string;
  return html.replace(
    /<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/gi,
    (_m, code: string) => {
      const source = decodeEntities(code).trim();
      return `<div class="mermaid-wrap"><div class="mermaid">${escapeForMermaid(
        source
      )}</div></div>`;
    }
  );
}

type Props = {
  text: string;
  streaming?: boolean;
};

/**
 * Markdown + Mermaid. El HTML se escribe en el DOM a mano para que
 * React no borre los SVG al re-renderizar el chat (p. ej. al tipear).
 */
export function MarkdownBody({ text, streaming }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const reactId = useId().replace(/:/g, "");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const sourceText = text || (streaming ? "…" : "");
    el.innerHTML = markdownToHtml(sourceText);

    if (streaming) return;

    const nodes = el.querySelectorAll<HTMLElement>(".mermaid");
    if (!nodes.length) return;

    let cancelled = false;
    ensureMermaid();

    void (async () => {
      for (const [i, node] of Array.from(nodes).entries()) {
        if (cancelled) return;
        const source = decodeEntities(node.textContent || "").trim();
        if (!source) continue;
        try {
          const id = `cmu-mmd-${reactId}-${i}-${Math.random().toString(36).slice(2, 9)}`;
          const { svg } = await mermaid.render(id, source);
          if (cancelled || !el.contains(node)) return;
          node.innerHTML = svg;
          node.setAttribute("data-processed", "true");
        } catch {
          if (cancelled || !el.contains(node)) return;
          node.innerHTML = `<div class="mermaid-fallback"><p class="mermaid-error">No se pudo renderizar la gráfica. Código:</p><pre>${escapeHtml(
            source
          )}</pre></div>`;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [text, streaming, reactId]);

  return <div ref={ref} className="bubble-body" />;
}
