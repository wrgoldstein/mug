import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

const plugins = await sveltekit();

// https://vite.dev/config/
export default defineConfig({
  plugins,

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. suppress known non-actionable production bundling warnings for this app
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        /** @param {string} id */
        manualChunks(id) {
          if (id.includes("/node_modules/.pnpm/svelte@") || id.includes("/node_modules/svelte/")) {
            return "svelte-runtime";
          }
          return undefined;
        },
      },
    },
  },

  // 3. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 4. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
});
