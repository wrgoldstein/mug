<script lang="ts">
  interface Props {
    content: string;
    textareaEl: HTMLTextAreaElement | null;
    syncScroll: () => void;
    onclose: () => void;
  }

  let { content, textareaEl, syncScroll, onclose }: Props = $props();

  let findQuery = $state("");
  let findCaseSensitive = $state(false);
  let findMatches = $state<{ start: number; end: number }[]>([]);
  let findCurrentIdx = $state(-1);
  let findInputEl = $state<HTMLInputElement | null>(null);

  export function prefillFromSelection() {
    if (textareaEl) {
      const sel = content.slice(textareaEl.selectionStart, textareaEl.selectionEnd);
      if (sel && !sel.includes("\n")) findQuery = sel;
    }
    computeMatches();
    requestAnimationFrame(() => findInputEl?.focus());
  }

  export function focusInput() {
    requestAnimationFrame(() => findInputEl?.focus());
  }

  export function nextMatch() {
    findNext();
  }

  export function prevMatch() {
    findPrev();
  }

  function computeMatches() {
    if (!findQuery) {
      findMatches = [];
      findCurrentIdx = -1;
      return;
    }
    const src = findCaseSensitive ? content : content.toLowerCase();
    const q = findCaseSensitive ? findQuery : findQuery.toLowerCase();
    const results: { start: number; end: number }[] = [];
    let pos = 0;
    while (pos <= src.length - q.length) {
      const idx = src.indexOf(q, pos);
      if (idx === -1) break;
      results.push({ start: idx, end: idx + q.length });
      pos = idx + 1;
    }
    findMatches = results;
    if (results.length === 0) {
      findCurrentIdx = -1;
    } else if (findCurrentIdx < 0 || findCurrentIdx >= results.length) {
      findCurrentIdx = 0;
    }
  }

  function selectMatch(idx: number, focusTextarea = true) {
    if (!textareaEl || idx < 0 || idx >= findMatches.length) return;
    const m = findMatches[idx];
    textareaEl.setSelectionRange(m.start, m.end);

    const before = content.slice(0, m.start);
    const line = before.split("\n").length - 1;
    const lineHeight = textareaEl.scrollHeight / (content.split("\n").length || 1);
    const targetTop = line * lineHeight - textareaEl.clientHeight / 3;
    textareaEl.scrollTop = Math.max(0, targetTop);
    syncScroll();

    if (focusTextarea) textareaEl.focus();
  }

  function findNext() {
    if (findMatches.length === 0) return;
    findCurrentIdx = (findCurrentIdx + 1) % findMatches.length;
    selectMatch(findCurrentIdx);
  }

  function findPrev() {
    if (findMatches.length === 0) return;
    findCurrentIdx = (findCurrentIdx - 1 + findMatches.length) % findMatches.length;
    selectMatch(findCurrentIdx);
  }

  function onFindInput(event: Event) {
    findQuery = (event.target as HTMLInputElement).value;
    computeMatches();
    if (findMatches.length > 0) {
      const cursor = textareaEl?.selectionStart ?? 0;
      let nearest = 0;
      for (let i = 0; i < findMatches.length; i++) {
        if (findMatches[i].start >= cursor) { nearest = i; break; }
        nearest = i;
      }
      findCurrentIdx = nearest;
      selectMatch(findCurrentIdx, false);
    }
  }

  function onFindKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      onclose();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) findPrev();
      else findNext();
    }
  }

  function toggleCaseSensitive() {
    findCaseSensitive = !findCaseSensitive;
    computeMatches();
    if (findMatches.length > 0) selectMatch(findCurrentIdx, false);
    findInputEl?.focus();
  }
</script>

<div class="find-bar">
  <input
    bind:this={findInputEl}
    type="text"
    value={findQuery}
    oninput={onFindInput}
    onkeydown={onFindKeyDown}
    placeholder="Find…"
    class="find-input"
  />
  <button
    class="find-case-btn"
    class:active={findCaseSensitive}
    onclick={toggleCaseSensitive}
    title="Match case"
  >Aa</button>
  <button onclick={findPrev} disabled={findMatches.length === 0} title="Previous (Shift+Enter)">▲</button>
  <button onclick={findNext} disabled={findMatches.length === 0} title="Next (Enter)">▼</button>
  <span class="find-count">
    {#if findQuery}
      {findMatches.length === 0 ? "No results" : `${findCurrentIdx + 1} of ${findMatches.length}`}
    {/if}
  </span>
  <button onclick={onclose} title="Close (Esc)">✕</button>
</div>

<style>
  .find-bar {
    position: absolute;
    top: 0;
    right: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.4rem 0.6rem;
    background: #1f2937;
    border: 1px solid #374151;
    border-top: none;
    border-radius: 0 0 8px 8px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }

  .find-input {
    width: 220px;
    padding: 0.3rem 0.5rem;
    border: 1px solid #4b5563;
    border-radius: 4px;
    background: #111827;
    color: #f9fafb;
    font-size: 0.85rem;
    outline: none;
  }

  .find-input:focus {
    border-color: #3b82f6;
  }

  .find-count {
    font-size: 0.78rem;
    color: #9ca3af;
    min-width: 70px;
    text-align: center;
  }

  button {
    border: 1px solid #4b5563;
    background: #374151;
    color: #f9fafb;
    border-radius: 4px;
    padding: 0.2rem 0.5rem;
    font-size: 0.78rem;
    cursor: pointer;
  }

  button:hover {
    background: #4b5563;
  }

  button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .find-case-btn {
    font-weight: 600;
    opacity: 0.5;
  }

  .find-case-btn.active {
    opacity: 1;
    background: #3b82f6;
    border-color: #3b82f6;
  }
</style>
