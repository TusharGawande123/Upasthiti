// Makes PDF files from the Markdown guides in docs/guides/ at release time.
// It uses Playwright (already installed in e2e/) to print a simple HTML page to PDF.
// PDFs are NOT committed: the output folder is not part of the repository.
//
// Run from the repository root, after `npm install` in e2e/ and `npx playwright install chromium`:
//   node scripts/make-guide-pdfs.mjs                 (all guides, output in ./guides-pdf)
//   node scripts/make-guide-pdfs.mjs --out C:\temp\pdfs
//   node scripts/make-guide-pdfs.mjs worker-guide.en.md user-manual.mr.md
// Devanagari (Marathi, Hindi) needs a font on this computer, for example Noto Sans Devanagari
// (free) or Nirmala UI (Windows). The worker guides are printed to one A4 page: check each one.

import { mkdir, readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const guidesDir = path.join(repoRoot, "docs", "guides");

// Playwright lives in e2e/node_modules, not in the root.
const requireFromE2e = createRequire(path.join(repoRoot, "e2e", "package.json"));

function readArguments() {
  const args = process.argv.slice(2);
  let outDir = path.join(repoRoot, "guides-pdf");
  const files = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--out") {
      outDir = path.resolve(args[index + 1]);
      index += 1;
    } else {
      files.push(args[index]);
    }
  }
  return { outDir, files };
}

function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Inline marks: `code`, **bold**, *italic*, [text](url).
function renderInline(text) {
  let html = escapeHtml(text);
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return html;
}

function splitTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isTableSeparator(line) {
  return /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(line.trim());
}

// A small Markdown to HTML converter. It covers what our guides use: headings, paragraphs,
// bullet and numbered lists, tables, block quotes and fenced code.
function markdownToHtml(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (line.trim() === "") {
      index += 1;
      continue;
    }

    if (line.startsWith("```")) {
      const code = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1;
      out.push(`<pre>${escapeHtml(code.join("\n"))}</pre>`);
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^---+\s*$/.test(line)) {
      out.push("<hr>");
      index += 1;
      continue;
    }

    if (line.startsWith(">")) {
      const quote = [];
      while (index < lines.length && lines[index].startsWith(">")) {
        quote.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      out.push(`<blockquote>${renderInline(quote.join(" "))}</blockquote>`);
      continue;
    }

    if (line.trim().startsWith("|") && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      const header = splitTableRow(line);
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].trim().startsWith("|")) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      const head = header.map((cell) => `<th>${renderInline(cell)}</th>`).join("");
      const body = rows
        .map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join("")}</tr>`)
        .join("");
      out.push(`<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`);
      continue;
    }

    const listMatch = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(line);
    if (listMatch) {
      const ordered = /\d+\./.test(listMatch[2]);
      const items = [];
      while (index < lines.length) {
        const itemMatch = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(lines[index]);
        if (itemMatch) {
          items.push(itemMatch[3]);
          index += 1;
        } else if (/^\s{2,}\S/.test(lines[index]) && items.length > 0) {
          // a wrapped continuation line of the previous item
          items[items.length - 1] += ` ${lines[index].trim()}`;
          index += 1;
        } else {
          break;
        }
      }
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag}>${items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</${tag}>`);
      continue;
    }

    // A paragraph runs until a blank line or the start of another block.
    const paragraph = [];
    while (
      index < lines.length &&
      lines[index].trim() !== "" &&
      !lines[index].startsWith("```") &&
      !/^#{1,6}\s/.test(lines[index]) &&
      !lines[index].startsWith(">") &&
      !/^\s*([-*]|\d+\.)\s+/.test(lines[index]) &&
      !lines[index].trim().startsWith("|")
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    out.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
  }

  return out.join("\n");
}

const pageStyle = `
  body { font-family: "Noto Sans", "Noto Sans Devanagari", "Nirmala UI", "Segoe UI", Arial, sans-serif;
         font-size: 11pt; line-height: 1.45; color: #1a1a1a; }
  h1 { font-size: 20pt; margin: 0 0 8pt; }
  h2 { font-size: 15pt; margin: 16pt 0 6pt; border-bottom: 1px solid #ccc; padding-bottom: 2pt; }
  h3 { font-size: 12.5pt; margin: 12pt 0 4pt; }
  code { background: #f1f1f1; padding: 0 3pt; font-family: Consolas, monospace; font-size: 10pt; }
  pre { background: #f6f6f6; padding: 8pt; white-space: pre-wrap; font-size: 9.5pt; }
  table { border-collapse: collapse; width: 100%; margin: 6pt 0; font-size: 10pt; }
  th, td { border: 1px solid #bbb; padding: 3pt 5pt; text-align: left; vertical-align: top; }
  th { background: #efefef; }
  blockquote { margin: 6pt 0; padding: 4pt 10pt; border-left: 4px solid #888; background: #f7f7f7; }
  hr { border: 0; border-top: 1px solid #ccc; margin: 12pt 0; }
  /* the worker guide must fit on one A4 page */
  body.one-page { font-size: 9.5pt; line-height: 1.3; }
  body.one-page h1 { font-size: 16pt; }
  body.one-page h2 { font-size: 12pt; margin: 8pt 0 3pt; }
  body.one-page h3 { font-size: 10.5pt; margin: 6pt 0 2pt; }
  body.one-page p, body.one-page li { margin: 1pt 0; }
`;

function wrapPage(title, bodyHtml, onePage) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>${pageStyle}</style></head><body class="${onePage ? "one-page" : ""}">${bodyHtml}</body></html>`;
}

async function main() {
  const { chromium } = requireFromE2e("@playwright/test");
  const { outDir, files } = readArguments();

  const allGuides = (await readdir(guidesDir)).filter((name) => name.endsWith(".md"));
  const chosen = files.length > 0 ? files : allGuides.filter((name) => name !== "README.md");

  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const fileName of chosen) {
      const markdown = await readFile(path.join(guidesDir, fileName), "utf8");
      const onePage = fileName.startsWith("worker-guide.");
      const html = wrapPage(fileName, markdownToHtml(markdown), onePage);
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "load" });
      const pdfPath = path.join(outDir, fileName.replace(/\.md$/, ".pdf"));
      await page.pdf({
        path: pdfPath,
        format: "A4",
        margin: { top: "14mm", right: "14mm", bottom: "14mm", left: "14mm" },
        printBackground: true,
      });
      await page.close();
      console.log(`Wrote ${pdfPath}`);
    }
  } finally {
    await browser.close();
  }
  console.log("Done. Check that each worker guide is one page. Do not commit the PDFs.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
