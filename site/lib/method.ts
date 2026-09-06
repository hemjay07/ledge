import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Renderer, marked } from "marked";

/* METHOD.md is the binding definitions file. The /method page renders that
   file itself, at build time, so the page cannot drift from the definitions. */

/* The file is rendered inside a ledger entry whose own heading is the <h2>.
   Its `##` sections are therefore one level down the page's outline, not
   siblings of the entry heading, so every heading level is offset by one:
   `##` becomes <h3>. Without this the page emits an <h2> inside an <h2>'s
   section and the outline says the definitions are a peer of the entry that
   contains them. */
function offsetHeadings(): Renderer {
  const renderer = new Renderer();
  renderer.heading = function heading(token) {
    const depth = Math.min(token.depth + 1, 6);
    return `<h${depth}>${this.parser.parseInline(token.tokens)}</h${depth}>\n`;
  };
  return renderer;
}

export function methodHtml(): string {
  const source = readFileSync(join(process.cwd(), "..", "METHOD.md"), "utf8");
  const body = source.replace(/^#\s+.*\n/, "");
  return marked.parse(body, { async: false, gfm: true, renderer: offsetHeadings() });
}
