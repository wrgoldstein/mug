export interface MarkdownEnhanceOptions {
  bold?: boolean;
  tables?: boolean;
  lists?: boolean;
  quotes?: boolean;
}

const DEFAULT_OPTIONS: Required<MarkdownEnhanceOptions> = {
  bold: true,
  tables: true,
  lists: true,
  quotes: true,
};

export function escapeHtml(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function rawPosToHtmlIndex(html: string, rawPos: number): number {
  if (rawPos <= 0) return 0;

  let raw = 0;
  let i = 0;

  while (i < html.length) {
    if (raw >= rawPos) return i;

    const ch = html[i];
    if (ch === "<") {
      const close = html.indexOf(">", i);
      if (close === -1) return html.length;
      i = close + 1;
      continue;
    }

    if (ch === "&") {
      const semi = html.indexOf(";", i);
      if (semi !== -1) {
        raw += 1;
        i = semi + 1;
        continue;
      }
    }

    raw += 1;
    i += 1;
  }

  return html.length;
}

function wrapRawRangeInHtml(html: string, rawStart: number, rawEnd: number, className: string): string {
  if (rawEnd <= rawStart) return html;

  const start = rawPosToHtmlIndex(html, rawStart);
  const end = rawPosToHtmlIndex(html, rawEnd);
  if (start >= end) return html;

  return `${html.slice(0, start)}<span class="${className}">${html.slice(start, end)}</span>${html.slice(end)}`;
}

function markdownIndentDepth(leading: string): number {
  let width = 0;
  for (let i = 0; i < leading.length; i++) {
    width += leading[i] === "\t" ? 2 : 1;
  }
  return Math.max(0, Math.floor(width / 2));
}

function splitMarkdownTableCells(text: string): string[] {
  const trimmed = text.trim();
  const core = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  return core.split("|").map((cell) => cell.trim());
}

export function isMarkdownTableLike(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.includes("|")) return false;
  const cells = splitMarkdownTableCells(trimmed);
  return cells.length >= 2;
}

