<script lang="ts">
  import { onMount } from "svelte";
  import type { BundledLanguage } from "shiki";

  interface Props {
    languages: BundledLanguage[];
    current: BundledLanguage;
    onselect: (lang: BundledLanguage) => void;
    onclose: () => void;
  }

  let { languages, current, onselect, onclose }: Props = $props();

  let query = $state("");
  let selectedIndex = $state(0);
  let inputEl: HTMLInputElement;
  let mouseActive = $state(false);

  let filtered = $derived(
    query
      ? languages.filter(l => l.toLowerCase().includes(query.toLowerCase()))
      : languages
  );

  // Pre-select current language
  $effect(() => {
    const idx = filtered.indexOf(current);
    if (idx !== -1 && !query) selectedIndex = idx;
  });

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      onclose();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, filtered.length - 1);
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
      if (filtered[selectedIndex]) {
        onselect(filtered[selectedIndex]);
      }
      return;
    }
  }

  function scrollToSelected() {
    const items = document.querySelectorAll(".mode-item");
    items?.[selectedIndex]?.scrollIntoView({ block: "nearest" });
  }

  onMount(() => {
    requestAnimationFrame(() => inputEl?.focus());
  });
</script>

<div class="overlay" onclick={onclose}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="picker" class:mouse-active={mouseActive} onclick={(e) => e.stopPropagation()} onmousemove={() => mouseActive = true}>
    <input
      bind:this={inputEl}
      class="picker-input"
      type="text"
      placeholder="Select language mode…"
      bind:value={query}
      onkeydown={onKeyDown}
    />
    <div class="picker-list">
      {#each filtered as lang, i (lang)}
        <button
          class="mode-item"
          class:selected={i === selectedIndex}
          class:active={lang === current}
          onclick={() => onselect(lang)}
        >
          {lang}
        </button>
      {/each}
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    justify-content: center;
    padding-top: 15vh;
  }

  .picker {
    width: min(320px, 80vw);
    max-height: 50vh;
    background: #222222;
    border: 1px solid #2a2a2a;
    border-radius: 6px;
    box-shadow: 0 8px 40px rgba(0, 0, 0, 0.6);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    align-self: flex-start;
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
  }

  .picker-input::placeholder {
    color: #5a5650;
  }

  .picker-list {
    overflow-y: auto;
    padding: 0.25rem;
  }

  .mode-item {
    display: block;
    width: 100%;
    text-align: left;
    padding: 0.35rem 0.75rem;
    border: none;
    border-left: 2px solid transparent;
    border-radius: 3px;
    background: transparent;
    color: #a09a92;
    cursor: pointer;
    font-size: 0.82rem;
    font-family: inherit;
    transition: background 0.1s;
  }

  .mode-item.selected {
    background: #2a2a2a;
    border-left-color: #c8956c;
    color: #e0ddd8;
  }

  .picker.mouse-active .mode-item:hover {
    background: #2a2a2a;
    border-left-color: #c8956c;
    color: #e0ddd8;
  }

  .mode-item.active {
    color: #c8956c;
  }
</style>
