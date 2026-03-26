<script lang="ts">
  import { readDir } from "@tauri-apps/plugin-fs";
  import { joinPath, relativePath } from "$lib/utils/path";

  interface Props {
    rootDir: string;
    onselect: (path: string) => void;
    onclose: () => void;
  }

  let { rootDir, onselect, onclose }: Props = $props();

  import { onMount } from "svelte";

  let query = $state("");
  let allFiles = $state<string[]>([]);
  let selectedIdx = $state(0);
  let inputEl = $state<HTMLInputElement | null>(null);
  let indexing = $state(true);

  const IGNORED_DIRS = new Set(["node_modules", "target", "dist", "build", ".git", ".svelte-kit"]);
  const MAX_RESULTS = 50;

  // Fuzzy match: all query chars must appear in order in the candidate
  function fuzzyMatch(query: string, candidate: string): { match: boolean; score: number } {
    const q = query.toLowerCase();
    const c = candidate.toLowerCase();

    let qi = 0;
    let score = 0;
    let prevIdx = -1;

    for (let ci = 0; ci < c.length && qi < q.length; ci++) {
      if (c[ci] === q[qi]) {
        // Bonus for consecutive matches
        if (ci === prevIdx + 1) score += 2;
        // Bonus for matching after separator
        if (ci === 0 || c[ci - 1] === "/" || c[ci - 1] === "-" || c[ci - 1] === "_" || c[ci - 1] === ".") score += 3;
        score += 1;
        prevIdx = ci;
        qi++;
      }
    }

    if (qi < q.length) return { match: false, score: 0 };

    // Bonus for shorter paths (prefer closer matches)
    score -= candidate.length * 0.1;
    // Bonus for matching filename vs deep path
    const name = candidate.split("/").pop() || candidate;
    if (name.toLowerCase().includes(q)) score += 10;

    return { match: true, score };
  }

  let filtered = $derived.by(() => {
    if (!query) return allFiles.slice(0, MAX_RESULTS);

    return allFiles
      .map((f) => ({ path: f, ...fuzzyMatch(query, f) }))
      .filter((r) => r.match)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RESULTS)
      .map((r) => r.path);
  });

  function onInput(event: Event) {
    query = (event.target as HTMLInputElement).value;
    selectedIdx = 0;
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onclose();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      selectedIdx = Math.min(selectedIdx + 1, filtered.length - 1);
      scrollSelectedIntoView();
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      selectedIdx = Math.max(selectedIdx - 1, 0);
      scrollSelectedIntoView();
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      if (filtered.length > 0) {
        const rel = filtered[selectedIdx];
        onselect(joinPath(rootDir, rel));
      }
      return;
    }
  }

  function scrollSelectedIntoView() {
    requestAnimationFrame(() => {
      const el = document.querySelector(".quick-open-item.selected");
      el?.scrollIntoView({ block: "nearest" });
    });
  }

  function selectItem(idx: number) {
    const rel = filtered[idx];
    onselect(joinPath(rootDir, rel));
  }

  const MAX_INDEX = 1000;
  let indexCount = 0;

  async function indexFiles(dirPath: string, prefix: string): Promise<string[]> {
    if (indexCount >= MAX_INDEX) return [];
    const results: string[] = [];
    try {
      const entries = await readDir(dirPath);
      for (const entry of entries) {
        if (indexCount >= MAX_INDEX) break;
        if (entry.name.startsWith(".")) continue;

        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;

        if (entry.isDirectory) {
          if (IGNORED_DIRS.has(entry.name)) continue;
          const sub = await indexFiles(joinPath(dirPath, entry.name), rel);
          results.push(...sub);
        } else {
          results.push(rel);
          indexCount++;
        }
      }
    } catch {
      // permission errors etc
    }
    return results;
  }

  onMount(() => {
    inputEl?.focus();
    indexCount = 0;
    indexFiles(rootDir, "").then((files) => {
      allFiles = files.sort();
      indexing = false;
    });
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="quick-open-overlay" onmousedown={(e) => { if (e.target === e.currentTarget) onclose(); }}>
  <div class="quick-open">
    <input
      bind:this={inputEl}
      type="text"
      value={query}
      oninput={onInput}
      onkeydown={onKeyDown}
      placeholder={indexing ? "Indexing files…" : `Search ${allFiles.length} files…`}
      class="quick-open-input"
    />
    <div class="quick-open-list">
      {#if filtered.length === 0 && query}
        <div class="quick-open-empty">No matches</div>
      {:else}
        {#each filtered as path, i}
          <button
            class="quick-open-item"
            class:selected={i === selectedIdx}
            onmousedown={() => selectItem(i)}
            onmouseenter={() => selectedIdx = i}
          >
            <span class="quick-open-name">{path.split("/").pop()}</span>
            <span class="quick-open-path">{path}</span>
          </button>
        {/each}
      {/if}
    </div>
  </div>
</div>

<style>
  .quick-open-overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: rgba(0, 0, 0, 0.4);
    display: flex;
    justify-content: center;
    padding-top: 15vh;
  }

  .quick-open {
    width: min(600px, 90vw);
    max-height: 60vh;
    background: #1f2937;
    border: 1px solid #374151;
    border-radius: 10px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    align-self: flex-start;
  }

  .quick-open-input {
    width: 100%;
    padding: 0.75rem 1rem;
    border: none;
    border-bottom: 1px solid #374151;
    background: #111827;
    color: #f9fafb;
    font-size: 1rem;
    outline: none;
    box-sizing: border-box;
  }

  .quick-open-input::placeholder {
    color: #6b7280;
  }

  .quick-open-list {
    flex: 1 1 0;
    overflow-y: auto;
    padding: 0.25rem;
  }

  .quick-open-item {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    width: 100%;
    text-align: left;
    padding: 0.45rem 0.75rem;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: #f9fafb;
    cursor: pointer;
    font-size: 0.85rem;
  }

  .quick-open-item:hover,
  .quick-open-item.selected {
    background: #374151;
  }

  .quick-open-name {
    font-weight: 600;
    white-space: nowrap;
  }

  .quick-open-path {
    color: #9ca3af;
    font-size: 0.78rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .quick-open-empty {
    padding: 1rem;
    color: #9ca3af;
    text-align: center;
    font-size: 0.85rem;
  }
</style>
