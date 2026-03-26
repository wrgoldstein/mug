<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { open, save } from "@tauri-apps/plugin-dialog";
  import { readTextFile, writeTextFile, stat } from "@tauri-apps/plugin-fs";
  import type { BundledLanguage, BundledTheme } from "shiki";
  import { fileName, detectLanguage, relativePath, shortPath } from "$lib/utils/path";
  import FileSidebar from "$lib/components/FileSidebar.svelte";
  import CodeEditor from "$lib/components/CodeEditor.svelte";
  import QuickOpen from "$lib/components/QuickOpen.svelte";
  import TabBar from "$lib/components/TabBar.svelte";
  import WelcomeScreen from "$lib/components/WelcomeScreen.svelte";
  import DirectoryPicker from "$lib/components/DirectoryPicker.svelte";

  // ── Tab model ──────────────────────────────────────────────
  interface Tab {
    id: string;
    path: string | null;
    content: string;
    isDirty: boolean;
    language: BundledLanguage;
    scroll: { scrollTop: number; scrollLeft: number };
    cursor: { selectionStart: number; selectionEnd: number };
  }

  function createTab(path: string | null, content: string, language?: BundledLanguage): Tab {
    return {
      id: crypto.randomUUID(),
      path,
      content,
      isDirty: false,
      language: language ?? (path ? detectLanguage(path) : "ts"),
      scroll: { scrollTop: 0, scrollLeft: 0 },
      cursor: { selectionStart: 0, selectionEnd: 0 },
    };
  }

  let tabs = $state<Tab[]>([]);
  let activeTabId = $state<string | null>(null);
  let activeTab = $derived(tabs.find(t => t.id === activeTabId) ?? null);
  let showWelcome = $derived(tabs.length === 0);

  // ── Global state ───────────────────────────────────────────
  let selectedTheme = $state<BundledTheme>("nord");
  let status = $state("Ready");

  const FONT_SIZE_MIN = 8;
  const FONT_SIZE_MAX = 32;
  const FONT_SIZE_STEP = 1;
  let fontSize = $state(15);

  let showFind = $state(false);
  let showQuickOpen = $state(false);
  let showSidebar = $state(false);

  let sidebarRef: FileSidebar | null = $state(null);
  let editorRef: CodeEditor | null = $state(null);

  const SIDEBAR_MIN = 140;
  const SIDEBAR_MAX = 500;
  let sidebarWidth = $state(260);
  let draggingSidebar = $state(false);

  function onDragStart(e: MouseEvent) {
    e.preventDefault();
    draggingSidebar = true;
    const onMove = (e: MouseEvent) => {
      sidebarWidth = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, e.clientX));
    };
    const onUp = () => {
      draggingSidebar = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const languageOptions: BundledLanguage[] = ["ts", "js", "python", "ruby", "go", "rust", "svelte", "json", "yaml", "toml", "sql", "md", "html", "css", "bash", "plaintext"];
  const themeOptions: BundledTheme[] = ["github-dark", "github-light", "dracula", "nord"];

  // ── Tab helpers ────────────────────────────────────────────
  function snapshotActiveTab() {
    if (!editorRef || !activeTab) return;
    activeTab.scroll = editorRef.getScrollPos();
    activeTab.cursor = editorRef.getCursorPos();
  }

  function switchToTab(id: string) {
    if (id === activeTabId) return;
    snapshotActiveTab();
    activeTabId = id;
    const tab = tabs.find(t => t.id === id);
    if (tab) {
      status = `Switched to ${fileName(tab.path)}`;
      // Restore after the editor re-renders with new content
      requestAnimationFrame(() => {
        editorRef?.restoreState(tab.scroll, tab.cursor);
      });
    }
  }

  function closeTab(id: string) {
    const idx = tabs.findIndex(t => t.id === id);
    if (idx === -1) return;

    const tab = tabs[idx];
    if (tab.isDirty) {
      // Simple confirm for now — TODO: nicer dialog
      if (!confirm(`"${fileName(tab.path)}" has unsaved changes. Close anyway?`)) return;
    }

    tabs.splice(idx, 1);

    if (tabs.length === 0) {
      activeTabId = null;
    } else if (id === activeTabId) {
      // Activate neighbor
      const newIdx = Math.min(idx, tabs.length - 1);
      activeTabId = tabs[newIdx].id;
      const tab = tabs[newIdx];
      requestAnimationFrame(() => {
        editorRef?.restoreState(tab.scroll, tab.cursor);
      });
    }
    // Trigger reactivity
    tabs = tabs;
  }

  function switchTabRelative(delta: number) {
    if (tabs.length <= 1) return;
    const idx = tabs.findIndex(t => t.id === activeTabId);
    const newIdx = (idx + delta + tabs.length) % tabs.length;
    switchToTab(tabs[newIdx].id);
  }

  // ── File operations (now tab-aware) ────────────────────────
  async function openPath(path: string) {
    // If already open, switch to it
    const existing = tabs.find(t => t.path === path);
    if (existing) {
      switchToTab(existing.id);
      return;
    }

    snapshotActiveTab();
    const content = await readTextFile(path);
    const tab = createTab(path, content);
    tabs.push(tab);
    tabs = tabs; // trigger reactivity
    activeTabId = tab.id;
    status = `Opened ${fileName(path)}`;
  }

  function newFile() {
    snapshotActiveTab();
    const tab = createTab(null, "");
    tabs.push(tab);
    tabs = tabs;
    activeTabId = tab.id;
    status = "New file";
  }

  async function saveFile() {
    if (!activeTab) return;
    if (activeTab.path) {
      await writeTextFile(activeTab.path, activeTab.content);
      activeTab.isDirty = false;
      tabs = tabs;
      status = `Saved ${fileName(activeTab.path)}`;
      sidebarRef?.refreshCurrentDir();
      return;
    }
    await saveAsFile();
  }

  async function saveAsFile() {
    if (!activeTab) return;
    const selected = await save({
      filters: [{ name: "Text", extensions: ["txt", "md"] }],
      defaultPath: activeTab.path ?? "untitled.txt"
    });
    if (!selected) return;

    await writeTextFile(selected, activeTab.content);
    activeTab.path = selected;
    activeTab.language = detectLanguage(selected);
    activeTab.isDirty = false;
    tabs = tabs;
    status = `Saved ${fileName(selected)}`;
    sidebarRef?.refreshCurrentDir();
  }

  async function openFile() {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Text", extensions: ["txt", "md", "json", "js", "ts", "py", "svelte", "css", "html", "rs", "sh"] }]
    });
    if (!selected || Array.isArray(selected)) return;
    await openPath(selected);
  }

  // ── Editor callbacks ───────────────────────────────────────
  function onEditorChange(value: string) {
    if (!activeTab) return;
    activeTab.content = value;
  }

  // Bind isDirty from CodeEditor back to active tab
  let editorIsDirty = $state(false);
  $effect(() => {
    if (activeTab && editorIsDirty !== activeTab.isDirty) {
      activeTab.isDirty = editorIsDirty;
      tabs = tabs;
    }
  });
  // Push active tab's isDirty to the editor binding
  $effect(() => {
    if (activeTab) {
      editorIsDirty = activeTab.isDirty;
    }
  });

  let showModePicker = $state(false);
  let showDirPicker = $state(false);

  async function openDirectoryFromPicker(path: string) {
    showDirPicker = false;
    await sidebarRef?.openDirectoryPath(path);
    showSidebar = true;
    fetchGitBranch();
  }
  let modePickerType = $state<"language" | "theme">("language");

  let gitBranch = $state<string | null>(null);

  async function fetchGitBranch() {
    const root = sidebarRef?.getRootDir();
    if (!root) { gitBranch = null; return; }
    try {
      gitBranch = await invoke<string | null>("get_git_branch", { path: root });
    } catch {
      gitBranch = null;
    }
  }

  function openFind() {
    showFind = true;
    requestAnimationFrame(() => editorRef?.openFindBar());
  }

  function closeFind() {
    showFind = false;
  }

  // ── Keyboard shortcuts ─────────────────────────────────────
  onMount(() => {
    const onKeyDown = async (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (showDirPicker) {
          event.preventDefault();
          showDirPicker = false;
          return;
        }
        if (showModePicker) {
          event.preventDefault();
          showModePicker = false;
          return;
        }
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
        else {
          showDirPicker = true;
        }
      }

      if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        newFile();
      }

      if (event.key.toLowerCase() === "w") {
        event.preventDefault();
        if (activeTabId) closeTab(activeTabId);
      }

      if (event.key.toLowerCase() === "b") {
        event.preventDefault();
        showSidebar = !showSidebar;
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

      // Tab switching: Cmd+Shift+[ / Cmd+Shift+]
      if (event.key === "[" && event.shiftKey) {
        event.preventDefault();
        switchTabRelative(-1);
        return;
      }
      if (event.key === "]" && event.shiftKey) {
        event.preventDefault();
        switchTabRelative(1);
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

    // Handle CLI args
    invoke<string[]>("get_cli_args").then(async (args) => {
      const target = args[1];
      if (!target) return;
      try {
        const info = await stat(target);
        if (info.isDirectory) {
          await sidebarRef?.openDirectoryPath(target);
          showSidebar = true;
          fetchGitBranch();
        } else if (info.isFile) {
          await openPath(target);
          fetchGitBranch();
        }
      } catch {
        status = `Could not open: ${target}`;
      }
    });

    return () => window.removeEventListener("keydown", onKeyDown);
  });
</script>

<main>


  <TabBar
    {tabs}
    {activeTabId}
    onselect={switchToTab}
    onclose={closeTab}
  />

  <section
    class="workspace"
    class:sidebar-hidden={!showSidebar}
    class:dragging={draggingSidebar}
    style={showSidebar ? `grid-template-columns: ${sidebarWidth}px 4px 1fr` : undefined}
  >
    <FileSidebar
      bind:this={sidebarRef}
      onfileopen={openPath}
      onstatus={(msg: string) => status = msg}
      hidden={!showSidebar}
    />

    {#if showSidebar}
      <div class="resize-handle" onmousedown={onDragStart}></div>
    {/if}

    {#if showWelcome}
      <WelcomeScreen />
    {:else if activeTab}
      {#key activeTabId}
        <CodeEditor
          bind:this={editorRef}
          content={activeTab.content}
          language={activeTab.language}
          theme={selectedTheme}
          {fontSize}
          bind:isDirty={editorIsDirty}
          {showFind}
          onchange={onEditorChange}
          onclosefind={closeFind}
        />
      {/key}
    {/if}
  </section>

  {#if showDirPicker}
    <DirectoryPicker
      onselect={openDirectoryFromPicker}
      onclose={() => showDirPicker = false}
    />
  {/if}

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
    <span class="footer-left">
      {#if sidebarRef?.getRootDir()}
        <span class="footer-root">{fileName(sidebarRef.getRootDir())}</span>
      {/if}
      {#if gitBranch}
        <span class="footer-branch"><span class="branch-icon">⎇</span> {gitBranch}</span>
      {/if}
    </span>
    <span class="footer-right">
      <span class="footer-lang">{activeTab?.language ?? ""}</span>
      <span>{activeTab?.path ? shortPath(relativePath(activeTab.path, sidebarRef?.getRootDir() ?? null)) : ""}</span>
    </span>
  </footer>
</main>

<style>
  :global(body) {
    margin: 0;
    font-family: "SF Pro Text", "Helvetica Neue", system-ui, -apple-system, sans-serif;
    background: #1a1a1a;
    color: #e0ddd8;
  }

  main {
    height: 100vh;
    display: grid;
    grid-template-rows: auto 1fr auto;
  }

  footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.4rem 1rem;
    background: #222222;
    border-top: 1px solid #2a2a2a;
    font-size: 0.8rem;
    color: #706b63;
  }

  .workspace {
    display: grid;
    grid-template-columns: 260px 4px 1fr;
    min-height: 0;
  }

  .workspace.sidebar-hidden {
    grid-template-columns: 1fr;
  }

  .workspace.dragging {
    cursor: col-resize;
    user-select: none;
  }

  .resize-handle {
    background: transparent;
    cursor: col-resize;
    transition: background 0.15s;
  }

  .resize-handle:hover,
  .workspace.dragging .resize-handle {
    background: #c8956c;
  }

  h1 {
    margin: 0;
    font-size: 0.85rem;
    font-weight: 400;
    letter-spacing: 0.02em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: #a09a92;
  }

  .dirty-dot {
    color: #c8956c;
  }

  .footer-left {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .footer-root {
    color: #a09a92;
  }

  .footer-branch {
    color: #706b63;
  }

  .branch-icon {
    color: #c8956c;
  }

  .footer-right {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .footer-lang {
    color: #c8956c;
    letter-spacing: 0.02em;
  }
</style>
