# Mug

A **desktop code/text editor** built with **Tauri v2 + SvelteKit + TypeScript**.

## Architecture

- **Frontend**: SvelteKit (SPA mode via `adapter-static`, SSR disabled) running on Vite (port 1420)
- **Backend**: Rust (Tauri v2) with plugins for filesystem, dialogs, and OS opener
- **Syntax highlighting**: [Shiki](https://shiki.style/) with an overlay approach (transparent textarea on top of highlighted code layer)

## Key Features

- **Tabs**: Multi-tab editing with dirty indicators, scroll/cursor state preserved per tab
- **File sidebar**: Open a folder, browse files/directories (filters out dotfiles, `node_modules`, `target`, `dist`, `build`), navigate up/to-root
- **File editing**: Open/create/save/save-as text files with dirty-state tracking
- **Quick open**: `Cmd+P` fuzzy file finder across the open directory
- **Find/replace**: In-editor find bar with match navigation
- **Syntax highlighting**: Shiki overlay approach (transparent textarea on top of highlighted code layer) with scroll sync
- **Languages**: TS, JS, Svelte, Python, JSON, Markdown, HTML, CSS, Rust, Ruby, Elixir, YAML, TOML, SQL, Go, Bash
- **Themes**: github-dark/light, dracula, nord — auto-detected from file extension
- **Markdown enhancements**: Headers render bold + amber, blockquotes italic with left border, dimmed frontmatter/HR
- **Keyboard shortcuts**: `Cmd+S` save, `Cmd+Shift+S` save-as, `Cmd+O` open folder, `Cmd+Shift+O` open file, `Cmd+N` new file, `Cmd+F` find, `Cmd+D` select next occurrence, `Cmd+P` quick open
- **Smart editing**: Auto-indent on Enter, bracket auto-close, Tab indent/dedent for selections, word wrap toggle
- **Welcome screen**: Animated intro shown when no file is open
- **CLI launcher**: `mug [path]` to open files/directories from the terminal

## Tauri Capabilities

- FS access scoped to `$HOME/**`
- Dialog & opener plugins enabled
- Window: 800×600, titled "Mug"

## UI Layout

- **Header**: filename (with dirty indicator), action buttons, language/theme dropdowns
- **Workspace**: 280px sidebar + editor area
- **Footer**: status message + current file path
- Dark theme (`#111827` background)

## Deploy

```bash
scripts/deploy
```

Builds a release binary (`pnpm tauri build`), kills any running instance, copies the `.app` bundle to `/Applications`, and refreshes Spotlight + Launch Services.

## Code Structure

### Frontend (`src/`)

| Path | Purpose |
|------|---------|
| `src/routes/+page.svelte` | Main page: tab state, file I/O, keyboard shortcuts, layout |
| `src/routes/+layout.ts` | Disables SSR for Tauri SPA mode |
| `src/app.html` | HTML shell |
| `src/lib/components/CodeEditor.svelte` | Textarea + Shiki overlay, markdown enhancements, smart indent, find integration |
| `src/lib/components/TabBar.svelte` | Tab strip with dirty dots and close buttons |
| `src/lib/components/FileSidebar.svelte` | Directory tree browser with open-folder dialog |
| `src/lib/components/FindBar.svelte` | In-editor search with match highlighting and navigation |
| `src/lib/components/QuickOpen.svelte` | `Cmd+P` fuzzy file finder |
| `src/lib/components/ModePicker.svelte` | Language/theme selector dropdowns |
| `src/lib/components/DirectoryPicker.svelte` | Initial folder picker on first launch |
| `src/lib/components/WelcomeScreen.svelte` | Animated welcome shown when no file is open |
| `src/lib/utils/path.ts` | Path helpers: fileName, joinPath, parentPath, relativePath, shortPath, detectLanguage |

### Backend (`src-tauri/`)

| Path | Purpose |
|------|---------|
| `src-tauri/src/lib.rs` | Tauri app builder with plugin registration |
| `src-tauri/src/main.rs` | Rust entry point |
| `src-tauri/tauri.conf.json` | Tauri config (window, build commands, bundle) |
| `src-tauri/Cargo.toml` | Rust dependencies (tauri, plugins, serde) |
| `src-tauri/capabilities/default.json` | Permission scopes (fs, dialog, opener) |

### Scripts (`scripts/`)

| Script | Purpose |
|--------|---------|
| `scripts/deploy` | Release build → kill running instance → copy to `/Applications` → refresh Spotlight & Launch Services |
| `scripts/code` | CLI launcher: `mug [path]` opens Mug from the terminal |
| `scripts/install-cli` | Symlinks `scripts/code` to `/usr/local/bin/mug` |

### Config

| Path | Purpose |
|------|---------|
| `vite.config.js` | Vite config tuned for Tauri dev |
| `svelte.config.js` | SvelteKit config with static adapter |
