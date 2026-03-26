<script lang="ts">
  import { onMount } from "svelte";
  import { open } from "@tauri-apps/plugin-dialog";
  import { readDir } from "@tauri-apps/plugin-fs";
  import { invoke } from "@tauri-apps/api/core";
  import { fileName, joinPath } from "$lib/utils/path";

  interface Props {
    onfileopen: (path: string) => void;
    onstatus: (msg: string) => void;
    hidden?: boolean;
  }

  let { onfileopen, onstatus, hidden = false }: Props = $props();

  // ── Tree model ─────────────────────────────────────────────
  interface TreeNode {
    path: string;
    name: string;
    isDirectory: boolean;
    children: TreeNode[] | null; // null = not loaded
    expanded: boolean;
  }

  interface FlatRow {
    node: TreeNode;
    depth: number;
  }

  const HIDDEN_DIRS = new Set(["node_modules", "target", "dist", "build", ".svelte-kit"]);

  let rootDir = $state<string | null>(null);
  let rootNode = $state<TreeNode | null>(null);
  let flatRows = $state<FlatRow[]>([]);

  // ── Git status ─────────────────────────────────────────────
  // Maps relative file path → status code (M, A, D, ??, etc.)
  let gitStatus = $state<Map<string, string>>(new Map());

  async function fetchGitStatus() {
    if (!rootDir) { gitStatus = new Map(); return; }
    try {
      const entries = await invoke<[string, string][]>("get_git_status", { path: rootDir });
      const map = new Map<string, string>();
      for (const [file, status] of entries) {
        map.set(file, status);
      }
      gitStatus = map;
    } catch {
      gitStatus = new Map();
    }
  }

  function getFileStatus(path: string): string | null {
    if (!rootDir || !path.startsWith(rootDir)) return null;
    const rel = path.slice(rootDir.length).replace(/^[/\\]/, "");
    return gitStatus.get(rel) ?? null;
  }

  function getDirStatus(path: string): string | null {
    if (!rootDir || !path.startsWith(rootDir)) return null;
    const rel = path.slice(rootDir.length).replace(/^[/\\]/, "") + "/";
    for (const [file] of gitStatus) {
      if (file.startsWith(rel)) return "M"; // dir contains changes
    }
    return null;
  }

  // ── Public API (unchanged) ─────────────────────────────────
  export function getRootDir(): string | null {
    return rootDir;
  }

  export async function openDirectory() {
    const selected = await open({ directory: true, multiple: false });
    if (!selected || Array.isArray(selected)) return;
    await loadRoot(selected);
  }

  export async function openDirectoryPath(dirPath: string) {
    await loadRoot(dirPath);
  }

  export async function refreshCurrentDir() {
    if (!rootNode) return;
    await refreshNode(rootNode);
    rebuildFlat();
    fetchGitStatus();
  }

  // ── Tree operations ────────────────────────────────────────
  async function loadChildren(node: TreeNode): Promise<TreeNode[]> {
    const entries = await readDir(node.path);
    const filtered = entries.filter((e) => {
      if (e.name.startsWith(".")) return false;
      if (e.isDirectory && HIDDEN_DIRS.has(e.name)) return false;
      return true;
    });

    filtered.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });

    return filtered.map((e) => ({
      path: joinPath(node.path, e.name),
      name: e.name,
      isDirectory: e.isDirectory,
      children: null,
      expanded: false,
    }));
  }

  async function loadRoot(dirPath: string) {
    rootDir = dirPath;
    const node: TreeNode = {
      path: dirPath,
      name: fileName(dirPath),
      isDirectory: true,
      children: null,
      expanded: true,
    };

    try {
      node.children = await loadChildren(node);
      rootNode = node;
      rebuildFlat();
      onstatus(`Loaded ${node.children.length} entries`);
      fetchGitStatus();
    } catch (err) {
      rootNode = null;
      flatRows = [];
      onstatus(`Could not read folder: ${err}`);
    }
  }

  async function refreshNode(node: TreeNode) {
    if (!node.isDirectory || !node.expanded || node.children === null) return;
    try {
      const freshChildren = await loadChildren(node);
      // Preserve expanded state for directories that still exist
      const oldByPath = new Map(node.children.map(c => [c.path, c]));
      for (const child of freshChildren) {
        const old = oldByPath.get(child.path);
        if (old && old.isDirectory && old.expanded && old.children) {
          child.expanded = true;
          child.children = old.children;
          await refreshNode(child);
        }
      }
      node.children = freshChildren;
    } catch {
      // keep existing children on error
    }
  }

  async function toggleExpand(node: TreeNode) {
    if (!node.isDirectory) return;

    if (node.expanded) {
      node.expanded = false;
      rebuildFlat();
      return;
    }

    if (node.children === null) {
      try {
        node.children = await loadChildren(node);
      } catch (err) {
        onstatus(`Could not read: ${node.name}`);
        return;
      }
    }

    node.expanded = true;
    rebuildFlat();
  }

  function handleClick(node: TreeNode) {
    if (node.isDirectory) {
      toggleExpand(node);
    } else {
      onfileopen(node.path);
    }
  }

  // ── Flatten tree for rendering ─────────────────────────────
  function rebuildFlat() {
    const rows: FlatRow[] = [];

    function walk(nodes: TreeNode[], depth: number) {
      for (const node of nodes) {
        rows.push({ node, depth });
        if (node.isDirectory && node.expanded && node.children) {
          walk(node.children, depth + 1);
        }
      }
    }

    if (rootNode?.children) {
      walk(rootNode.children, 0);
    }

    flatRows = rows;
  }

  // Poll for filesystem changes every 5s when focused
  onMount(() => {
    const interval = setInterval(() => {
      if (document.hasFocus() && rootNode) {
        refreshCurrentDir();
      }
    }, 5000);
    return () => clearInterval(interval);
  });
