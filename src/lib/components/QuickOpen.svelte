<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { joinPath } from "$lib/utils/path";

  interface Props {
    rootDir: string;
    onselect: (path: string) => void;
    onclose: () => void;
  }

  let { rootDir, onselect, onclose }: Props = $props();

  let query = $state("");
  let results = $state<string[]>([]);
  let selectedIdx = $state(0);
  let inputEl = $state<HTMLInputElement | null>(null);
  let mouseActive = $state(false);

  async function search(q: string) {
    try {
      results = await invoke<string[]>("fzf_files", { dir: rootDir, query: q });
    } catch {
      results = [];
    }
    selectedIdx = 0;
  }

  let debounceTimer: number;
  function onInput() {
    clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => search(query), 50);
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
      selectedIdx = Math.min(selectedIdx + 1, results.length - 1);
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
      if (results[selectedIdx]) {
        onselect(joinPath(rootDir, results[selectedIdx]));
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

  onMount(() => {
    inputEl?.focus();
    search("");
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="quick-open-overlay" onmousedown={(e) => { if (e.target === e.currentTarget) onclose(); }}>
  <div class="quick-open" class:mouse-active={mouseActive} onmousemove={() => mouseActive = true}>
    <input
      bind:this={inputEl}
      type="text"
      placeholder="Search files…"
      bind:value={query}
      oninput={onInput}
      onkeydown={onKeyDown}
      class="quick-open-input"
    />
    <div class="quick-open-list">
      {#if results.length === 0 && query}
        <div class="quick-open-empty">No matches</div>
      {:else}
        {#each results as path, i (path)}
          <button
            class="quick-open-item"
            class:selected={i === selectedIdx}
            onmousedown={() => onselect(joinPath(rootDir, path))}
            onmouseenter={() => { if (mouseActive) selectedIdx = i; }}
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
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    justify-content: center;
    padding-top: 15vh;
  }

  .quick-open {
    width: min(560px, 90vw);
    max-height: 60vh;
    background: #222222;
    border: 1px solid #2a2a2a;
    border-radius: 6px;
    box-shadow: 0 8px 40px rgba(0, 0, 0, 0.6);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    align-self: flex-start;
  }

  .quick-open-input {
    width: 100%;
    padding: 0.7rem 1rem;
    border: none;
    border-bottom: 1px solid #2a2a2a;
    background: #1a1a1a;
    color: #e0ddd8;
    font-size: 0.95rem;
    outline: none;
    box-sizing: border-box;
    letter-spacing: 0.01em;
  }

  .quick-open-input::placeholder {
    color: #5a5650;
  }

  .quick-open-list {
    overflow-y: auto;
    padding: 0.25rem;
    max-height: calc(60vh - 3rem);
  }

  .quick-open-item {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    width: 100%;
    text-align: left;
    padding: 0.4rem 0.75rem;
    border: none;
    border-left: 2px solid transparent;
    border-radius: 3px;
    background: transparent;
    color: #e0ddd8;
    cursor: pointer;
    font-size: 0.82rem;
    font-family: inherit;
    transition: background 0.1s;
  }

  .quick-open-item.selected {
    background: #2a2a2a;
    border-left-color: #c8956c;
  }

  .quick-open.mouse-active .quick-open-item:hover {
    background: #2a2a2a;
    border-left-color: #c8956c;
  }

  .quick-open-name {
    font-weight: 500;
    white-space: nowrap;
  }

  .quick-open-path {
    color: #5a5650;
    font-size: 0.76rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .quick-open-empty {
    padding: 1rem;
    color: #5a5650;
    text-align: center;
    font-size: 0.82rem;
  }
</style>
