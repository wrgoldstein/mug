<script lang="ts">
  import { fileName } from "$lib/utils/path";

  interface Tab {
    id: string;
    path: string | null;
    isDirty: boolean;
    externalModified?: boolean;
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
      class:external-modified={!!tab.externalModified}
      role="tab"
      tabindex="0"
      aria-selected={tab.id === activeTabId}
      onclick={() => onselect(tab.id)}
      onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') onselect(tab.id); }}
      title={tab.externalModified ? `${tab.path ?? "Untitled"} (changed on disk)` : (tab.path ?? "Untitled")}
    >
      <span class="tab-name">
        {fileName(tab.path)}{tab.isDirty ? " •" : ""}{tab.externalModified ? " ⟳" : ""}
      </span>
      <button
        class="tab-close"
        type="button"
        tabindex="-1"
        onclick={(e: MouseEvent) => { e.stopPropagation(); onclose(tab.id); }}
        title="Close"
      >×</button>
    </div>
  {/each}
  <div class="tab-spacer"></div>
  <div class="mug-icon">
    <svg width="16" height="18" viewBox="0 0 16 18" fill="none">
      <path class="steam steam-1" d="M4.5 5 Q5.5 3.5 4.5 2 Q3.5 0.5 4.5 -1" stroke="#c8956c" stroke-width="1" stroke-linecap="round" fill="none" opacity="0.5"/>
      <path class="steam steam-2" d="M6.5 5 Q7.5 3.5 6.5 2 Q5.5 0.5 6.5 -1" stroke="#c8956c" stroke-width="1" stroke-linecap="round" fill="none" opacity="0.45"/>
      <path class="steam steam-3" d="M8.5 5 Q9.5 3.5 8.5 2 Q7.5 0.5 8.5 -1" stroke="#c8956c" stroke-width="1" stroke-linecap="round" fill="none" opacity="0.5"/>
      <rect x="2" y="5" width="8" height="9" rx="1.5" stroke="#c8956c" stroke-width="1.2" fill="none"/>
      <path d="M10 7.5h1.5a1.5 1.5 0 0 1 0 3H10" stroke="#c8956c" stroke-width="1.2" fill="none" stroke-linecap="round"/>
      <rect x="1.5" y="14" width="9" height="1.2" rx="0.6" fill="#c8956c" opacity="0.4"/>
    </svg>
  </div>
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

  .tab.external-modified:not(.active) {
    color: #c0a07f;
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

  .tab-spacer {
    flex: 1;
  }

  .mug-icon {
    display: flex;
    align-items: center;
    padding: 0 0.75rem;
    flex-shrink: 0;
    opacity: 0.7;
  }

  .steam {
    animation: rise 3s ease-in-out infinite;
  }

  .steam-1 {
    animation-delay: 0s;
  }

  .steam-2 {
    animation-delay: 1s;
  }

  .steam-3 {
    animation-delay: 2s;
  }

  @keyframes rise {
    0% {
      transform: translateY(0);
      opacity: 0;
    }
    15% {
      opacity: 0.6;
    }
    75% {
      opacity: 0.25;
    }
    100% {
      transform: translateY(-5px);
      opacity: 0;
    }
  }
</style>
