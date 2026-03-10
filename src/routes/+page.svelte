<script lang="ts">
  import { onMount } from "svelte";
  import { open, save } from "@tauri-apps/plugin-dialog";
  import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
  import { createHighlighter, type BundledLanguage, type BundledTheme, type Highlighter } from "shiki";

  let content = $state("");
  let currentPath = $state<string | null>(null);
  let isDirty = $state(false);
  let status = $state("Ready");
  let highlightedHtml = $state('<pre class="shiki"><code></code></pre>');

  let selectedLanguage = $state<BundledLanguage>("ts");
  let selectedTheme = $state<BundledTheme>("github-dark");

  let highlighter: Highlighter | null = null;
  let highlightTimer: number | null = null;

  let textareaEl = $state<HTMLTextAreaElement | null>(null);
  let codeLayerEl = $state<HTMLDivElement | null>(null);

  const languageOptions: BundledLanguage[] = ["ts", "js", "svelte", "json", "md", "html", "css", "rust", "bash"];
  const themeOptions: BundledTheme[] = ["github-dark", "github-light", "dracula", "nord"];

  function fileName(path: string | null) {
    if (!path) return "Untitled";
    const parts = path.split(/[\\/]/);
    return parts[parts.length - 1] || path;
  }

  function escapeHtml(text: string) {
    return text
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function detectLanguage(path: string): BundledLanguage {
    const ext = path.split(".").pop()?.toLowerCase();
    switch (ext) {
      case "ts":
        return "ts";
      case "js":
        return "js";
      case "svelte":
        return "svelte";
      case "json":
        return "json";
      case "md":
        return "md";
      case "html":
        return "html";
      case "css":
        return "css";
      case "rs":
        return "rust";
      case "sh":
      case "bash":
        return "bash";
      default:
        return "ts";
    }
  }

  async function renderHighlight() {
    if (!highlighter) {
      highlightedHtml = `<pre class="shiki"><code>${escapeHtml(content)}</code></pre>`;
      return;
    }

    await highlighter.loadLanguage(selectedLanguage);
    await highlighter.loadTheme(selectedTheme);

    highlightedHtml = highlighter.codeToHtml(content || " ", {
      lang: selectedLanguage,
      theme: selectedTheme
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

  async function newFile() {
    content = "";
    currentPath = null;
    isDirty = false;
    status = "New file";
    scheduleHighlight();
  }

  async function openFile() {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Text", extensions: ["txt", "md", "json", "js", "ts", "svelte", "css", "html", "rs", "sh"] }]
    });

    if (!selected || Array.isArray(selected)) return;

    content = await readTextFile(selected);
    currentPath = selected;
    selectedLanguage = detectLanguage(selected);
    isDirty = false;
    status = `Opened ${fileName(selected)}`;
    scheduleHighlight();
  }

  async function saveFile() {
    if (currentPath) {
      await writeTextFile(currentPath, content);
      isDirty = false;
      status = `Saved ${fileName(currentPath)}`;
      return;
    }

    await saveAsFile();
  }

  async function saveAsFile() {
    const selected = await save({
      filters: [{ name: "Text", extensions: ["txt", "md"] }],
      defaultPath: currentPath ?? "untitled.txt"
    });

    if (!selected) return;

    await writeTextFile(selected, content);
    currentPath = selected;
    selectedLanguage = detectLanguage(selected);
    isDirty = false;
    status = `Saved ${fileName(selected)}`;
  }

  function onInput(event: Event) {
    content = (event.target as HTMLTextAreaElement).value;
    isDirty = true;
    scheduleHighlight();
  }

  function onLanguageChange(event: Event) {
    selectedLanguage = (event.target as HTMLSelectElement).value as BundledLanguage;
    status = `Language: ${selectedLanguage}`;
    scheduleHighlight();
  }

  function onThemeChange(event: Event) {
    selectedTheme = (event.target as HTMLSelectElement).value as BundledTheme;
    status = `Theme: ${selectedTheme}`;
    scheduleHighlight();
  }

  onMount(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;

      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (event.shiftKey) saveAsFile();
        else saveFile();
      }

      if (event.key.toLowerCase() === "o") {
        event.preventDefault();
        openFile();
      }

      if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        newFile();
      }
    };

    void (async () => {
      highlighter = await createHighlighter({
        themes: [selectedTheme],
        langs: [selectedLanguage]
      });
      await renderHighlight();
    })();

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });
</script>

<main>
  <header>
    <h1>{fileName(currentPath)}{isDirty ? " •" : ""}</h1>
    <div class="actions">
      <button onclick={newFile}>New</button>
      <button onclick={openFile}>Open</button>
      <button onclick={saveFile}>Save</button>
      <button onclick={saveAsFile}>Save As</button>
      <label>
        Lang
        <select value={selectedLanguage} onchange={onLanguageChange}>
          {#each languageOptions as lang}
            <option value={lang}>{lang}</option>
          {/each}
        </select>
      </label>
      <label>
        Theme
        <select value={selectedTheme} onchange={onThemeChange}>
          {#each themeOptions as theme}
            <option value={theme}>{theme}</option>
          {/each}
        </select>
      </label>
    </div>
  </header>

  <section class="editor-shell">
    <div class="code-layer" bind:this={codeLayerEl} aria-hidden="true">
      {@html highlightedHtml}
    </div>
    <textarea
      bind:this={textareaEl}
      value={content}
      oninput={onInput}
      onscroll={syncScroll}
      spellcheck="false"
    ></textarea>
  </section>

  <footer>
    <span>{status}</span>
    <span>{currentPath ?? "No file selected"}</span>
  </footer>
</main>

<style>
  :global(body) {
    margin: 0;
    font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    background: #111827;
    color: #f9fafb;
  }

  main {
    height: 100vh;
    display: grid;
    grid-template-rows: auto 1fr auto;
  }

  header,
  footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    background: #1f2937;
    border-bottom: 1px solid #374151;
    gap: 1rem;
  }

  footer {
    border-top: 1px solid #374151;
    border-bottom: none;
    font-size: 0.85rem;
    color: #d1d5db;
  }

  .actions {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    flex-wrap: wrap;
  }

  button,
  select {
    border: 1px solid #4b5563;
    background: #374151;
    color: #f9fafb;
    border-radius: 8px;
    padding: 0.35rem 0.7rem;
  }

  button {
    cursor: pointer;
  }

  button:hover {
    background: #4b5563;
  }

  label {
    font-size: 0.85rem;
    color: #d1d5db;
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

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
    font-size: 0.95rem;
    line-height: 1.45;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
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

  h1 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
