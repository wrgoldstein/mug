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
    onchange: (content: string) => void;
    onclosefind: () => void;
  }

  let { content, language, theme, fontSize, isDirty = $bindable(), showFind, onchange, onclosefind }: Props = $props();

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

  function escapeHtml(text: string) {
    return text
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  async function renderHighlight() {
    if (!highlighter) {
      highlightedHtml = `<pre class="shiki"><code>${escapeHtml(content)}</code></pre>`;
      return;
    }

    await highlighter.loadLanguage(language);
    await highlighter.loadTheme(theme);

    highlightedHtml = highlighter.codeToHtml(content || " ", {
      lang: language,
      theme: theme
    });

    syncScroll();
  }

  function syncScroll() {
    if (!textareaEl || !codeLayerEl) return;
    codeLayerEl.scrollTop = textareaEl.scrollTop;
    codeLayerEl.scrollLeft = textareaEl.scrollLeft;
  }

  function scheduleHighlight() {
    if (highlightTimer) window.clearTimeout(highlightTimer);
    highlightTimer = window.setTimeout(() => {
      void renderHighlight();
    }, 40);
  }

  function onInput(event: Event) {
    const value = (event.target as HTMLTextAreaElement).value;
    onchange(value);
    isDirty = true;
    scheduleHighlight();
  }

  function onKeyDown(event: KeyboardEvent) {
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

  // Re-highlight when language, theme, or content changes externally
  $effect(() => {
    // Touch reactive deps
    void language;
    void theme;
    void content;
    scheduleHighlight();
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

<section class="editor-shell" style="--editor-font-size: {fontSize}px">
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
    background: #0f172a;
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

  textarea {
    resize: none;
    background: transparent;
    color: transparent;
    caret-color: #f9fafb;
  }

  textarea::selection {
    background: rgba(59, 130, 246, 0.35);
  }
</style>