</script>

<aside class="sidebar" class:hidden>
  <div class="sidebar-title">{rootDir ? fileName(rootDir) : "No folder open"}</div>

  <div class="file-list">
    {#if !rootDir}
      <p class="muted">Open a folder to browse files.</p>
    {:else if flatRows.length === 0}
      <p class="muted">This folder is empty.</p>
    {:else}
      {#each flatRows as row (row.node.path)}
        {@const status = row.node.isDirectory ? getDirStatus(row.node.path) : getFileStatus(row.node.path)}
        <button
          class="tree-row"
          class:git-modified={status === "M"}
          class:git-added={status === "A" || status === "??"}
          class:git-deleted={status === "D"}
          style="padding-left: {0.5 + row.depth * 0.9}rem"
          onclick={() => handleClick(row.node)}
          title={row.node.path}
        >
          {#if row.node.isDirectory}
            <span class="chevron">{row.node.expanded ? "▾" : "▸"}</span>
          {:else}
            <span class="chevron-spacer"></span>
          {/if}
          <span class="row-name" class:is-dir={row.node.isDirectory}>{row.node.name}</span>
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

  .file-list {
    flex: 1 1 0;
    min-height: 0;
    overflow-y: auto;
    padding: 0.25rem 0;
  }

  .tree-row {
    display: flex;
    align-items: center;
    width: 100%;
    text-align: left;
    font-size: 0.8rem;
    background: transparent;
    border: none;
    border-left: 2px solid transparent;
    color: #8a8580;
    white-space: nowrap;
    overflow: hidden;
    padding-top: 0.2rem;
    padding-bottom: 0.2rem;
    padding-right: 0.5rem;
    line-height: 1.45;
    box-sizing: border-box;
    cursor: pointer;
    transition: color 0.12s, background 0.12s;
    font-family: inherit;
  }

  .tree-row:hover {
    background: #252525;
    color: #e0ddd8;
    border-left-color: #c8956c;
  }

  .chevron {
    flex-shrink: 0;
    width: 0.9rem;
    font-size: 0.65rem;
    color: #5a5650;
    text-align: center;
  }

  .chevron-spacer {
    flex-shrink: 0;
    width: 0.9rem;
  }

  .row-name {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .row-name.is-dir {
    color: #a09a92;
  }

  .git-modified .row-name {
    color: #c8956c;
  }

  .git-added .row-name {
    color: #7d9e7a;
  }

  .git-deleted .row-name {
    color: #9e6a6a;
    text-decoration: line-through;
    text-decoration-color: #9e6a6a40;
  }

  .muted {
    color: #5a5650;
    font-size: 0.8rem;
    margin: 0.75rem;
  }
</style>
