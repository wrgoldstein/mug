<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { open, save } from "@tauri-apps/plugin-dialog";
  import { readTextFile, writeTextFile, stat } from "@tauri-apps/plugin-fs";
  import type { BundledLanguage, BundledTheme } from "shiki";
  import { fileName, detectLanguage } from "$lib/utils/path";
  import FileSidebar from "$lib/components/FileSidebar.svelte";
  import CodeEditor from "$lib/components/CodeEditor.svelte";
  import QuickOpen from "$lib/components/QuickOpen.svelte";

  let content = $state("");
  let currentPath = $state<string | null>(null);
  let isDirty = $state(false);
  let status = $state("Ready");

  let selectedLanguage = $state<BundledLanguage>("ts");
  let selectedTheme = $state<BundledTheme>("github-dark");

  const FONT_SIZE_MIN = 8;
  const FONT_SIZE_MAX = 32;
  const FONT_SIZE_STEP = 1;
  let fontSize = $state(15);

  let showFind = $state(false);
  let showQuickOpen = $state(false);

  let sidebarRef: FileSidebar | null = $state(null);
  let editorRef: CodeEditor | null = $state(null);

  const languageOptions: BundledLanguage[] = ["ts", "js", "python", "svelte", "json", "md", "html", "css", "rust", "bash"];
  const themeOptions: BundledTheme[] = ["github-dark", "github-light", "dracula", "nord"];

  async function openPath(path: string) {
    content = await readTextFile(path);
    currentPath = path;
    selectedLanguage = detectLanguage(path);
    isDirty = false;
    status = `Opened ${fileName(path)}`;
  }

  async function newFile() {
    content = "";
    currentPath = null;
    isDirty = false;
    status = "New file";
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
    sidebarRef?.refreshCurrentDir();
  }

  function onEditorChange(value: string) {
    content = value;
  }

  function onLanguageChange(event: Event) {
    selectedLanguage = (event.target as HTMLSelectElement).value as BundledLanguage;
    status = `Language: ${selectedLanguage}`;
  }

  function onThemeChange(event: Event) {
    selectedTheme = (event.target as HTMLSelectElement).value as BundledTheme;
    status = `Theme: ${selectedTheme}`;
  }

  function openFind() {
    showFind = true;
    // Let the CodeEditor/FindBar handle prefill after mount
    requestAnimationFrame(() => editorRef?.openFindBar());
  }

  function closeFind() {
    showFind = false;
  }

  onMount(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (showQuickOpen) {
          event.preventDefault();
          showQuickOpen = false;
          return;
        }
        if (showFind) {
          event.preventDefault();
          closeFind();
          return;
        }
      }

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
        else sidebarRef?.openDirectory();
      }

      if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        newFile();
      }

      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        const root = sidebarRef?.getRootDir();
        if (root) showQuickOpen = true;
        else status = "Open a folder first";
        return;
      }

      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        openFind();
        return;
      }

      if (event.key.toLowerCase() === "g") {
        event.preventDefault();
        if (showFind) {
          if (event.shiftKey) editorRef?.findPrev();
          else editorRef?.findNext();
        }
        return;
      }

      if (event.key === "=" || event.key === "+") {
        event.preventDefault();
        fontSize = Math.min(FONT_SIZE_MAX, fontSize + FONT_SIZE_STEP);
        status = `Font size: ${fontSize}px`;
      }

      if (event.key === "-") {
        event.preventDefault();
        fontSize = Math.max(FONT_SIZE_MIN, fontSize - FONT_SIZE_STEP);
        status = `Font size: ${fontSize}px`;
      }

      if (event.key === "0") {
        event.preventDefault();
        fontSize = 15;
        status = `Font size: ${fontSize}px (reset)`;
      }
    };

    window.addEventListener("keydown", onKeyDown);

    // Handle CLI args: `edit /path/to/dir` or `edit /path/to/file`
    invoke<string[]>("get_cli_args").then(async (args) => {
      const target = args[1]; // args[0] is the binary path
      if (!target) return;
      try {
        const info = await stat(target);
        if (info.isDirectory) {
          sidebarRef?.openDirectoryPath(target);
        } else if (info.isFile) {
          await openPath(target);
        }
      } catch {
        status = `Could not open: ${target}`;
      }
    });

    return () => window.removeEventListener("keydown", onKeyDown);
  });
</script>

<main>
  <header>
    <h1>{fileName(currentPath)}{isDirty ? " •" : ""}</h1>
    <div class="actions">
      <button onclick={newFile}>New</button>
      <button onclick={openFile}>Open File</button>
      <button onclick={() => sidebarRef?.openDirectory()}>Open Folder</button>
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
    <FileSidebar
      bind:this={sidebarRef}
      onfileopen={openPath}
      onstatus={(msg) => status = msg}
    />

    <CodeEditor
      bind:this={editorRef}
      {content}
      language={selectedLanguage}
      theme={selectedTheme}
      {fontSize}
      bind:isDirty
      {showFind}
      onchange={onEditorChange}
      onclosefind={closeFind}
    />
  </section>

  {#if showQuickOpen}
    {@const root = sidebarRef?.getRootDir()}
    {#if root}
      <QuickOpen
        rootDir={root}
        onselect={(path) => { showQuickOpen = false; openPath(path); }}
        onclose={() => showQuickOpen = false}
      />
    {/if}
  {/if}

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

  h1 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
