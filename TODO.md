# TODO

## Must-have (you'll hit these in minutes)

- [ ] **Undo/Redo (Cmd+Z / Cmd+Shift+Z)** — the textarea has basic browser undo, but it breaks when you set `value` programmatically (which happens on file open). Need a proper undo stack.
- [ ] **Tab key inserts indentation** — right now Tab moves focus out of the textarea. Intercept it and insert spaces/tab.
- [ ] **Auto-indent on Enter** — match the indentation of the current line when pressing Enter.
- [ ] **Find and Replace (Cmd+H)** — find alone won't cut it for long. Replace + Replace All.
- [ ] **Line numbers** — hard to navigate code without them, especially for error messages that reference line numbers.
- [ ] **Unsaved changes warning** — prompt before opening a new file or closing the window when dirty.

## Important (you'll feel it within the first day)

- [ ] **Multi-file tabs** — opening a new file loses the current one. Need tabs or a buffer list.
- [ ] **Go to line (Cmd+G or Cmd+L)** — essential when reading stack traces.
- [ ] **Auto-closing brackets/quotes** — type `(` get `()` with cursor in the middle.
- [ ] **Selection indentation (Tab/Shift+Tab)** — indent/dedent selected block.
- [ ] **Cmd+D / Cmd+Shift+L** — select next occurrence / select all occurrences. Huge for quick renames.
- [ ] **Word wrap toggle** — some files are unreadable without it.

## Quality of life (first week)

- [ ] **Cmd+P quick file open** — fuzzy file finder across the project, way faster than sidebar browsing.
- [ ] **Minimap or scrollbar markers** — find match positions, current line indicator.
- [ ] **Highlight current line** — subtle background on the active line.
- [ ] **Remember state** — last opened folder, open files, cursor positions across sessions (persist to localStorage or a file).
- [ ] **Drag to resize sidebar** — 280px fixed won't always be right.
- [ ] **Multiple cursors** — once you've had them, hard to go back.

## Architecture note

The biggest gap isn't any single feature — it's that a `<textarea>` will start fighting you hard around the must-have items. Textareas don't give you control over rendering individual lines, cursor positioning, or tokenized editing. Every serious editor (VS Code, CodeMirror, Ace) uses a custom text input layer for this reason.

Consider swapping in **CodeMirror 6** as the editing core (runs fine in Tauri's webview). You'd keep the sidebar, find bar, header, and file management — just replace the textarea+Shiki overlay. This gives you undo, indent, multi-cursor, bracket matching, and hundreds of other editing primitives for free.
