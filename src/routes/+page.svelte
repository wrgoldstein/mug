<script lang="ts">
  import { onMount } from "svelte";
  import { open, save } from "@tauri-apps/plugin-dialog";
  import { readDir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
  import { createHighlighter, type BundledLanguage, type BundledTheme, type Highlighter } from "shiki";

  type SidebarEntry = {
    path: string;
    name: string;
    isDirectory: boolean;
    isFile: boolean;
  };

  let content = $state("");
  let currentPath = $state<string | null>(null);
  let rootDir = $state<string | null>(null);
  let browseDir = $state<string | null>(null);
  let sidebarEntries = $state<SidebarEntry[]>([]);
  let isDirty = $state(false);
  let status = $state("Ready");
  let highlightedHtml = $state('<pre class="shiki"><code></code></pre>');

  let selectedLanguage = $state<BundledLanguage>("ts");
  let selectedTheme = $state<BundledTheme>("github-dark");

  let highlighter: Highlighter | null = null;
  let highlightTimer: number | null = null;

  let textareaEl = $state<HTMLTextAreaElement | null>(null);
  let codeLayerEl = $state<HTMLDivElement | null>(null);

  const languageOptions: BundledLanguage[] = ["ts", "js", "python", "svelte", "json", "md", "html", "css", "rust", "bash"];
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
      case "py":
        return "python";
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

  function joinPath(parent: string, child: string) {
    if (parent.endsWith("/") || parent.endsWith("\\")) return `${parent}${child}`;
    return `${parent}/${child}`;
  }

  function parentPath(path: string) {
    const normalized = path.replace(/[\\/]+$/, "");
    const slash = normalized.lastIndexOf("/");
    const backslash = normalized.lastIndexOf("\\");
    const index = Math.max(slash, backslash);
    if (index <= 0) return path;
    return normalized.slice(0, index);
  }

  function relativePath(path: string, base: string | null) {
    if (!base) return path;
    if (!path.startsWith(base)) return path;
    const rel = path.slice(base.length).replace(/^[/\\]/, "");
    return rel || ".";
  }

  async function listDirectory(dirPath: string) {
    const entries = await readDir(dirPath);
    const filtered = entries.filter((entry) => {
      if (entry.name.startsWith(".")) return false;
      if (entry.isDirectory && (entry.name === "node_modules" || entry.name === "target" || entry.name === "dist" || entry.name === "build")) {
        return false;
      }
      return true;
    });

    filtered.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });

    sidebarEntries = filtered.map((entry) => ({
      path: joinPath(dirPath, entry.name),
      name: entry.name,
      isDirectory: entry.isDirectory,
      isFile: entry.isFile
    }));

    browseDir = dirPath;
  }

  async function openDirectory() {
    const selected = await open({
      directory: true,
      multiple: false
    });

    if (!selected || Array.isArray(selected)) return;

    rootDir = selected;
    try {
      await listDirectory(selected);
      status = `Loaded ${sidebarEntries.length} entries`;
    } catch (err) {
      sidebarEntries = [];
      status = `Could not read folder: ${err}`;
    }
  }

  async function openPath(path: string) {
    content = await readTextFile(path);
    currentPath = path;
    selectedLanguage = detectLanguage(path);
    isDirty = false;
    status = `Opened ${fileName(path)}`;
    scheduleHighlight();
  }

  async function openSidebarEntry(entry: SidebarEntry) {
    if (entry.isDirectory) {
      try {
        await listDirectory(entry.path);
        status = `Browsing ${entry.name}`;
      } catch (err) {
        status = `Could not open folder: ${err}`;
      }
      return;
    }

    await openPath(entry.path);
  }

  async function goUpDirectory() {
    if (!browseDir || !rootDir || browseDir === rootDir) return;
    const up = parentPath(browseDir);
    if (!up.startsWith(rootDir)) return;
    await listDirectory(up);
  }

  async function goRootDirectory() {
    if (!rootDir) return;
    await listDirectory(rootDir);
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
      filters: [{ name: "Text", extensions: ["txt", "md", "json", "js", "ts", "py", "svelte", "css", "html", "rs", "sh"] }]
    });

    if (!selected || Array.isArray(selected)) return;
    await openPath(selected);
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

    if (browseDir) {
      try {
        await listDirectory(browseDir);
      } catch {
        // ignore sidebar refresh failures
      }
    }
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
        if (event.shiftKey) openFile();
        else openDirectory();
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
      <button onclick={openFile}>Open File</button>
      <button onclick={openDirectory}>Open Folder</button>
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

  <section class="workspace">
    <aside class="sidebar">
      <div class="sidebar-title">{rootDir ? fileName(rootDir) : "No folder open"}</div>

      {#if rootDir}
        <div class="sidebar-nav">
          <button onclick={goRootDirectory} disabled={!browseDir || browseDir === rootDir}>Root</button>
          <button onclick={goUpDirectory} disabled={!browseDir || browseDir === rootDir}>Up</button>
          <span title={browseDir ?? ""}>{browseDir ? relativePath(browseDir, rootDir) : ""}</span>
        </div>
      {/if}

      <div class="file-list">
        {#if !rootDir}
          <p class="muted">Open a folder to browse files.</p>
        {:else if sidebarEntries.length === 0}
          <p class="muted">This folder is empty.</p>
        {:else}
          {#each sidebarEntries as entry}
            <button class="file-row" onclick={() => openSidebarEntry(entry)} title={entry.path}>
              {entry.isDirectory ? "📁" : "📄"} {entry.name}
            </button>
          {/each}
        {/if}
      </div>
    </aside>

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

  button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  label {
    font-size: 0.85rem;
    color: #d1d5db;
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  .workspace {
    display: grid;
    grid-template-columns: 280px 1fr;
    min-height: 0;
  }

  .sidebar {
    border-right: 1px solid #374151;
    background: #0b1220;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .sidebar-title {
    padding: 0.7rem 0.75rem;
    font-size: 0.85rem;
    font-weight: 600;
    border-bottom: 1px solid #1f2937;
  }

  .sidebar-nav {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.45rem;
    border-bottom: 1px solid #1f2937;
  }

  .sidebar-nav span {
    font-size: 0.75rem;
    color: #9ca3af;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-list {
    flex: 1 1 0;
    min-height: 0;
    overflow-y: auto;
    padding: 0.4rem;
  }

  .file-row {
    display: block;
    width: 100%;
    text-align: left;
    font-size: 0.82rem;
    background: transparent;
    border-color: transparent;
    white-space: nowrap;
    text-overflow: ellipsis;
    overflow: hidden;
    padding: 0.35rem 0.5rem;
    line-height: 1.4;
    margin-bottom: 0.2rem;
    box-sizing: border-box;
  }

  .file-row:hover {
    background: #1f2937;
    border-color: #374151;
  }

  .muted {
    color: #9ca3af;
    font-size: 0.85rem;
    margin: 0.5rem;
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
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.95rem;
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

  h1 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
