<script lang="ts">
  import { onMount } from "svelte";
  import { createHighlighter, type BundledLanguage, type BundledTheme, type Highlighter } from "shiki";
  import FindBar from "./FindBar.svelte";

  interface GitLineChange {
    kind: "added" | "modified" | "deleted";
    startLine: number;
    endLine: number;
  }

  interface Props {
    content: string;
    language: BundledLanguage;
    theme: BundledTheme;
    fontSize: number;
    isDirty: boolean;
    gitLineChanges: GitLineChange[];
    showFind: boolean;
    wordWrap: boolean;
    onchange: (content: string) => void;
    onclosefind: () => void;
  }

  interface CursorSpan {
    start: number;
    end: number;
  }

  interface MultiCursorState {
    active: boolean;
    spans: CursorSpan[];
    primary: number;
    query: string | null;
    suppressSelectionSync: boolean;
  }

  interface GhostSelectionRect {
    key: string;
    left: number;
    top: number;
    width: number;
    height: number;
  }

  interface GhostCaretRect {
    key: string;
    left: number;
    top: number;
    height: number;
  }

  interface HistoryEntry {
    value: string;
    selectionStart: number;
    selectionEnd: number;
  }

  interface MarkdownEditRange {
    start: number;
    end: number;
    kind: "bold" | "table";
  }

  type MarkdownRenderMode = "raw" | "mixed" | "rendered";

  interface MinimapBar {
    key: string;
    y: number;
    height: number;
    width: number;
    opacity: number;
  }

  interface MinimapGitMarker {
    key: string;
    kind: GitLineChange["kind"];
    top: number;
    height: number;
  }

  let { content, language, theme, fontSize, isDirty, gitLineChanges, showFind, wordWrap, onchange, onclosefind }: Props = $props();

  let highlightedHtml = $state('<pre class="shiki"><code></code></pre>');
  let highlighter: Highlighter | null = null;
  let highlightTimer: number | null = null;

  let textareaEl = $state<HTMLTextAreaElement | null>(null);
  let codeLayerEl = $state<HTMLDivElement | null>(null);
  let measureLayerEl = $state<HTMLDivElement | null>(null);
  let findBarRef: FindBar | null = $state(null);

  let ghostSelections = $state<GhostSelectionRect[]>([]);
  let ghostCarets = $state<GhostCaretRect[]>([]);
  let ghostUpdateTimer: number | null = null;
  let measureTextNode: Text | null = null;

  const MAX_HISTORY = 500;
  let historyEntries: HistoryEntry[] = [];
  let historyIndex = -1;
  let applyingHistory = false;

  let minimapEl = $state<HTMLDivElement | null>(null);
  let minimapBars = $state<MinimapBar[]>([]);
  let minimapGitMarkers = $state<MinimapGitMarker[]>([]);
  let minimapViewportTop = $state(0);
  let minimapViewportHeight = $state(0);
  let minimapDragOffset = 0;
  let minimapDragging = false;

  const MARKDOWN_ENHANCE = {
    bold: true,
    tables: true,
    lists: true,
    quotes: true,
  } as const;

  let markdownEditRanges: MarkdownEditRange[] = [];
  let markdownRenderMode = $state<MarkdownRenderMode>("rendered");

  let multiCursor: MultiCursorState = {
    active: false,
    spans: [],
    primary: 0,
    query: null,
    suppressSelectionSync: false,
  };

  let handledPasteEvent = false;

  export function getTextarea(): HTMLTextAreaElement | null {
    return textareaEl;
  }

  export function openFindBar() {
    findBarRef?.prefillFromSelection();
  }

  export function findNext() {
    findBarRef?.nextMatch();
  }

  export function findPrev() {
    findBarRef?.prevMatch();
  }

  export function getScrollPos(): { scrollTop: number; scrollLeft: number } {
    return {
      scrollTop: textareaEl?.scrollTop ?? 0,
      scrollLeft: textareaEl?.scrollLeft ?? 0,
    };
  }

  export function getCursorPos(): { selectionStart: number; selectionEnd: number } {
    return {
      selectionStart: textareaEl?.selectionStart ?? 0,
      selectionEnd: textareaEl?.selectionEnd ?? 0,
    };
  }

  function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  function getEditorValue(): string {
    return textareaEl?.value ?? content;
  }

  function isMarkdownLanguage(): boolean {
    return language === "md" || language === "markdown";
  }

  function overlapsRange(start: number, end: number, range: MarkdownEditRange): boolean {
    if (start === end) {
      return start >= range.start && start <= range.end;
    }
    return start < range.end && end > range.start;
  }

  function setMarkdownRenderMode(next: MarkdownRenderMode) {
    if (markdownRenderMode === next) return;
    markdownRenderMode = next;
    scheduleHighlight();
  }

  function updateMarkdownEditModeFromSelection() {
    if (!isMarkdownLanguage()) {
      setMarkdownRenderMode("rendered");
      return;
    }

    const ta = textareaEl;
    if (!ta) {
      setMarkdownRenderMode(markdownEditRanges.length > 0 ? "mixed" : "rendered");
      return;
    }

    if (markdownEditRanges.length === 0) {
      setMarkdownRenderMode("rendered");
      return;
    }

    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const insideEditableMarkdown = markdownEditRanges.some((range) => overlapsRange(start, end, range));
    setMarkdownRenderMode(insideEditableMarkdown ? "raw" : "mixed");
  }

  function computeMarkdownEditRanges(value: string): MarkdownEditRange[] {
    const ranges: MarkdownEditRange[] = [];

    // Bold ranges: **foo** (including middle-of-line occurrences)
    const lines = value.split("\n");
    let offset = 0;
    const boldRe = /\*\*([^\n*][^\n]*?)\*\*/g;

    for (const line of lines) {
      boldRe.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = boldRe.exec(line)) !== null) {
        const start = match.index;
        const full = match[0] ?? "";
        const body = match[1] ?? "";
        if (!full || !body.trim()) continue;

        ranges.push({
          start: offset + start,
          end: offset + start + full.length,
          kind: "bold",
        });
      }

      offset += line.length + 1;
    }

    // Table ranges: contiguous table-like blocks that include a separator row
    const lineStarts: number[] = [];
    let cursor = 0;
    for (const line of lines) {
      lineStarts.push(cursor);
      cursor += line.length + 1;
    }

    for (let i = 0; i < lines.length;) {
      if (!isMarkdownTableLike(lines[i])) {
        i += 1;
        continue;
      }

      let j = i;
      while (j < lines.length && isMarkdownTableLike(lines[j])) j += 1;

      const rendered = renderMarkdownTableBlock(lines.slice(i, j));
      if (rendered && rendered.length > 0) {
        const blockStart = lineStarts[i];
        const lastLineIdx = j - 1;
        const blockEnd = lineStarts[lastLineIdx] + lines[lastLineIdx].length;
        ranges.push({ start: blockStart, end: blockEnd, kind: "table" });
      }

      i = j;
    }

    return ranges;
  }

  function rebuildMinimapBars() {
    const value = getEditorValue();
    const lines = value.split("\n");
    const lineCount = Math.max(1, lines.length);

    const targetRows = Math.max(28, Math.floor((minimapEl?.clientHeight ?? 280) / 3));
    const rows = Math.max(1, Math.min(lineCount, targetRows));
    const bucketSize = Math.ceil(lineCount / rows);

    let longestLine = 1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].length > longestLine) longestLine = lines[i].length;
    }

    const nextBars: MinimapBar[] = [];
    for (let row = 0; row < rows; row++) {
      const start = row * bucketSize;
      const end = Math.min(lineCount, start + bucketSize);
      if (start >= end) break;

      let longestInBucket = 0;
      let nonEmpty = 0;
      for (let i = start; i < end; i++) {
        const len = (lines[i] ?? "").trim().length;
        if (len > 0) nonEmpty++;
        if (len > longestInBucket) longestInBucket = len;
      }

      const density = nonEmpty / (end - start || 1);
      const width = clamp((longestInBucket / longestLine) * 100, 6, 100);
      const y = (row / rows) * 100;
      const height = 100 / rows;
      const opacity = clamp(0.14 + density * 0.3, 0.12, 0.45);

      nextBars.push({
        key: `m-${row}-${start}-${end}`,
        y,
        height,
        width,
        opacity,
      });
    }

    minimapBars = nextBars;
    rebuildMinimapGitMarkers(lineCount);
  }

  function rebuildMinimapGitMarkers(totalLines?: number) {
    const minimap = minimapEl;
    if (!minimap || !gitLineChanges || gitLineChanges.length === 0) {
      minimapGitMarkers = [];
      return;
    }

    const lines = totalLines ?? Math.max(1, getEditorValue().split("\n").length);
    const mapHeight = minimap.clientHeight;
    if (mapHeight <= 0) {
      minimapGitMarkers = [];
      return;
    }

    const markers: MinimapGitMarker[] = gitLineChanges.map((change, i) => {
      const start = clamp(change.startLine, 1, lines);
      const end = clamp(change.endLine, start, lines);
      const top = ((start - 1) / lines) * mapHeight;
      const rawHeight = ((end - start + 1) / lines) * mapHeight;
      const minHeight = change.kind === "deleted" ? 2 : 3;
      const height = Math.max(minHeight, rawHeight);
      return {
        key: `g-${i}-${change.kind}-${start}-${end}`,
        kind: change.kind,
        top,
        height,
      };
    });

    minimapGitMarkers = markers;
  }

  function updateMinimapViewport() {
    const ta = textareaEl;
    const minimap = minimapEl;
    if (!ta || !minimap) {
      minimapViewportTop = 0;
      minimapViewportHeight = 0;
      return;
    }

    const mapHeight = minimap.clientHeight;
    if (mapHeight <= 0) {
      minimapViewportTop = 0;
      minimapViewportHeight = 0;
      return;
    }

    const scrollRange = Math.max(0, ta.scrollHeight - ta.clientHeight);
    const minViewport = 20;
    let viewportHeight = ta.scrollHeight <= 0
      ? mapHeight
      : Math.max(minViewport, (ta.clientHeight / ta.scrollHeight) * mapHeight);
    viewportHeight = Math.min(mapHeight, viewportHeight);

    const trackRange = Math.max(0, mapHeight - viewportHeight);
    const viewportTop = scrollRange === 0 ? 0 : (ta.scrollTop / scrollRange) * trackRange;

    minimapViewportHeight = viewportHeight;
    minimapViewportTop = clamp(viewportTop, 0, trackRange);
  }

  function scrollToMinimapClientY(clientY: number) {
    const ta = textareaEl;
    const minimap = minimapEl;
    if (!ta || !minimap) return;

    const rect = minimap.getBoundingClientRect();
    const mapHeight = rect.height;
    if (mapHeight <= 0) return;

    const scrollRange = Math.max(0, ta.scrollHeight - ta.clientHeight);
    if (scrollRange <= 0) return;

    const trackRange = Math.max(1, mapHeight - minimapViewportHeight);
    const localY = clamp(clientY - rect.top - minimapDragOffset, 0, trackRange);
    const ratio = localY / trackRange;

    ta.scrollTop = ratio * scrollRange;
    syncScroll();
  }

  function onMinimapMouseDown(event: MouseEvent) {
    const minimap = minimapEl;
    if (!minimap) return;

    event.preventDefault();
    const rect = minimap.getBoundingClientRect();
    const localY = event.clientY - rect.top;
    const viewportBottom = minimapViewportTop + minimapViewportHeight;

    if (localY >= minimapViewportTop && localY <= viewportBottom) {
      minimapDragOffset = localY - minimapViewportTop;
    } else {
      minimapDragOffset = minimapViewportHeight / 2;
    }

    minimapDragging = true;
    scrollToMinimapClientY(event.clientY);

    const onMove = (e: MouseEvent) => {
      if (!minimapDragging) return;
      scrollToMinimapClientY(e.clientY);
    };

    const onUp = () => {
      minimapDragging = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function onMinimapWheel(event: WheelEvent) {
    const ta = textareaEl;
    if (!ta) return;
    event.preventDefault();
    ta.scrollTop += event.deltaY;
    syncScroll();
  }

  function hasVirtualCursors(): boolean {
    return multiCursor.spans.length > 1;
  }

  function spansOverlap(a: CursorSpan, b: CursorSpan): boolean {
    return a.start < b.end && b.start < a.end;
  }

  function spansEqual(a: CursorSpan, b: CursorSpan): boolean {
    return a.start === b.start && a.end === b.end;
  }

  function normalizeSpans(spans: CursorSpan[], maxLen: number): CursorSpan[] {
    const sorted = spans
      .map((span) => {
        const clampedStart = Math.max(0, Math.min(maxLen, span.start));
        const clampedEnd = Math.max(0, Math.min(maxLen, span.end));
        return clampedStart <= clampedEnd
          ? { start: clampedStart, end: clampedEnd }
          : { start: clampedEnd, end: clampedStart };
      })
      .sort((a, b) => a.start - b.start || a.end - b.end);

    const deduped: CursorSpan[] = [];
    for (const span of sorted) {
      const prev = deduped[deduped.length - 1];
      if (!prev) {
        deduped.push(span);
        continue;
      }
      if (spansEqual(prev, span)) continue;
      if (span.start < prev.end) continue; // keep spans non-overlapping
      deduped.push(span);
    }

    return deduped;
  }

  function clearGhostVisuals() {
    if (ghostUpdateTimer) {
      cancelAnimationFrame(ghostUpdateTimer);
      ghostUpdateTimer = null;
    }
    if (ghostSelections.length) ghostSelections = [];
    if (ghostCarets.length) ghostCarets = [];
  }

  function ensureMeasureTextNode(): Text | null {
    const measure = measureLayerEl;
    if (!measure) return null;

    if (!measureTextNode || measureTextNode.parentNode !== measure) {
      measure.textContent = "";
      measureTextNode = document.createTextNode("");
      measure.appendChild(measureTextNode);
    }

    return measureTextNode;
  }

  function getLineHeightPx(ta: HTMLTextAreaElement): number {
    const computed = getComputedStyle(ta);
    const parsed = Number.parseFloat(computed.lineHeight);
    if (Number.isFinite(parsed)) return parsed;
    const fontSize = Number.parseFloat(computed.fontSize);
    return Number.isFinite(fontSize) ? fontSize * 1.45 : 22;
  }

  function syncMeasureScroll() {
    if (!textareaEl || !measureLayerEl) return;
    measureLayerEl.scrollTop = textareaEl.scrollTop;
    measureLayerEl.scrollLeft = textareaEl.scrollLeft;
  }

  function measureCaretRect(value: string, textNode: Text, index: number, measureRect: DOMRect, lineHeight: number): { left: number; top: number; height: number } {
    const range = document.createRange();

    const collapsed = () => {
      range.setStart(textNode, index);
      range.setEnd(textNode, index);
      return range.getBoundingClientRect();
    };

    let rect = collapsed();
    if (rect.height > 0) {
      return {
        left: rect.left - measureRect.left,
        top: rect.top - measureRect.top,
        height: Math.max(lineHeight, rect.height),
      };
    }

    if (value.length > 0 && index < value.length) {
      range.setStart(textNode, index);
      range.setEnd(textNode, index + 1);
      rect = range.getBoundingClientRect();
      if (rect.height > 0) {
        return {
          left: rect.left - measureRect.left,
          top: rect.top - measureRect.top,
          height: Math.max(lineHeight, rect.height),
        };
      }
    }

    if (value.length > 0 && index > 0) {
      range.setStart(textNode, index - 1);
      range.setEnd(textNode, index);
      rect = range.getBoundingClientRect();
      if (rect.height > 0) {
        return {
          left: rect.right - measureRect.left,
          top: rect.top - measureRect.top,
          height: Math.max(lineHeight, rect.height),
        };
      }
    }

    const ta = textareaEl;
    if (!ta) return { left: 0, top: 0, height: lineHeight };

    const computed = getComputedStyle(ta);
    const padLeft = Number.parseFloat(computed.paddingLeft) || 0;
    const padTop = Number.parseFloat(computed.paddingTop) || 0;
    return {
      left: padLeft - ta.scrollLeft,
      top: padTop - ta.scrollTop,
      height: lineHeight,
    };
  }

  function refreshGhostVisuals() {
    ghostUpdateTimer = null;

    if (!hasVirtualCursors() || !textareaEl || !measureLayerEl) {
      if (ghostSelections.length) ghostSelections = [];
      if (ghostCarets.length) ghostCarets = [];
      return;
    }

    const ta = textareaEl;
    const value = ta.value;
    const spans = normalizeSpans(multiCursor.spans, value.length);
    if (spans.length <= 1) {
      if (ghostSelections.length) ghostSelections = [];
      if (ghostCarets.length) ghostCarets = [];
      return;
    }

    const primary = getPrimarySpan();
    const primaryIndex = primary ? pickPrimaryIndex(spans, primary) : -1;

    const textNode = ensureMeasureTextNode();
    if (!textNode) return;
    if (textNode.data !== value) textNode.data = value;
    syncMeasureScroll();

    const measureRect = measureLayerEl.getBoundingClientRect();
    const lineHeight = getLineHeightPx(ta);
    const range = document.createRange();

    const nextSelections: GhostSelectionRect[] = [];
    const nextCarets: GhostCaretRect[] = [];

    for (let i = 0; i < spans.length; i++) {
      if (i === primaryIndex) continue;
      const span = spans[i];

      if (span.start === span.end) {
        const caret = measureCaretRect(value, textNode, span.start, measureRect, lineHeight);
        nextCarets.push({
          key: `c-${i}-${span.start}`,
          left: caret.left,
          top: caret.top,
          height: caret.height,
        });
        continue;
      }

      range.setStart(textNode, span.start);
      range.setEnd(textNode, span.end);
      const rects = Array.from(range.getClientRects());

      if (rects.length === 0) {
        const caret = measureCaretRect(value, textNode, span.start, measureRect, lineHeight);
        nextCarets.push({
          key: `c-fallback-${i}-${span.start}`,
          left: caret.left,
          top: caret.top,
          height: caret.height,
        });
        continue;
      }

      rects.forEach((rect, rectIndex) => {
        if (rect.width <= 0 || rect.height <= 0) return;
        nextSelections.push({
          key: `s-${i}-${rectIndex}-${span.start}-${span.end}`,
          left: rect.left - measureRect.left,
          top: rect.top - measureRect.top,
          width: rect.width,
          height: rect.height,
        });
      });
    }

    ghostSelections = nextSelections;
    ghostCarets = nextCarets;
  }

  function scheduleGhostVisuals() {
    if (ghostUpdateTimer) cancelAnimationFrame(ghostUpdateTimer);
    ghostUpdateTimer = requestAnimationFrame(refreshGhostVisuals);
  }

  function pushHistoryEntry(value: string, selectionStart: number, selectionEnd: number) {
    if (applyingHistory) return;

    const prev = historyEntries[historyIndex];
    if (prev && prev.value === value && prev.selectionStart === selectionStart && prev.selectionEnd === selectionEnd) {
      return;
    }

    if (historyIndex < historyEntries.length - 1) {
      historyEntries = historyEntries.slice(0, historyIndex + 1);
    }

    historyEntries.push({ value, selectionStart, selectionEnd });

    if (historyEntries.length > MAX_HISTORY) {
      const overflow = historyEntries.length - MAX_HISTORY;
      historyEntries.splice(0, overflow);
      historyIndex = Math.max(0, historyIndex - overflow);
    }

    historyIndex = historyEntries.length - 1;
  }

  function resetHistory(value: string, selectionStart = 0, selectionEnd = selectionStart) {
    historyEntries = [{ value, selectionStart, selectionEnd }];
    historyIndex = 0;
  }

  function canUndoHistory(): boolean {
    return historyIndex > 0;
  }

  function canRedoHistory(): boolean {
    return historyIndex >= 0 && historyIndex < historyEntries.length - 1;
  }

  function applyHistoryEntry(entry: HistoryEntry) {
    const ta = textareaEl;
    if (!ta) return;

    applyingHistory = true;
    ta.value = entry.value;
    ta.selectionStart = entry.selectionStart;
    ta.selectionEnd = entry.selectionEnd;
    applyingHistory = false;

    clearMultiCursor();
    onchange(entry.value);
    inputGeneration++;

    if (isMarkdownLanguage()) {
      markdownEditRanges = computeMarkdownEditRanges(entry.value);
      updateMarkdownEditModeFromSelection();
    }

    rebuildMinimapBars();
    updateMinimapViewport();
    highlightSync();
  }

  function undoHistory() {
    if (!canUndoHistory()) return;
    historyIndex -= 1;
    const entry = historyEntries[historyIndex];
    if (entry) applyHistoryEntry(entry);
  }

  function redoHistory() {
    if (!canRedoHistory()) return;
    historyIndex += 1;
    const entry = historyEntries[historyIndex];
    if (entry) applyHistoryEntry(entry);
  }

  function clearMultiCursor() {
    multiCursor.active = false;
    multiCursor.spans = [];
    multiCursor.primary = 0;
    multiCursor.query = null;
    multiCursor.suppressSelectionSync = false;
    clearGhostVisuals();
  }

  function getPrimarySpan(): CursorSpan | null {
    if (!multiCursor.spans.length) return null;
    const idx = Math.max(0, Math.min(multiCursor.primary, multiCursor.spans.length - 1));
    return multiCursor.spans[idx] ?? null;
  }

  function pickPrimaryIndex(spans: CursorSpan[], hint: CursorSpan): number {
    const exact = spans.findIndex((span) => spansEqual(span, hint));
    if (exact !== -1) return exact;

    let bestIdx = 0;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let i = 0; i < spans.length; i++) {
      const span = spans[i];
      const score = Math.abs(span.start - hint.start) + Math.abs(span.end - hint.end);
      if (score < bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  function setNativeSelection(span: CursorSpan) {
    const ta = textareaEl;
    if (!ta) return;
    multiCursor.suppressSelectionSync = true;
    ta.setSelectionRange(span.start, span.end);
    queueMicrotask(() => {
      multiCursor.suppressSelectionSync = false;
    });
  }

  function activateMultiCursor(spans: CursorSpan[], primaryHint: CursorSpan, query: string | null) {
    const ta = textareaEl;
    const maxLen = ta?.value.length ?? content.length;
    const normalized = normalizeSpans(spans, maxLen);

    if (!normalized.length) {
      clearMultiCursor();
      return;
    }

    const primary = pickPrimaryIndex(normalized, primaryHint);

    multiCursor.spans = normalized;
    multiCursor.primary = primary;
    multiCursor.query = query;
    multiCursor.active = normalized.length > 1 || !!query;

    const currentPrimary = normalized[primary];
    if (currentPrimary) {
      setNativeSelection(currentPrimary);
    }

    scheduleGhostVisuals();
  }

  function setVirtualCursorsAfterEdit(spans: CursorSpan[], primaryHint: CursorSpan) {
    const ta = textareaEl;
    const maxLen = ta?.value.length ?? content.length;
    const normalized = normalizeSpans(spans, maxLen);

    if (!normalized.length) {
      clearMultiCursor();
      return;
    }

    const primary = pickPrimaryIndex(normalized, primaryHint);
    const primarySpan = normalized[primary] ?? normalized[0];

    if (primarySpan) setNativeSelection(primarySpan);

    if (normalized.length > 1) {
      multiCursor.spans = normalized;
      multiCursor.primary = primary;
      multiCursor.query = null;
      multiCursor.active = true;
      scheduleGhostVisuals();
      return;
    }

    clearMultiCursor();
  }

  function getWordSpanAt(value: string, pos: number): CursorSpan | null {
    const wordChars = /[\w$]/;
    let start = pos;
    let end = pos;
    while (start > 0 && wordChars.test(value[start - 1])) start--;
    while (end < value.length && wordChars.test(value[end])) end++;
    if (start === end) return null;
    return { start, end };
  }

  function getSeedSpan(ta: HTMLTextAreaElement, value: string): CursorSpan | null {
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    if (start !== end) return { start, end };
    return getWordSpanAt(value, start);
  }

  function findNextUnselectedOccurrence(value: string, query: string, from: number, existing: CursorSpan[]): CursorSpan | null {
    if (!query) return null;

    const ranges: Array<[number, number]> = [
      [from, value.length],
      [0, from],
    ];

    for (const [rangeStart, rangeEnd] of ranges) {
      let pos = rangeStart;
      while (pos <= rangeEnd - query.length) {
        const idx = value.indexOf(query, pos);
        if (idx === -1 || idx >= rangeEnd) break;
        const candidate = { start: idx, end: idx + query.length };
        if (!existing.some((span) => spansOverlap(span, candidate))) {
          return candidate;
        }
        pos = idx + 1;
      }
    }

    return null;
  }

  function commitMultiEdit(newValue: string, nextSpans: CursorSpan[], primaryHint: CursorSpan) {
    const ta = textareaEl;
    if (!ta) return;
    ta.value = newValue;
    setVirtualCursorsAfterEdit(nextSpans, primaryHint);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function applyInsertTextAtVirtualCursors(text: string) {
    const ta = textareaEl;
    if (!ta) return;

    const primaryHint = getPrimarySpan() ?? { start: ta.selectionStart, end: ta.selectionEnd };
    const spans = normalizeSpans(multiCursor.spans, ta.value.length);
    if (spans.length < 2) return;

    const primaryIndex = pickPrimaryIndex(spans, primaryHint);

    let value = ta.value;
    let delta = 0;
    const nextSpans: CursorSpan[] = [];
    let nextPrimary: CursorSpan = { ...spans[primaryIndex] };

    for (let i = 0; i < spans.length; i++) {
      const span = spans[i];
      const start = span.start + delta;
      const end = span.end + delta;

      value = value.slice(0, start) + text + value.slice(end);
      const caret = { start: start + text.length, end: start + text.length };
      nextSpans.push(caret);
      if (i === primaryIndex) nextPrimary = caret;

      delta += text.length - (end - start);
    }

    commitMultiEdit(value, nextSpans, nextPrimary);
  }

  function applyDeleteBackwardAtVirtualCursors() {
    const ta = textareaEl;
    if (!ta) return;

    const primaryHint = getPrimarySpan() ?? { start: ta.selectionStart, end: ta.selectionEnd };
    const spans = normalizeSpans(multiCursor.spans, ta.value.length);
    if (spans.length < 2) return;

    const primaryIndex = pickPrimaryIndex(spans, primaryHint);

    let value = ta.value;
    let delta = 0;
    const nextSpans: CursorSpan[] = [];
    let nextPrimary: CursorSpan = { ...spans[primaryIndex] };

    for (let i = 0; i < spans.length; i++) {
      const span = spans[i];
      const start = span.start + delta;
      const end = span.end + delta;

      let delStart = start;
      let delEnd = end;
      if (start === end) {
        if (start === 0) {
          const caret = { start: 0, end: 0 };
          nextSpans.push(caret);
          if (i === primaryIndex) nextPrimary = caret;
          continue;
        }
        delStart = start - 1;
        delEnd = start;
      }

      value = value.slice(0, delStart) + value.slice(delEnd);
      const caret = { start: delStart, end: delStart };
      nextSpans.push(caret);
      if (i === primaryIndex) nextPrimary = caret;

      delta -= (delEnd - delStart);
    }

    commitMultiEdit(value, nextSpans, nextPrimary);
  }

  function applyDeleteForwardAtVirtualCursors() {
    const ta = textareaEl;
    if (!ta) return;

    const primaryHint = getPrimarySpan() ?? { start: ta.selectionStart, end: ta.selectionEnd };
    const spans = normalizeSpans(multiCursor.spans, ta.value.length);
    if (spans.length < 2) return;

    const primaryIndex = pickPrimaryIndex(spans, primaryHint);

    let value = ta.value;
    let delta = 0;
    const nextSpans: CursorSpan[] = [];
    let nextPrimary: CursorSpan = { ...spans[primaryIndex] };

    for (let i = 0; i < spans.length; i++) {
      const span = spans[i];
      const start = span.start + delta;
      const end = span.end + delta;

      let delStart = start;
      let delEnd = end;
      if (start === end) {
        if (start >= value.length) {
          const caret = { start, end: start };
          nextSpans.push(caret);
          if (i === primaryIndex) nextPrimary = caret;
          continue;
        }
        delStart = start;
        delEnd = start + 1;
      }

      value = value.slice(0, delStart) + value.slice(delEnd);
      const caret = { start: delStart, end: delStart };
      nextSpans.push(caret);
      if (i === primaryIndex) nextPrimary = caret;

      delta -= (delEnd - delStart);
    }

    commitMultiEdit(value, nextSpans, nextPrimary);
  }

  function applyShiftTabAtVirtualCursors() {
    const ta = textareaEl;
    if (!ta) return;

    const primaryHint = getPrimarySpan() ?? { start: ta.selectionStart, end: ta.selectionEnd };
    const spans = normalizeSpans(multiCursor.spans, ta.value.length);
    if (spans.length < 2) return;

    const primaryIndex = pickPrimaryIndex(spans, primaryHint);

    let value = ta.value;
    let delta = 0;
    const nextSpans: CursorSpan[] = [];
    let nextPrimary: CursorSpan = { ...spans[primaryIndex] };

    for (let i = 0; i < spans.length; i++) {
      const span = spans[i];
      const start = span.start + delta;
      const end = span.end + delta;

      const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
      let remove = 0;
      if (value.startsWith("  ", lineStart)) remove = 2;
      else if (value[lineStart] === "\t") remove = 1;

      if (remove === 0) {
        const unchanged = { start, end };
        nextSpans.push(unchanged);
        if (i === primaryIndex) nextPrimary = unchanged;
        continue;
      }

      value = value.slice(0, lineStart) + value.slice(lineStart + remove);
      const next = {
        start: Math.max(lineStart, start - remove),
        end: Math.max(lineStart, end - remove),
      };
      nextSpans.push(next);
      if (i === primaryIndex) nextPrimary = next;

      delta -= remove;
    }

    commitMultiEdit(value, nextSpans, nextPrimary);
  }

  /**
   * Cmd+D: build virtual selections that all edit together.
   */
  export function selectNextOccurrence() {
    const ta = textareaEl;
    if (!ta) return;

    const value = ta.value;

    if (!multiCursor.active || !multiCursor.query || multiCursor.spans.length === 0) {
      const seed = getSeedSpan(ta, value);
      if (!seed || seed.start === seed.end) return;
      const query = value.slice(seed.start, seed.end);
      if (!query) return;
      activateMultiCursor([seed], seed, query);
      return;
    }

    const primary = getPrimarySpan();
    const spans = normalizeSpans(multiCursor.spans, value.length);
    if (!primary || spans.length === 0 || !multiCursor.query) {
      clearMultiCursor();
      return;
    }

    const next = findNextUnselectedOccurrence(value, multiCursor.query, primary.end, spans);
    if (!next) return;

    activateMultiCursor([...spans, next], next, multiCursor.query);
  }

  /**
   * Cmd+Shift+L: select all occurrences of current selection/word as virtual selections.
   */
  export function selectAllOccurrences() {
    const ta = textareaEl;
    if (!ta) return;

    const value = ta.value;
    const seed = getSeedSpan(ta, value);
    if (!seed || seed.start === seed.end) return;

    const query = value.slice(seed.start, seed.end);
    if (!query) return;

    const matches: CursorSpan[] = [];
    let pos = 0;
    const step = Math.max(1, query.length);

    while (pos <= value.length - query.length) {
      const idx = value.indexOf(query, pos);
      if (idx === -1) break;
      matches.push({ start: idx, end: idx + query.length });
      pos = idx + step;
    }

    if (!matches.length) return;
    activateMultiCursor(matches, seed, query);
  }

  export function replaceAllOccurrences(replaceWith: string) {
    const ta = textareaEl;
    if (!ta) return;

    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    if (start === end) return;

    const selected = ta.value.slice(start, end);
    const newVal = ta.value.replaceAll(selected, replaceWith);
    if (newVal !== ta.value) {
      ta.value = newVal;
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  export function restoreState(scroll: { scrollTop: number; scrollLeft: number }, cursor: { selectionStart: number; selectionEnd: number }) {
    clearMultiCursor();
    requestAnimationFrame(() => {
      if (!textareaEl) return;
      textareaEl.selectionStart = cursor.selectionStart;
      textareaEl.selectionEnd = cursor.selectionEnd;
      textareaEl.scrollTop = scroll.scrollTop;
      textareaEl.scrollLeft = scroll.scrollLeft;
      syncScroll();
      if (historyEntries.length === 1 && historyIndex === 0) {
        resetHistory(textareaEl.value, cursor.selectionStart, cursor.selectionEnd);
      }
      if (isMarkdownLanguage()) {
        markdownEditRanges = computeMarkdownEditRanges(textareaEl.value);
        updateMarkdownEditModeFromSelection();
      }
    });
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
    // Treat tab as two spaces to match editor tab-size and indent behavior.
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

  function isMarkdownTableLike(text: string): boolean {
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

  function renderMarkdownTableBlock(lines: string[]): string[] | null {
    if (lines.length < 2) return null;

    const hasSeparator = lines.some((line) => isMarkdownTableSeparator(line));
    if (!hasSeparator) return null;

    const parsed = lines.map((line) => {
      const leading = line.match(/^\s*/)?.[0] ?? "";
      const cells = splitMarkdownTableCells(line);
      const isSeparator = isMarkdownTableSeparator(line);
      return { leading, cells, isSeparator };
    });

    const colCount = Math.max(1, ...parsed.map((line) => line.cells.length));
    const widths = Array(colCount).fill(3);

    for (const line of parsed) {
      for (let i = 0; i < colCount; i++) {
        const rawCell = (line.cells[i] ?? "").trim();
        const cell = line.isSeparator ? rawCell.replaceAll(":", "") : rawCell;
        widths[i] = Math.max(widths[i], cell.length);
      }
    }

    return parsed.map((line) => {
      if (line.isSeparator) {
        return `${line.leading}├${widths.map((w) => "─".repeat(w + 2)).join("┼")}┤`;
      }

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

  function enhanceMarkdown(html: string): string {
    // First pass: identify markdown table blocks and prepare box-drawing render lines.
    const lineTexts: string[] = [];
    const lineRegex = /<span class="line">(.*)<\/span>/g;
    let lineMatch: RegExpExecArray | null;

    while ((lineMatch = lineRegex.exec(html)) !== null) {
      lineTexts.push(lineMatch[1].replace(/<[^>]*>/g, ""));
    }

    const renderedTables = new Map<number, string>();
    if (MARKDOWN_ENHANCE.tables) {
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

    // Second pass: apply existing markdown decorations + table rendering.
    let lineIndex = 0;
    return html.replace(/<span class="line">(.*)<\/span>/g, (match, inner) => {
      const text = inner.replace(/<[^>]*>/g, ""); // strip tags to get raw text
      const tableRendered = renderedTables.get(lineIndex);
      lineIndex += 1;

      if (tableRendered && MARKDOWN_ENHANCE.tables) {
        return `<span class="line md-table">${escapeHtml(tableRendered)}</span>`;
      }

      // Unordered list items
      if (MARKDOWN_ENHANCE.lists && /^\s*[-*+]\s/.test(text)) {
        let decorated = escapeHtml(text);
        const taskMatch = text.match(/^(\s*)([-*+])(\s+)\[( |x|X)\](\s+|$)/);
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
          const checked = /[xX]/.test(taskMatch[4]);
          decorated = wrapRawRangeInHtml(decorated, boxStart, boxStart + 3, checked ? "md-task-box checked" : "md-task-box");
        }

        if (MARKDOWN_ENHANCE.bold) {
          decorated = decorateInlineBold(decorated, text);
        }
        return `<span class="line md-list">${decorated}</span>`;
      }

      // Ordered list items
      if (MARKDOWN_ENHANCE.lists && /^\s*\d+\.\s/.test(text)) {
        let decorated = escapeHtml(text);
        const orderedMatch = text.match(/^(\s*)(\d+\.)(\s+)/);
        if (orderedMatch) {
          const markerStart = orderedMatch[1].length;
          const markerEnd = markerStart + orderedMatch[2].length;
          decorated = wrapRawRangeInHtml(decorated, markerStart, markerEnd, "md-olist-marker");
        }
        if (MARKDOWN_ENHANCE.bold) {
          decorated = decorateInlineBold(decorated, text);
        }
        return `<span class="line md-list md-olist">${decorated}</span>`;
      }

      // Blockquotes
      if (MARKDOWN_ENHANCE.quotes && /^\s*>/.test(text)) {
        const decorated = MARKDOWN_ENHANCE.bold ? decorateInlineBold(inner, text) : inner;
        return `<span class="line md-quote">${decorated}</span>`;
      }

      const decorated = MARKDOWN_ENHANCE.bold ? decorateInlineBold(inner, text) : inner;
      return `<span class="line">${decorated}</span>`;
    });
  }

  function escapeHtml(text: string) {
    return text
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  // Synchronous highlight — used during typing when lang/theme are already loaded
  function highlightSync() {
    if (!highlighter) {
      highlightedHtml = `<pre class="shiki"><code>${escapeHtml(content)}</code></pre>`;
      return;
    }

    let html = highlighter.codeToHtml(content || " ", {
      lang: language,
      theme: theme
    });

    if ((language === "md" || language === "markdown") && markdownRenderMode !== "raw") {
      html = enhanceMarkdown(html);
    }

    highlightedHtml = html;
    syncScroll();
  }

  // Async highlight — used when language or theme changes (needs loading)
  async function renderHighlight() {
    if (!highlighter) {
      highlightedHtml = `<pre class="shiki"><code>${escapeHtml(content)}</code></pre>`;
      return;
    }

    await highlighter.loadLanguage(language);
    await highlighter.loadTheme(theme);
    highlightSync();
  }

  function syncScroll() {
    if (!textareaEl) return;
    if (codeLayerEl) {
      codeLayerEl.scrollTop = textareaEl.scrollTop;
      codeLayerEl.scrollLeft = textareaEl.scrollLeft;
    }
    syncMeasureScroll();
    updateMinimapViewport();
    if (hasVirtualCursors()) scheduleGhostVisuals();
  }

  function scheduleHighlight() {
    if (highlightTimer) cancelAnimationFrame(highlightTimer);
    highlightTimer = requestAnimationFrame(highlightSync);
  }

  let inputGeneration = 0; // incremented on typing to skip redundant $effect highlights

  function onInput(event: Event) {
    const ta = event.target as HTMLTextAreaElement;
    const value = ta.value;
    pushHistoryEntry(value, ta.selectionStart, ta.selectionEnd);
    onchange(value);
    inputGeneration++;

    if (isMarkdownLanguage()) {
      markdownEditRanges = computeMarkdownEditRanges(value);
      updateMarkdownEditModeFromSelection();
    }

    if (multiCursor.active && multiCursor.spans.length <= 1) {
      clearMultiCursor();
    } else if (hasVirtualCursors()) {
      scheduleGhostVisuals();
    }
    rebuildMinimapBars();
    updateMinimapViewport();
    highlightSync(); // synchronous — no debounce, no frame delay
  }

  function onBeforeInput(event: InputEvent) {
    if (event.inputType === "historyUndo") {
      if (canUndoHistory()) {
        event.preventDefault();
        undoHistory();
      }
      return;
    }

    if (event.inputType === "historyRedo") {
      if (canRedoHistory()) {
        event.preventDefault();
        redoHistory();
      }
      return;
    }

    if (!hasVirtualCursors() || event.isComposing) return;

    if (event.inputType === "insertFromPaste" && handledPasteEvent) {
      event.preventDefault();
      return;
    }

    if (event.inputType === "insertText") {
      event.preventDefault();
      applyInsertTextAtVirtualCursors(event.data ?? "");
      return;
    }

    if (event.inputType === "insertLineBreak" || event.inputType === "insertParagraph") {
      event.preventDefault();
      applyInsertTextAtVirtualCursors("\n");
      return;
    }

    if (event.inputType === "insertFromPaste") {
      const pasteText = event.dataTransfer?.getData("text/plain") ?? event.data;
      if (pasteText == null) {
        clearMultiCursor();
        return;
      }
      event.preventDefault();
      applyInsertTextAtVirtualCursors(pasteText);
      return;
    }

    if (event.inputType === "deleteContentBackward") {
      event.preventDefault();
      applyDeleteBackwardAtVirtualCursors();
      return;
    }

    if (event.inputType === "deleteContentForward") {
      event.preventDefault();
      applyDeleteForwardAtVirtualCursors();
      return;
    }

    // Unsupported edit shape (autocorrect, drag-drop, etc.) — fall back to normal input.
    clearMultiCursor();
  }

  function onPaste(event: ClipboardEvent) {
    if (!hasVirtualCursors()) return;
    event.preventDefault();
    handledPasteEvent = true;
    const text = event.clipboardData?.getData("text/plain") ?? "";
    applyInsertTextAtVirtualCursors(text);
    queueMicrotask(() => {
      handledPasteEvent = false;
    });
  }

  function scheduleMarkdownSelectionSync() {
    if (!isMarkdownLanguage()) return;
    requestAnimationFrame(() => updateMarkdownEditModeFromSelection());
  }

  function onTextareaSelect() {
    if (isMarkdownLanguage()) updateMarkdownEditModeFromSelection();

    if (!multiCursor.active || multiCursor.suppressSelectionSync) return;

    const ta = textareaEl;
    if (!ta) return;

    const primary = getPrimarySpan();
    if (!primary) {
      clearMultiCursor();
      return;
    }

    if (ta.selectionStart !== primary.start || ta.selectionEnd !== primary.end) {
      clearMultiCursor();
    }
  }

  function findMarkdownTaskAtOffset(value: string, offset: number) {
    if (offset < 0 || offset > value.length) return null;

    const lineStart = value.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
    const lineEndIdx = value.indexOf("\n", offset);
    const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx;
    const line = value.slice(lineStart, lineEnd);

    const taskMatch = line.match(/^(\s*)([-*+])(\s+)\[( |x|X)\](\s+|$)/);
    if (!taskMatch) return null;

    const boxStart = lineStart + taskMatch[1].length + taskMatch[2].length + taskMatch[3].length;
    const boxEnd = boxStart + 3;
    const hitStart = Math.max(lineStart, boxStart - 1);
    const hitEnd = Math.min(value.length, boxEnd + 1);
    if (offset < hitStart || offset > hitEnd) return null;

    return {
      checkIndex: boxStart + 1,
      checked: /[xX]/.test(taskMatch[4]),
    };
  }

  function toggleMarkdownTaskAtOffset(offset: number): boolean {
    const ta = textareaEl;
    if (!ta || !isMarkdownLanguage() || markdownRenderMode === "raw") return false;

    const task = findMarkdownTaskAtOffset(ta.value, offset);
    if (!task) return false;

    const next = task.checked ? " " : "x";
    const nextValue = `${ta.value.slice(0, task.checkIndex)}${next}${ta.value.slice(task.checkIndex + 1)}`;
    if (nextValue === ta.value) return false;

    ta.value = nextValue;
    ta.setSelectionRange(task.checkIndex, task.checkIndex);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }

  function insertTextAtSelection(text: string) {
    const ta = textareaEl;
    if (!ta) return;

    if (hasVirtualCursors()) {
      applyInsertTextAtVirtualCursors(text);
      return;
    }

    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
    const next = start + text.length;
    ta.setSelectionRange(next, next);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function toggleMarkdownTasksInSelection(): boolean {
    const ta = textareaEl;
    if (!ta || !isMarkdownLanguage()) return false;

    const start = ta.selectionStart;
    const end = ta.selectionEnd;

    if (start === end) {
      return toggleMarkdownTaskAtOffset(start);
    }

    const value = ta.value;
    const blockStart = value.lastIndexOf("\n", start - 1) + 1;
    const lineEnd = value.indexOf("\n", end);
    const blockEnd = lineEnd === -1 ? value.length : lineEnd;
    const block = value.slice(blockStart, blockEnd);

    let changed = false;
    const toggledBlock = block.replace(/^(\s*(?:[-*+]|\d+\.)\s+\[)( |x|X)(\])/gm, (_m, pre, state, post) => {
      changed = true;
      const next = state === " " ? "x" : " ";
      return `${pre}${next}${post}`;
    });

    if (!changed) return false;

    ta.value = value.slice(0, blockStart) + toggledBlock + value.slice(blockEnd);
    ta.setSelectionRange(start, end);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }

  function onTextareaMouseUp() {
    scheduleMarkdownSelectionSync();
  }

  function onTextareaKeyUp() {
    scheduleMarkdownSelectionSync();
  }

  function onTextareaClick() {
    scheduleMarkdownSelectionSync();
  }

  function onTextareaFocus() {
    scheduleMarkdownSelectionSync();
  }

  // Characters after which we add an extra indent level on Enter
  const INDENT_AFTER = new Set(["{", "(", "[", ":", ">"]);

  function handleEnter(event: KeyboardEvent) {
    const ta = textareaEl!;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const val = ta.value;

    // Find the current line
    const lineStart = val.lastIndexOf("\n", start - 1) + 1;
    const lineText = val.slice(lineStart, start);

    // Match leading whitespace
    const match = lineText.match(/^(\s*)/);
    let indent = match ? match[1] : "";

    // Check the last non-whitespace character before cursor
    const trimmed = lineText.trimEnd();
    const lastChar = trimmed[trimmed.length - 1];
    if (lastChar && INDENT_AFTER.has(lastChar)) {
      indent += "  ";
    }

    // Check if cursor is between brackets, e.g. {|}
    const charAfter = val[end];
    const isBetweenBrackets =
      (lastChar === "{" && charAfter === "}") ||
      (lastChar === "(" && charAfter === ")") ||
      (lastChar === "[" && charAfter === "]");

    if (isBetweenBrackets) {
      // Insert newline + indent, then another newline + original indent, cursor on indented line
      event.preventDefault();
      const baseIndent = (match ? match[1] : "");
      const insert = "\n" + indent + "\n" + baseIndent;
      ta.value = val.slice(0, start) + insert + val.slice(end);
      ta.selectionStart = ta.selectionEnd = start + 1 + indent.length;
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }

    if (indent) {
      event.preventDefault();
      const insert = "\n" + indent;
      ta.value = val.slice(0, start) + insert + val.slice(end);
      ta.selectionStart = ta.selectionEnd = start + insert.length;
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }

    // No indent needed — let the browser handle the plain Enter
  }

  const NAVIGATION_KEYS = new Set([
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "ArrowDown",
    "Home",
    "End",
    "PageUp",
    "PageDown"
  ]);

  function onKeyDown(event: KeyboardEvent) {
    const mod = event.metaKey || event.ctrlKey;
    const ctrlOnly = event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
    const key = event.key.toLowerCase();

    if (ctrlOnly && key === "t") {
      event.preventDefault();
      toggleMarkdownTasksInSelection();
      return;
    }

    if (ctrlOnly && key === "x") {
      event.preventDefault();
      insertTextAtSelection("❌");
      return;
    }

    if (ctrlOnly && key === "c") {
      event.preventDefault();
      insertTextAtSelection("✅");
      return;
    }

    if (mod && key === "z") {
      if (event.shiftKey) {
        if (canRedoHistory()) {
          event.preventDefault();
          redoHistory();
          return;
        }
      } else if (canUndoHistory()) {
        event.preventDefault();
        undoHistory();
        return;
      }
    }

    if (event.ctrlKey && key === "y" && canRedoHistory()) {
      event.preventDefault();
      redoHistory();
      return;
    }

    if (event.key === "Escape" && multiCursor.active) {
      event.preventDefault();
      clearMultiCursor();
      return;
    }

    if (hasVirtualCursors()) {
      if (event.key === "Enter") {
        event.preventDefault();
        applyInsertTextAtVirtualCursors("\n");
        return;
      }

      if (event.key === "Tab") {
        event.preventDefault();
        if (event.shiftKey) applyShiftTabAtVirtualCursors();
        else applyInsertTextAtVirtualCursors("  ");
        return;
      }

      if (
        NAVIGATION_KEYS.has(event.key) &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        clearMultiCursor();
        return;
      }
    }

    if (event.key === "Enter") {
      return handleEnter(event);
    }

    if (event.key !== "Tab") return;
    event.preventDefault();

    const ta = textareaEl!;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;

    if (start === end && !event.shiftKey) {
      // No selection — insert two spaces at cursor
      const before = ta.value.slice(0, start);
      const after = ta.value.slice(end);
      ta.value = before + "  " + after;
      ta.selectionStart = ta.selectionEnd = start + 2;
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }

    // Selection exists — indent/dedent whole lines
    const val = ta.value;
    const lineStart = val.lastIndexOf("\n", start - 1) + 1;
    const lineEnd = val.indexOf("\n", end);
    const blockEnd = lineEnd === -1 ? val.length : lineEnd;
    const block = val.slice(lineStart, blockEnd);
    const lines = block.split("\n");

    let newLines: string[];
    let delta = 0;
    let firstDelta = 0;

    if (event.shiftKey) {
      // Dedent
      newLines = lines.map((line, i) => {
        if (line.startsWith("  ")) {
          if (i === 0) firstDelta = -2;
          delta -= 2;
          return line.slice(2);
        }
        if (line.startsWith("\t")) {
          if (i === 0) firstDelta = -1;
          delta -= 1;
          return line.slice(1);
        }
        return line;
      });
    } else {
      // Indent
      newLines = lines.map((line) => "  " + line);
      firstDelta = 2;
      delta = lines.length * 2;
    }

    const newBlock = newLines.join("\n");
    ta.value = val.slice(0, lineStart) + newBlock + val.slice(blockEnd);
    ta.selectionStart = Math.max(lineStart, start + firstDelta);
    ta.selectionEnd = end + delta;
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function handleCloseFindBar() {
    onclosefind();
    textareaEl?.focus();
  }

  // Re-highlight on external content changes (tab switch, file load)
  // Typing already calls highlightSync() directly in onInput, so skip those.
  let lastHighlightGen = 0;
  $effect(() => {
    void content;
    if (inputGeneration !== lastHighlightGen) {
      lastHighlightGen = inputGeneration;
      return; // already highlighted synchronously in onInput
    }
    scheduleHighlight();
  });

  // Re-highlight on language/theme changes (async, needs loading)
  $effect(() => {
    void language;
    void theme;
    void renderHighlight();
  });

  // Keep ghost selections in sync with layout/content changes.
  $effect(() => {
    void content;
    void wordWrap;
    void fontSize;
    void measureLayerEl;
    if (hasVirtualCursors()) scheduleGhostVisuals();
  });

  // Keep minimap data/viewport synced with content and size changes.
  $effect(() => {
    void content;
    void wordWrap;
    void fontSize;
    void minimapEl;
    void gitLineChanges;
    rebuildMinimapBars();
    updateMinimapViewport();
  });

  // Track editable markdown constructs (bold/table) to toggle raw vs rendered view.
  $effect(() => {
    void content;
    void language;

    if (!isMarkdownLanguage()) {
      markdownEditRanges = [];
      setMarkdownRenderMode("rendered");
      return;
    }

    markdownEditRanges = computeMarkdownEditRanges(content);
    updateMarkdownEditModeFromSelection();
  });

  onMount(() => {
    const observer = new ResizeObserver(() => {
      if (hasVirtualCursors()) scheduleGhostVisuals();
      rebuildMinimapBars();
      updateMinimapViewport();
    });

    if (textareaEl) {
      observer.observe(textareaEl);
      resetHistory(textareaEl.value, textareaEl.selectionStart, textareaEl.selectionEnd);

      if (isMarkdownLanguage()) {
        markdownEditRanges = computeMarkdownEditRanges(textareaEl.value);
        updateMarkdownEditModeFromSelection();
      }
    } else {
      resetHistory(content, 0, 0);
    }

    if (minimapEl) observer.observe(minimapEl);

    const onWindowResize = () => {
      if (hasVirtualCursors()) scheduleGhostVisuals();
      rebuildMinimapBars();
      updateMinimapViewport();
    };
    window.addEventListener("resize", onWindowResize);

    void (async () => {
      highlighter = await createHighlighter({
        themes: [theme],
        langs: [language]
      });
      await renderHighlight();
      rebuildMinimapBars();
      updateMinimapViewport();
      if (hasVirtualCursors()) scheduleGhostVisuals();
    })();

    return () => {
      minimapDragging = false;
      observer.disconnect();
      window.removeEventListener("resize", onWindowResize);
      clearGhostVisuals();
    };
  });
</script>

<section class="editor-shell" class:word-wrap={wordWrap} style="--editor-font-size: {fontSize}px">
  {#if showFind}
    <FindBar
      bind:this={findBarRef}
      {content}
      {textareaEl}
      syncScroll={syncScroll}
      onclose={handleCloseFindBar}
    />
  {/if}
  <div class="code-layer" bind:this={codeLayerEl} aria-hidden="true">
    {@html highlightedHtml}
  </div>
  <div class="ghost-layer" aria-hidden="true">
    {#each ghostSelections as rect (rect.key)}
      <div
        class="ghost-selection"
        style={`left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;`}
      ></div>
    {/each}
    {#each ghostCarets as caret (caret.key)}
      <div
        class="ghost-caret"
        style={`left:${caret.left}px;top:${caret.top}px;height:${caret.height}px;`}
      ></div>
    {/each}
  </div>
  <div class="measure-layer" bind:this={measureLayerEl} aria-hidden="true"></div>
  <textarea
    bind:this={textareaEl}
    value={content}
    oninput={onInput}
    onbeforeinput={onBeforeInput}
    onpaste={onPaste}
    onselect={onTextareaSelect}
    onmouseup={onTextareaMouseUp}
    onkeyup={onTextareaKeyUp}
    onclick={onTextareaClick}
    onfocus={onTextareaFocus}
    onkeydown={onKeyDown}
    onscroll={syncScroll}
    spellcheck="false"
  ></textarea>

  <div
    class="minimap"
    bind:this={minimapEl}
    onmousedown={onMinimapMouseDown}
    onwheel={onMinimapWheel}
    aria-hidden="true"
  >
    <svg class="minimap-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
      {#each minimapBars as bar (bar.key)}
        <rect
          x="0"
          y={bar.y}
          width={bar.width}
          height={bar.height}
          fill="currentColor"
          opacity={bar.opacity}
          rx="0.8"
          ry="0.8"
        ></rect>
      {/each}
    </svg>
    <div class="minimap-git-layer" aria-hidden="true">
      {#each minimapGitMarkers as marker (marker.key)}
        <div
          class="minimap-git-marker"
          class:added={marker.kind === "added"}
          class:modified={marker.kind === "modified"}
          class:deleted={marker.kind === "deleted"}
          style={`top:${marker.top}px;height:${marker.height}px;`}
        ></div>
      {/each}
    </div>
    <div
      class="minimap-viewport"
      style={`top:${minimapViewportTop}px;height:${minimapViewportHeight}px;`}
    ></div>
  </div>
</section>

<style>
  .editor-shell {
    position: relative;
    min-height: 0;
    overflow: hidden;
    background: #1a1a1a;
    --minimap-width: 112px;
  }

  .code-layer,
  .measure-layer,
  textarea {
    position: absolute;
    inset: 0;
    box-sizing: border-box;
    padding: 1rem;
    padding-right: calc(1rem + var(--minimap-width));
    margin: 0;
    border: none;
    outline: none;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: var(--editor-font-size, 15px);
    line-height: 1.45;
    font-weight: normal;
    font-style: normal;
    font-variant: normal;
    font-variant-ligatures: none;
    font-feature-settings: normal;
    font-stretch: normal;
    letter-spacing: 0px;
    word-spacing: 0px;
    text-rendering: geometricPrecision;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    -webkit-text-size-adjust: none;
    tab-size: 2;
    overflow: auto;
    white-space: pre;
  }

  .code-layer {
    pointer-events: none;
    z-index: 1;
  }

  .measure-layer {
    visibility: hidden;
    pointer-events: none;
    z-index: 0;
  }

  .ghost-layer {
    position: absolute;
    inset: 0;
    right: var(--minimap-width);
    pointer-events: none;
    z-index: 2;
  }

  .ghost-selection {
    position: absolute;
    background: rgba(200, 149, 108, 0.2);
    border-radius: 2px;
  }

  .ghost-caret {
    position: absolute;
    width: 2px;
    margin-left: -1px;
    background: #c8956c;
    border-radius: 1px;
    opacity: 0.95;
  }

  .minimap {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: var(--minimap-width);
    border-left: 1px solid #2a2a2a;
    background: #171717;
    color: #6f685f;
    z-index: 4;
    cursor: pointer;
    user-select: none;
  }

  .minimap-svg {
    display: block;
    width: 100%;
    height: 100%;
  }

  .minimap-git-layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .minimap-git-marker {
    position: absolute;
    right: 0;
    width: 4px;
    border-radius: 2px 0 0 2px;
    opacity: 0.95;
  }

  .minimap-git-marker.added {
    background: #3fb950;
  }

  .minimap-git-marker.modified {
    background: #d29922;
  }

  .minimap-git-marker.deleted {
    background: #f85149;
  }

  .minimap-viewport {
    position: absolute;
    left: 0;
    right: 0;
    border: 1px solid #c8956c99;
    background: rgba(200, 149, 108, 0.09);
    box-sizing: border-box;
    pointer-events: none;
  }

  .minimap:hover .minimap-viewport {
    border-color: #c8956ccc;
    background: rgba(200, 149, 108, 0.12);
  }

  .code-layer :global(pre) {
    margin: 0 !important;
    padding: 0 !important;
    min-height: 100%;
    background: transparent !important;
    font: inherit;
    letter-spacing: inherit;
    word-spacing: inherit;
    text-rendering: inherit;
    -webkit-font-smoothing: inherit;
    font-variant-ligatures: inherit;
    font-feature-settings: inherit;
  }

  .code-layer :global(code) {
    font: inherit;
    letter-spacing: inherit;
    word-spacing: inherit;
    text-rendering: inherit;
    -webkit-font-smoothing: inherit;
    font-variant-ligatures: inherit;
    font-feature-settings: inherit;
  }

  .code-layer :global(span) {
    font: inherit;
    letter-spacing: inherit;
    word-spacing: inherit;
    text-rendering: inherit;
    -webkit-font-smoothing: inherit;
    font-variant-ligatures: inherit;
    font-feature-settings: inherit;
  }

  /* Markdown enhancements */
  .code-layer :global(.md-h) {
    font-weight: 700 !important;
  }

  .code-layer :global(.md-h1 span) {
    color: #c8956c !important;
  }

  .code-layer :global(.md-h2 span) {
    color: #c8956c !important;
    opacity: 0.85;
  }

  .code-layer :global(.md-h3 span) {
    color: #c8956c !important;
    opacity: 0.7;
  }

  .code-layer :global(.md-bold-marker) {
    color: transparent !important;
    -webkit-text-fill-color: transparent;
    opacity: 0;
  }

  .code-layer :global(.md-bold-marker *) {
    color: transparent !important;
    -webkit-text-fill-color: transparent !important;
    opacity: 0 !important;
  }

  .code-layer :global(.md-bold-content) {
    font-weight: 700 !important;
    color: #f2d3b0 !important;
  }

  .code-layer :global(.md-table) {
    color: #a79c8f;
  }

  .code-layer :global(.md-list .md-list-marker) {
    color: transparent !important;
    position: relative;
    display: inline-block;
    width: 1ch;
  }

  .code-layer :global(.md-list .md-list-marker *) {
    color: transparent !important;
  }

  .code-layer :global(.md-list .md-list-marker)::before {
    content: "◉";
    position: absolute;
    left: 0;
    top: 0;
    width: 1ch;
    text-align: center;
    color: #c8956c;
    -webkit-text-fill-color: #c8956c;
    opacity: 0.95;
  }

  .code-layer :global(.md-list .md-list-marker.depth-1)::before {
    content: "○";
    opacity: 0.88;
  }

  .code-layer :global(.md-list .md-list-marker.depth-2)::before {
    content: "◦";
    opacity: 0.8;
  }

  .code-layer :global(.md-list .md-list-marker.task)::before {
    content: "";
  }

  .code-layer :global(.md-list .md-task-box) {
    color: transparent !important;
    -webkit-text-fill-color: transparent !important;
    position: relative;
    display: inline-block;
    width: 3ch;
  }

  .code-layer :global(.md-list .md-task-box *) {
    color: transparent !important;
    -webkit-text-fill-color: transparent !important;
  }

  .code-layer :global(.md-list .md-task-box)::before {
    content: "☐";
    position: absolute;
    left: 0.55ch;
    top: 0;
    color: #c8956c;
    -webkit-text-fill-color: #c8956c;
    opacity: 0.92;
  }

  .code-layer :global(.md-list .md-task-box.checked)::before {
    content: "☑";
    opacity: 0.98;
  }

  .code-layer :global(.md-olist .md-olist-marker) {
    color: #c8956c !important;
    opacity: 0.8;
    font-weight: 600;
  }

  .code-layer :global(.md-quote) {
    border-left: 2px solid #c8956c40;
    padding-left: 0.75rem;
    margin-left: -0.75rem;
  }

  .code-layer :global(.md-quote span) {
    opacity: 0.7;
    font-style: italic;
  }

  .code-layer :global(.md-hr) {
    opacity: 0.3;
  }

  .code-layer :global(.md-frontmatter) {
    opacity: 0.35;
  }

  .word-wrap .code-layer,
  .word-wrap .measure-layer,
  .word-wrap textarea {
    white-space: pre-wrap;
    word-break: break-word;
  }

  textarea {
    resize: none;
    background: transparent;
    color: transparent;
    caret-color: #c8956c;
    z-index: 3;
  }

  textarea::selection {
    background: rgba(200, 149, 108, 0.15);
  }
</style>
