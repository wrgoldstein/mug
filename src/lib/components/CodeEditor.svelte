<script lang="ts">
  import { onMount } from "svelte";
  import { createHighlighter, type BundledLanguage, type BundledTheme, type Highlighter } from "shiki";
  import FindBar from "./FindBar.svelte";

  interface Props {
    content: string;
    language: BundledLanguage;
    theme: BundledTheme;
    fontSize: number;
    isDirty: boolean;
    showFind: boolean;
    wordWrap: boolean;
    onchange: (content: string) => void;
    onclosefind: () => void;
  }

  let { content, language, theme, fontSize, isDirty, showFind, wordWrap, onchange, onclosefind }: Props = $props();

  let highlightedHtml = $state('<pre class="shiki"><code></code></pre>');
  let highlighter: Highlighter | null = null;
  let highlightTimer: number | null = null;

  let textareaEl = $state<HTMLTextAreaElement | null>(null);
  let codeLayerEl = $state<HTMLDivElement | null>(null);
  let findBarRef: FindBar | null = $state(null);

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

  /**
   * Cmd+D: If nothing selected, select the word under cursor.
   * If text is selected, find and select the next occurrence of it,
   * replacing the selection to extend to cover both.
   * (Textarea only supports one selection, so we replace the selected text
   * with all occurrences replaced.)
   */
  export function selectNextOccurrence() {
    const ta = textareaEl;
    if (!ta) return;

    let start = ta.selectionStart;
    let end = ta.selectionEnd;
    const val = ta.value;

    // Nothing selected — select the word under cursor
    if (start === end) {
      const wordChars = /[\w$]/;
      let wStart = start;
      let wEnd = start;
      while (wStart > 0 && wordChars.test(val[wStart - 1])) wStart--;
      while (wEnd < val.length && wordChars.test(val[wEnd])) wEnd++;
      if (wStart < wEnd) {
        ta.selectionStart = wStart;
        ta.selectionEnd = wEnd;
      }
      return;
    }

    // Text is selected — find the next occurrence after current selection
    const selected = val.slice(start, end);
    const searchFrom = end;
    let nextIdx = val.indexOf(selected, searchFrom);
    if (nextIdx === -1) {
      // Wrap around
      nextIdx = val.indexOf(selected);
    }
    if (nextIdx !== -1 && nextIdx !== start) {
      ta.selectionStart = nextIdx;
      ta.selectionEnd = nextIdx + selected.length;
      // Scroll to the new selection
      ta.blur();
      ta.focus();
    }
  }

  /**
   * Cmd+Shift+L: Select all occurrences of the current selection and replace them.
   * Since textarea doesn't support multi-cursor, we open find-and-replace prefilled.
   * As a practical alternative: select all text matching current word/selection.
   */
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
    requestAnimationFrame(() => {
      if (!textareaEl) return;
      textareaEl.selectionStart = cursor.selectionStart;
      textareaEl.selectionEnd = cursor.selectionEnd;
      textareaEl.scrollTop = scroll.scrollTop;
      textareaEl.scrollLeft = scroll.scrollLeft;
      syncScroll();
    });
  }

  function enhanceMarkdown(html: string): string {
    // Process line by line to add classes for markdown elements
    return html.replace(/<span class="line">(.*)<\/span>/g, (match, inner) => {
      const text = inner.replace(/<[^>]*>/g, ""); // strip tags to get raw text

      // Headers: lines starting with #
      if (/^#{1,6}\s/.test(text)) {
        const level = text.match(/^(#+)/)?.[1].length ?? 1;
        return `<span class="line md-h md-h${level}">${inner}</span>`;
      }

      // Horizontal rules
      if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(text)) {
        return `<span class="line md-hr">${inner}</span>`;
      }

      // List items
      if (/^(\s*[-*+]|\s*\d+\.)\s/.test(text)) {
        return `<span class="line md-list">${inner}</span>`;
      }

      // Blockquotes
      if (/^\s*>/.test(text)) {
        return `<span class="line md-quote">${inner}</span>`;
      }

      // Frontmatter delimiters
      if (/^---\s*$/.test(text)) {
        return `<span class="line md-frontmatter">${inner}</span>`;
      }

      return match;
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

    if (language === "md" || language === "markdown") {
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
    if (!textareaEl || !codeLayerEl) return;
    codeLayerEl.scrollTop = textareaEl.scrollTop;
    codeLayerEl.scrollLeft = textareaEl.scrollLeft;
  }

  function scheduleHighlight() {
    if (highlightTimer) cancelAnimationFrame(highlightTimer);
    highlightTimer = requestAnimationFrame(highlightSync);
  }

  let inputGeneration = 0; // incremented on typing to skip redundant $effect highlights

  function onInput(event: Event) {
    const value = (event.target as HTMLTextAreaElement).value;
    onchange(value);
    inputGeneration++;
    highlightSync(); // synchronous — no debounce, no frame delay
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

  function onKeyDown(event: KeyboardEvent) {
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

  onMount(() => {
    void (async () => {
      highlighter = await createHighlighter({
        themes: [theme],
        langs: [language]
      });
      await renderHighlight();
    })();
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
  <textarea
    bind:this={textareaEl}
    value={content}
    oninput={onInput}
    onkeydown={onKeyDown}
    onscroll={syncScroll}
    spellcheck="false"
  ></textarea>
</section>

<style>
  .editor-shell {
    position: relative;
    min-height: 0;
    overflow: hidden;
    background: #1a1a1a;
  }

  .code-layer,
  textarea {
    position: absolute;
    inset: 0;
    box-sizing: border-box;
    padding: 1rem;
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
  .word-wrap textarea {
    white-space: pre-wrap;
    word-break: break-word;
  }

  textarea {
    resize: none;
    background: transparent;
    color: transparent;
    caret-color: #c8956c;
  }

  textarea::selection {
    background: rgba(200, 149, 108, 0.15);
  }
</style>
