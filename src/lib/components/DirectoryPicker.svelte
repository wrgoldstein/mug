<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";

  interface Props {
    onselect: (path: string) => void;
    onclose: () => void;
  }

  let { onselect, onclose }: Props = $props();

  let query = $state("");
  let results = $state<string[]>([]);
  let selectedIndex = $state(0);
  let inputEl: HTMLInputElement;
  let listEl: HTMLDivElement;
  let mouseActive = $state(false);
  let loading = $state(false);
  let pickedPath = $state<string | null>(null);

  function shortDisplay(path: string): { name: string; parent: string } {
    const parts = path.replace(/\/+$/, "").split("/");
    const name = parts.pop() || path;
    const parent = parts.slice(-2).join("/");
    return { name, parent };
  }

  async function search(q: string) {
    try {
      results = await invoke<string[]>("zoxide_query", { q });
    } catch {
      results = [];
    }
    selectedIndex = 0;
  }

  let debounceTimer: number;
  function onInput() {
    clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => search(query), 80);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      onclose();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, results.length - 1);
      scrollToSelected();
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
      scrollToSelected();
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      if (results[selectedIndex]) {
        pick(results[selectedIndex]);
      }
      return;
    }
  }

  function pick(path: string) {
    pickedPath = path;
    loading = true;
    setTimeout(() => onselect(path), 400);
  }

  function scrollToSelected() {
    const items = listEl?.querySelectorAll(".picker-item");
    items?.[selectedIndex]?.scrollIntoView({ block: "nearest" });
  }

  onMount(() => {
    search("");
    requestAnimationFrame(() => inputEl?.focus());
  });
</script>

<div class="picker-overlay" onclick={onclose}>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="picker" class:mouse-active={mouseActive} class:loading onclick={(e) => e.stopPropagation()} onmousemove={() => mouseActive = true}>
    <input
      bind:this={inputEl}
      class="picker-input"
      type="text"
      placeholder="Jump to a project…"
      bind:value={query}
      oninput={onInput}
      onkeydown={onKeyDown}
    />
    <div class="picker-list" bind:this={listEl}>
      {#if results.length === 0}
        <div class="picker-empty">No directories found</div>
      {:else}
        {#each results as path, i (path)}
          {@const display = shortDisplay(path)}
          <button
            class="picker-item"
            class:selected={i === selectedIndex}
            class:picked={path === pickedPath}
            onclick={() => pick(path)}
          >
            <span class="picker-name">{display.name}</span>
            <span class="picker-path">{display.parent}</span>
          </button>
        {/each}
      {/if}
    </div>
  </div>
</div>

<style>
  .picker-overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    justify-content: center;
    padding-top: 12vh;
  }

  .picker {
    width: min(560px, 90vw);
    max-height: 65vh;
    background: #222222;
    border: 1px solid #2a2a2a;
    border-radius: 6px;
    box-shadow: 0 8px 40px rgba(0, 0, 0, 0.6);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    align-self: flex-start;
    position: relative;
    transition: opacity 0.2s, transform 0.2s;
  }

  .picker-input {
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

  .picker-input::placeholder {
    color: #5a5650;
  }

  .picker-list {
    overflow-y: auto;
    padding: 0.25rem;
    max-height: calc(65vh - 3.5rem);
  }

  .picker-item {
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

  .picker-item.selected {
    background: #2a2a2a;
    border-left-color: #c8956c;
  }

  .picker.mouse-active .picker-item:hover {
    background: #2a2a2a;
    border-left-color: #c8956c;
  }

  .picker-name {
    font-weight: 500;
    white-space: nowrap;
  }

  .picker-path {
    color: #5a5650;
    font-size: 0.76rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .picker-item.picked {
    background: linear-gradient(90deg, #c8956c40 0%, #c8956c40 100%);
    background-size: 0% 100%;
    background-repeat: no-repeat;
    animation: fill-across 400ms ease-out forwards;
    border-left-color: #c8956c;
    color: #e0ddd8;
  }

  @keyframes fill-across {
    from { background-size: 0% 100%; }
    to { background-size: 100% 100%; }
  }

  .picker.loading {
    pointer-events: none;
  }

  .picker-empty {
    padding: 1rem;
    color: #5a5650;
    text-align: center;
    font-size: 0.82rem;
  }
</style>
