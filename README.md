# Mug

A minimal desktop text editor built with Tauri v2, SvelteKit, and TypeScript.

![screenshot](https://img.shields.io/badge/platform-macOS-lightgrey)

## Features

- Multi-tab editing with dirty-state tracking
- Syntax highlighting via [Shiki](https://shiki.style/) (20+ languages)
- File sidebar with directory tree browsing
- Quick open (`Cmd+K`) with fuzzy search via `fd` + `fzf`
- Find in file (`Cmd+F`)
- Git status in sidebar + branch in footer
- Smart indent, bracket auto-close, word wrap
- Markdown enhancements (bold amber headers, styled blockquotes)
- CLI launcher: `mug .`, `mug file.rs`, `mug ~/projects`

## Dependencies

### Required

- [Rust](https://rustup.rs/) (1.75+)
- [Node.js](https://nodejs.org/) (20+)
- [pnpm](https://pnpm.io/) (9+)

### Optional (for full functionality)

- [fd](https://github.com/sharkdp/fd) — fast file listing for quick open
- [fzf](https://github.com/junegunn/fzf) — fuzzy matching for quick open
- [zoxide](https://github.com/ajeetdsouza/zoxide) — smart directory picker

```bash
# macOS
brew install fd fzf zoxide
```

## Install from source

```bash
# Clone
git clone https://github.com/wrgoldstein/mug.git
cd mug

# Install frontend dependencies
pnpm install

# Build and install to /Applications
./scripts/deploy

# (Optional) Install the `mug` CLI command
sudo ./scripts/install-cli
```

After install, launch from the terminal:

```bash
mug .                # open current directory
mug ~/projects       # open a directory
mug ~/.zshrc         # open a file
```

## Development

```bash
pnpm tauri dev       # run in dev mode with hot reload
```

## Project structure

```
src/                          # SvelteKit frontend
  routes/+page.svelte         # main page (tabs, file I/O, shortcuts)
  lib/components/             # CodeEditor, FileSidebar, TabBar, FindBar, etc.
  lib/utils/path.ts           # path helpers + language detection
src-tauri/                    # Rust backend
  src/lib.rs                  # Tauri commands (file I/O, git, fzf, zoxide)
  capabilities/default.json   # permissions
scripts/
  deploy                      # build + install to /Applications
  code                        # CLI launcher (mug)
  install-cli                 # symlink mug to /usr/local/bin
```

## License

MIT
