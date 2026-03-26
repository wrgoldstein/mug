<script lang="ts">
  import { onMount } from "svelte";
  import { Tween, prefersReducedMotion } from "svelte/motion";
  import { cubicOut } from "svelte/easing";

  let canvas: HTMLCanvasElement;
  let frame: number;
  const reduced = prefersReducedMotion;
  let steamStarted = $state(false);

  const coffeeLevel = new Tween(0, { duration: 3000, easing: cubicOut });

  let fillY = $derived(78.5 - coffeeLevel.current * 42);
  let fillH = $derived(coffeeLevel.current * 42);

  interface Particle {
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
    maxLife: number;
    size: number;
  }

  onMount(() => {
    const ctx = canvas.getContext("2d")!;
    const particles: Particle[] = [];
    const yOffset = 100; // canvas is 200px, SVG content starts at bottom 100px
    const mugLeft = 10;
    const mugRight = 54;
    const mugTop = 30 + yOffset;
    const spawnY = mugTop - 2;

    function spawn() {
      const x = mugLeft + 8 + Math.random() * (mugRight - mugLeft - 16);
      particles.push({
        x,
        y: spawnY,
        vx: (Math.random() - 0.5) * 0.15,
        vy: -(0.2 + Math.random() * 0.3),
        life: 0,
        maxLife: 80 + Math.random() * 60,
        size: 2 + Math.random() * 3,
      });
    }

    function draw() {
      ctx.clearRect(0, 0, 80, 200);

      // Spawn new particles
      if (Math.random() < 0.3) spawn();

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life++;
        if (p.life > p.maxLife) {
          particles.splice(i, 1);
          continue;
        }

        const t = p.life / p.maxLife;

        // Drift with gentle wandering
        p.x += p.vx + Math.sin(p.life * 0.04 + p.x) * 0.12;
        p.y += p.vy;
        p.vy *= 0.997; // slow down slightly
        p.size += 0.02; // grow as it rises

        // Fade: rise in, hold, fade out
        let alpha: number;
        if (t < 0.15) {
          alpha = t / 0.15;
        } else if (t < 0.5) {
          alpha = 1;
        } else {
          alpha = 1 - (t - 0.5) / 0.5;
        }
        alpha *= 0.12;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(200, 149, 108, ${alpha})`;
        ctx.fill();
      }

      frame = requestAnimationFrame(draw);
    }

    setTimeout(() => coffeeLevel.set(1), 400);

    // Start steam when pour is ~70% done
    setTimeout(() => {
      steamStarted = true;
      if (!reduced.current) {
        frame = requestAnimationFrame(draw);
      }
    }, 400 + 2000);

    return () => cancelAnimationFrame(frame);
  });
</script>

<div class="welcome">
  <div class="mug-container">
    <canvas bind:this={canvas} width="80" height="200" class="steam-canvas"></canvas>
    <svg width="80" height="100" viewBox="0 0 80 100" fill="none">
      <!-- Mug body (open top, beaker lip) -->
      <path d="M9 29 Q10 30 10 32 L10 74 Q10 80 16 80 L48 80 Q54 80 54 74 L54 32 Q54 30 55 29" stroke="#c8956c" stroke-width="2.5" fill="none" stroke-linecap="round"/>

      <!-- Coffee fill -->
      <clipPath id="mug-clip">
        <rect x="11.5" y="31.5" width="41" height="47" rx="5"/>
      </clipPath>
      <rect
        x="11.5" y={fillY} width="41" height={fillH}
        rx="0"
        fill="#c8956c"
        opacity="0.15"
        clip-path="url(#mug-clip)"
      />

      <!-- Handle -->
      <path d="M54 42h8a8 8 0 0 1 0 16h-8" stroke="#c8956c" stroke-width="2.5" fill="none" stroke-linecap="round"/>

      <!-- Saucer -->
      <rect x="6" y="82" width="52" height="3" rx="1.5" fill="#c8956c" opacity="0.3"/>
    </svg>
  </div>

  <p class="tagline" class:visible={steamStarted}>let's get to work</p>

  <div class="shortcuts">
    <span class="shortcut"><kbd>⌘K</kbd> open file</span>
    <span class="shortcut"><kbd>⌘O</kbd> open folder</span>
    <span class="shortcut"><kbd>⌘N</kbd> new file</span>
  </div>
</div>

<style>
  .welcome {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 1.2rem;
    opacity: 0;
    animation: fade-in 0.8s ease 0.2s forwards;
  }

  @keyframes fade-in {
    to { opacity: 1; }
  }

  .mug-container {
    position: relative;
    width: 80px;
    height: 100px;
  }

  .steam-canvas {
    position: absolute;
    bottom: 0;
    left: 0;
    width: 80px;
    height: 200px;
    pointer-events: none;
  }

  svg {
    position: absolute;
    inset: 0;
  }

  .tagline {
    margin: 0;
    font-size: 0.9rem;
    font-weight: 300;
    letter-spacing: 0.06em;
    color: #c8956c;
    opacity: 0;
    transition: opacity 1s ease 510ms;
  }

  .tagline.visible {
    opacity: 1;
  }

  .shortcuts {
    display: flex;
    gap: 1.5rem;
    margin-top: 1rem;
    flex-wrap: wrap;
    justify-content: center;
  }

  .shortcut {
    font-size: 0.78rem;
    color: #5a5650;
    letter-spacing: 0.02em;
  }

  kbd {
    display: inline-block;
    color: #c8956c;
    font-family: inherit;
    font-size: 0.78rem;
    margin-right: 0.25rem;
  }
</style>