function isMarkdownTableSeparator(text: string): boolean {
  if (!isMarkdownTableLike(text)) return false;
  const cells = splitMarkdownTableCells(text);
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

export function renderMarkdownTableBlock(lines: string[]): string[] | null {
  if (lines.length < 2) return null;

  const hasSeparator = lines.some((line) => isMarkdownTableSeparator(line));
  if (!hasSeparator) return null;

  const parsed = lines.map((line) => {
    const leading = line.match(/^\s*/)?.[0] ?? "";
    const cells = splitMarkdownTableCells(line);
    return { leading, cells };
  });

  const colCount = parsed.reduce((max, row) => Math.max(max, row.cells.length), 0);
  if (colCount === 0) return null;

  const widths = Array.from({ length: colCount }, (_, col) => {
    let width = 1;
    for (const row of parsed) {
      const cell = (row.cells[col] ?? "").trim();
      if (cell.length > width) width = cell.length;
    }
    return Math.min(width, 40);
  });

  return parsed.map((line) => {
    const paddedCells = Array.from({ length: colCount }, (_, i) => {
      const cell = (line.cells[i] ?? "").trim();
      return cell.padEnd(widths[i], " ");
    });

    return `${line.leading}│ ${paddedCells.join(" │ ")} │`;
  });
}

function decorateInlineBold(innerHtml: string, text: string): string {
  let decorated = innerHtml;
  const boldRe = /\*\*([^\n*][^\n]*?)\*\*/g;
  let match: RegExpExecArray | null;

  while ((match = boldRe.exec(text)) !== null) {
    const open = match.index;
    const full = match[0] ?? "";
    const body = match[1] ?? "";
    if (!full || !body.trim()) continue;

    const close = open + full.length - 2;
    decorated = wrapRawRangeInHtml(decorated, open, open + 2, "md-bold-marker");
    decorated = wrapRawRangeInHtml(decorated, open + 2, close, "md-bold-content");
    decorated = wrapRawRangeInHtml(decorated, close, close + 2, "md-bold-marker");
  }

  return decorated;
}

export function enhanceMarkdownHtml(html: string, options: MarkdownEnhanceOptions = {}): string {
  const opt = { ...DEFAULT_OPTIONS, ...options };

  const lineTexts: string[] = [];
  const lineRegex = /<span class="line">(.*)<\/span>/g;
  let lineMatch: RegExpExecArray | null;

  while ((lineMatch = lineRegex.exec(html)) !== null) {
    lineTexts.push(lineMatch[1].replace(/<[^>]*>/g, ""));
  }

  const renderedTables = new Map<number, string>();
  if (opt.tables) {
    for (let i = 0; i < lineTexts.length;) {
      if (!isMarkdownTableLike(lineTexts[i])) {
        i += 1;
        continue;
      }

      let j = i;
      while (j < lineTexts.length && isMarkdownTableLike(lineTexts[j])) j += 1;

      const rendered = renderMarkdownTableBlock(lineTexts.slice(i, j));
      if (rendered) {
        for (let k = 0; k < rendered.length; k++) {
          renderedTables.set(i + k, rendered[k]);
        }
      }

      i = j;
    }
  }

  let lineIndex = 0;
  return html.replace(/<span class="line">(.*)<\/span>/g, (_match, inner) => {
    const text = inner.replace(/<[^>]*>/g, "");
    const tableRendered = renderedTables.get(lineIndex);
    lineIndex += 1;

    if (tableRendered && opt.tables) {
      return `<span class="line md-table">${escapeHtml(tableRendered)}</span>`;
    }

    if (opt.lists && /^\s*[-*+]\s/.test(text)) {
      let decorated = escapeHtml(text);
      const taskMatch = text.match(/^(\s*)([-*+])(\s+)\[( |x|X)?\](\s+|$)/);
      const bulletMatch = text.match(/^(\s*)([-*+])(\s+)/);
      if (bulletMatch) {
        const markerStart = bulletMatch[1].length;
        const depth = markdownIndentDepth(bulletMatch[1]);
        const depthClass = `depth-${depth % 3}`;
        const markerClass = taskMatch ? `md-list-marker ${depthClass} task` : `md-list-marker ${depthClass}`;
        decorated = wrapRawRangeInHtml(decorated, markerStart, markerStart + 1, markerClass);
      }

      if (taskMatch) {
        const boxStart = taskMatch[1].length + taskMatch[2].length + taskMatch[3].length;
        const boxLen = taskMatch[4] == null ? 2 : 3;
        const checked = /[xX]/.test(taskMatch[4] ?? "");
        decorated = wrapRawRangeInHtml(decorated, boxStart, boxStart + boxLen, checked ? "md-task-box checked" : "md-task-box");
      }

      if (opt.bold) {
        decorated = decorateInlineBold(decorated, text);
      }
      return `<span class="line md-list">${decorated}</span>`;
    }

    if (opt.lists && /^\s*\d+\.\s/.test(text)) {
      let decorated = escapeHtml(text);
      const orderedMatch = text.match(/^(\s*)(\d+\.)(\s+)/);
      if (orderedMatch) {
        const markerStart = orderedMatch[1].length;
        const markerEnd = markerStart + orderedMatch[2].length;
        decorated = wrapRawRangeInHtml(decorated, markerStart, markerEnd, "md-olist-marker");
      }
      if (opt.bold) {
        decorated = decorateInlineBold(decorated, text);
      }
      return `<span class="line md-list md-olist">${decorated}</span>`;
    }

    if (opt.quotes && /^\s*>/.test(text)) {
      const decorated = opt.bold ? decorateInlineBold(inner, text) : inner;
      return `<span class="line md-quote">${decorated}</span>`;
    }

    const decorated = opt.bold ? decorateInlineBold(inner, text) : inner;
    return `<span class="line">${decorated}</span>`;
  });
}
