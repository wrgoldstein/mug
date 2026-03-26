<script lang="ts">
  import { fileName } from "$lib/utils/path";

  interface Tab {
    id: string;
    path: string | null;
    isDirty: boolean;
  }

  interface Props {
    tabs: Tab[];
    activeTabId: string | null;
    onselect: (id: string) => void;
    onclose: (id: string) => void;
  }

  let { tabs, activeTabId, onselect, onclose }: Props = $props();
</script>

<div class="tab-bar" role="tablist">
  {#each tabs as tab (tab.id)}
    <div
      class="tab"
      class:active={tab.id === activeTabId}
      role="tab"
      tabindex="0"
      aria-selected={tab.id === activeTabId}
      onclick={() => onselect(tab.id)}
      onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') onselect(tab.id); }}
      title={tab.path ?? "Untitled"}
    >
      <span class="tab-name">{fileName(tab.path)}{tab.isDirty ? " •" : ""}</span>
      <button
        class="tab-close"
        type="button"
        tabindex="-1"
        onclick={(e: MouseEvent) => { e.stopPropagation(); onclose(tab.id); }}
        title="Close"
      >×</button>
    </div>
  {/each}
</div>

<style>
  .tab-bar {
    display: flex;
    background: #1e1e1e;
    border-bottom: 1px solid #2a2a2a;
    overflow-x: auto;
    scrollbar-width: none;
    min-height: 30px;
  }

  .tab-bar::-webkit-scrollbar {
    display: none;
  }

  .tab {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.3rem 0.75rem;
    border: none;
    border-right: 1px solid #2a2a2a;
    background: transparent;
    color: #706b63;
    font-size: 0.78rem;
    font-family: inherit;
    cursor: pointer;
    white-space: nowrap;
    min-width: 0;
    max-width: 180px;
    flex-shrink: 0;
    transition: color 0.15s;
    letter-spacing: 0.01em;
  }

  .tab:hover {
    color: #a09a92;
  }

  .tab.active {
    background: #1a1a1a;
    color: #e0ddd8;
    box-shadow: inset 0 -2px 0 #c8956c;
  }

  .tab-name {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tab-close {
    font-size: 0.85rem;
    line-height: 1;
    opacity: 0;
    padding: 0 0.15rem;
    border: none;
    background: transparent;
    color: inherit;
    cursor: pointer;
    border-radius: 2px;
    transition: opacity 0.15s;
  }

  .tab:hover .tab-close {
    opacity: 0.5;
  }

  .tab-close:hover {
    opacity: 1;
    background: #333;
  }
</style>
