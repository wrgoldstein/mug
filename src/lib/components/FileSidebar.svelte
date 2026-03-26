<script lang="ts">
  import { open } from "@tauri-apps/plugin-dialog";
  import { readDir } from "@tauri-apps/plugin-fs";
  import { fileName, joinPath, parentPath, relativePath } from "$lib/utils/path";

  interface Props {
    onfileopen: (path: string) => void;
    onstatus: (msg: string) => void;
    hidden?: boolean;
  }

  let { onfileopen, onstatus, hidden = false }: Props = $props();

  type SidebarEntry = {
    path: string;
    name: string;
    isDirectory: boolean;
    isFile: boolean;
  };

  let rootDir = $state<string | null>(null);

  export function getRootDir(): string | null {
    return rootDir;
  }
  let browseDir = $state<string | null>(null);
  let sidebarEntries = $state<SidebarEntry[]>([]);

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

  export async function openDirectoryPath(dirPath: string) {
    rootDir = dirPath;
    try {
      await listDirectory(dirPath);
      onstatus(`Loaded ${sidebarEntries.length} entries`);
    } catch (err) {
      sidebarEntries = [];
      onstatus(`Could not read folder: ${err}`);
    }
  }

  export async function openDirectory() {
    const selected = await open({
      directory: true,
      multiple: false
    });

    if (!selected || Array.isArray(selected)) return;

    rootDir = selected;
    try {
      await listDirectory(selected);
      onstatus(`Loaded ${sidebarEntries.length} entries`);
    } catch (err) {
      sidebarEntries = [];
      onstatus(`Could not read folder: ${err}`);
    }
  }

  export async function refreshCurrentDir() {
    if (browseDir) {
      try {
        await listDirectory(browseDir);
      } catch {
        // ignore refresh failures
      }
    }
  }

  async function openSidebarEntry(entry: SidebarEntry) {
    if (entry.isDirectory) {
      try {
        await listDirectory(entry.path);
        onstatus(`Browsing ${entry.name}`);
      } catch (err) {
        onstatus(`Could not open folder: ${err}`);
      }
      return;
    }

    onfileopen(entry.path);
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
</script>

<aside class="sidebar" class:hidden>
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

<style>
  .sidebar {
    border-right: 1px solid #2a2a2a;
    background: #1e1e1e;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .sidebar.hidden {
    display: none;
  }

  .sidebar-title {
    padding: 0.6rem 0.75rem;
    font-size: 0.78rem;
    font-weight: 400;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #706b63;
    border-bottom: 1px solid #2a2a2a;
  }

  .sidebar-nav {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.4rem;
    border-bottom: 1px solid #2a2a2a;
  }

  .sidebar-nav span {
    font-size: 0.73rem;
    color: #5a5650;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-list {
    flex: 1 1 0;
    min-height: 0;
    overflow-y: auto;
    padding: 0.35rem;
  }

  .file-row {
    display: block;
    width: 100%;
    text-align: left;
    font-size: 0.8rem;
    background: transparent;
    border-color: transparent;
    color: #8a8580;
    white-space: nowrap;
    text-overflow: ellipsis;
    overflow: hidden;
    padding: 0.3rem 0.5rem;
    line-height: 1.4;
    margin-bottom: 0.1rem;
    box-sizing: border-box;
    border-radius: 3px;
    transition: color 0.15s, background 0.15s;
  }

  .file-row:hover {
    background: #252525;
    color: #e0ddd8;
    border-color: transparent;
    border-left: 2px solid #c8956c;
    padding-left: calc(0.5rem - 2px);
  }

  .muted {
    color: #5a5650;
    font-size: 0.8rem;
    margin: 0.5rem;
  }

  button {
    border: 1px solid transparent;
    background: transparent;
    color: #8a8580;
    border-radius: 4px;
    padding: 0.3rem 0.6rem;
    cursor: pointer;
    font-size: 0.8rem;
    transition: color 0.15s, background 0.15s;
  }

  button:hover {
    color: #e0ddd8;
    background: #2a2a2a;
  }

  button:disabled {
    opacity: 0.35;
    cursor: default;
  }
</style>
