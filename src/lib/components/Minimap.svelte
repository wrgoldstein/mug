<script lang="ts">
  import { onMount } from "svelte";

  interface GitLineChange {
    kind: "added" | "modified" | "deleted";
    startLine: number;
    endLine: number;
  }

  interface MinimapBar {
    key: string;
    y: number;
    height: number;
    width: number;
    opacity: number;
  }

  interface MinimapGitMarker {
    key: string;
    kind: GitLineChange["kind"];
    top: number;
    height: number;
  }

  interface Props {
    content: string;
    gitLineChanges: GitLineChange[];
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
    onseek: (ratio: number) => void;
    onscrollby: (deltaY: number) => void;
  }

  let { content, gitLineChanges, scrollTop, scrollHeight, clientHeight, onseek, onscrollby }: Props = $props();

  let minimapEl = $state<HTMLDivElement | null>(null);
  let bars = $state<MinimapBar[]>([]);
  let markers = $state<MinimapGitMarker[]>([]);
  let viewportTop = $state(0);
  let viewportHeight = $state(0);
  let dragOffset = 0;
  let dragging = false;

  function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  function rebuildBars() {
    const lines = content.split("\n");
    const lineCount = Math.max(1, lines.length);

    const targetRows = Math.max(28, Math.floor((minimapEl?.clientHeight ?? 280) / 3));
    const rows = Math.max(1, Math.min(lineCount, targetRows));
    const bucketSize = Math.ceil(lineCount / rows);

    let longestLine = 1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].length > longestLine) longestLine = lines[i].length;
    }

    const nextBars: MinimapBar[] = [];
    for (let row = 0; row < rows; row++) {
      const start = row * bucketSize;
      const end = Math.min(lineCount, start + bucketSize);
      if (start >= end) break;

      let longestInBucket = 0;
      let nonEmpty = 0;
      for (let i = start; i < end; i++) {
        const len = (lines[i] ?? "").trim().length;
        if (len > 0) nonEmpty++;
        if (len > longestInBucket) longestInBucket = len;
      }

      const density = nonEmpty / (end - start || 1);
      const width = clamp((longestInBucket / longestLine) * 100, 6, 100);
      const y = (row / rows) * 100;
      const height = 100 / rows;
      const opacity = clamp(0.14 + density * 0.3, 0.12, 0.45);

      nextBars.push({
        key: `m-${row}-${start}-${end}`,
        y,
        height,
        width,
        opacity,
      });
    }

    bars = nextBars;
    rebuildGitMarkers(lineCount);
  }

  function rebuildGitMarkers(totalLines?: number) {
    const minimap = minimapEl;
    if (!minimap || !gitLineChanges || gitLineChanges.length === 0) {
      markers = [];
      return;
    }

    const lines = totalLines ?? Math.max(1, content.split("\n").length);
    const mapHeight = minimap.clientHeight;
    if (mapHeight <= 0) {
      markers = [];
      return;
    }

    markers = gitLineChanges.map((change, i) => {
      const start = clamp(change.startLine, 1, lines);
      const end = clamp(change.endLine, start, lines);
      const top = ((start - 1) / lines) * mapHeight;
      const rawHeight = ((end - start + 1) / lines) * mapHeight;
      const minHeight = change.kind === "deleted" ? 2 : 3;
      const height = Math.max(minHeight, rawHeight);
      return {
        key: `g-${i}-${change.kind}-${start}-${end}`,
        kind: change.kind,
        top,
        height,
      };
    });
  }

  function updateViewport() {
    const minimap = minimapEl;
    if (!minimap) {
      viewportTop = 0;
      viewportHeight = 0;
      return;
    }

    const mapHeight = minimap.clientHeight;
    if (mapHeight <= 0) {
      viewportTop = 0;
      viewportHeight = 0;
      return;
    }

    const scrollRange = Math.max(0, scrollHeight - clientHeight);
    const minViewport = 20;
    let nextViewportHeight = scrollHeight <= 0
      ? mapHeight
      : Math.max(minViewport, (clientHeight / scrollHeight) * mapHeight);
    nextViewportHeight = Math.min(mapHeight, nextViewportHeight);

    const trackRange = Math.max(0, mapHeight - nextViewportHeight);
    const nextViewportTop = scrollRange === 0 ? 0 : (scrollTop / scrollRange) * trackRange;

    viewportHeight = nextViewportHeight;
    viewportTop = clamp(nextViewportTop, 0, trackRange);
  }

  function seekFromClientY(clientY: number) {
    const minimap = minimapEl;
    if (!minimap) return;

    const rect = minimap.getBoundingClientRect();
    const mapHeight = rect.height;
    if (mapHeight <= 0) return;

    const scrollRange = Math.max(0, scrollHeight - clientHeight);
    if (scrollRange <= 0) return;

    const trackRange = Math.max(1, mapHeight - viewportHeight);
    const localY = clamp(clientY - rect.top - dragOffset, 0, trackRange);
    onseek(localY / trackRange);
  }

  function onMouseDown(event: MouseEvent) {
    const minimap = minimapEl;
    if (!minimap) return;

    event.preventDefault();
    const rect = minimap.getBoundingClientRect();
    const localY = event.clientY - rect.top;
    const viewportBottom = viewportTop + viewportHeight;

    if (localY >= viewportTop && localY <= viewportBottom) {
      dragOffset = localY - viewportTop;
    } else {
      dragOffset = viewportHeight / 2;
    }

    dragging = true;
    seekFromClientY(event.clientY);

    const onMove = (e: MouseEvent) => {
      if (!dragging) return;
      seekFromClientY(e.clientY);
    };

    const onUp = () => {
      dragging = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function onWheel(event: WheelEvent) {
    event.preventDefault();
    onscrollby(event.deltaY);
  }

  $effect(() => {
    void content;
    void minimapEl;
    rebuildBars();
  });

  $effect(() => {
    void gitLineChanges;
    rebuildGitMarkers();
  });

  $effect(() => {
    void scrollTop;
    void scrollHeight;
    void clientHeight;
    void minimapEl;
    updateViewport();
  });

  onMount(() => {
    const observer = new ResizeObserver(() => {
      rebuildBars();
      updateViewport();
    });

    if (minimapEl) observer.observe(minimapEl);

    return () => {
      dragging = false;
      observer.disconnect();
    };
  });
</script>

<div
  class="minimap"
  bind:this={minimapEl}
  onmousedown={onMouseDown}
  onwheel={onWheel}
  aria-hidden="true"
>
  <svg class="minimap-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
    {#each bars as bar (bar.key)}
      <rect
        x="0"
        y={bar.y}
        width={bar.width}
        height={bar.height}
        fill="currentColor"
        opacity={bar.opacity}
        rx="0.8"
        ry="0.8"
      ></rect>
    {/each}
  </svg>
  <div class="minimap-git-layer" aria-hidden="true">
    {#each markers as marker (marker.key)}
      <div
        class="minimap-git-marker"
        class:added={marker.kind === "added"}
        class:modified={marker.kind === "modified"}
        class:deleted={marker.kind === "deleted"}
        style={`top:${marker.top}px;height:${marker.height}px;`}
      ></div>
    {/each}
  </div>
  <div
    class="minimap-viewport"
    style={`top:${viewportTop}px;height:${viewportHeight}px;`}
  ></div>
</div>

<style>
  .minimap {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: var(--minimap-width);
    border-left: 1px solid #2a2a2a;
    background: #171717;
    color: #6f685f;
    z-index: 4;
    cursor: pointer;
    user-select: none;
  }

  .minimap-svg {
    display: block;
    width: 100%;
    height: 100%;
  }

  .minimap-git-layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .minimap-git-marker {
    position: absolute;
    right: 0;
    width: 4px;
    border-radius: 2px 0 0 2px;
    opacity: 0.95;
  }

  .minimap-git-marker.added {
    background: #3fb950;
  }

  .minimap-git-marker.modified {
    background: #d29922;
  }

  .minimap-git-marker.deleted {
    background: #f85149;
  }

  .minimap-viewport {
    position: absolute;
    left: 0;
    right: 0;
    border: 1px solid #c8956c99;
    background: rgba(200, 149, 108, 0.09);
    box-sizing: border-box;
    pointer-events: none;
  }

  .minimap:hover .minimap-viewport {
    border-color: #c8956ccc;
    background: rgba(200, 149, 108, 0.12);
  }
</style>
