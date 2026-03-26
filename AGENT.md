# tauri-svelte-editor

A **desktop code/text editor** built with **Tauri v2 + SvelteKit + TypeScript**.

## Architecture

- **Frontend**: SvelteKit (SPA mode via `adapter-static`, SSR disabled) running on Vite (port 1420)
- **Backend**: Rust (Tauri v2) with plugins for filesystem, dialogs, and OS opener
- **Syntax highlighting**: [Shiki](https://shiki.style/) with an overlay approach (transparent textarea on top of highlighted code layer)

## Key Features

- **File sidebar**: Open a folder, browse files/directories (filters out dotfiles, `node_modules`, `target`, `dist`, `build`), navigate up/to-root
- **File editing**: Open/create/save/save-as text files with dirty-state tracking
- **Syntax highlighting**: Supports ~10 languages (TS, JS, Python, Svelte, JSON, Markdown, HTML, CSS, Rust, Bash) and 4 themes (github-dark/light, dracula, nord), auto-detected from file extension
- **Keyboard shortcuts**: `Cmd+S` save, `Cmd+Shift+S` save-as, `Cmd+O` open folder, `Cmd+Shift+O` open file, `Cmd+N` new file
- **Scroll sync** between the invisible textarea and the highlighted code layer

## Tauri Capabilities

- FS access scoped to `$HOME/**`
- Dialog & opener plugins enabled
- Window: 800×600, titled "tauri-svelte-editor"

## UI Layout

- **Header**: filename (with dirty indicator), action buttons, language/theme dropdowns
- **Workspace**: 280px sidebar + editor area
- **Footer**: status message + current file path
- Dark theme (`#111827` background)

## Code Structure

Everything lives in a single `src/routes/+page.svelte` component — no routing, no separate stores or components.

### Key Files

| Path | Purpose |
|------|---------|
| `src/routes/+page.svelte` | Entire frontend: UI, state, file ops, highlighting |
| `src/routes/+layout.ts` | Disables SSR for Tauri SPA mode |
| `src/app.html` | HTML shell |
| `src-tauri/src/lib.rs` | Tauri app builder with plugin registration |
| `src-tauri/src/main.rs` | Rust entry point |
| `src-tauri/tauri.conf.json` | Tauri config (window, build commands, bundle) |
| `src-tauri/Cargo.toml` | Rust dependencies (tauri, plugins, serde) |
| `src-tauri/capabilities/default.json` | Permission scopes (fs, dialog, opener) |
| `vite.config.js` | Vite config tuned for Tauri dev |
| `svelte.config.js` | SvelteKit config with static adapter |
