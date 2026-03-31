export interface HistoryEntry {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

export function createEditorHistory(maxEntries = 500) {
  let entries: HistoryEntry[] = [];
  let index = -1;

  function push(value: string, selectionStart: number, selectionEnd: number) {
    const prev = entries[index];
    if (prev && prev.value === value && prev.selectionStart === selectionStart && prev.selectionEnd === selectionEnd) {
      return;
    }

    if (index < entries.length - 1) {
      entries = entries.slice(0, index + 1);
    }

    entries.push({ value, selectionStart, selectionEnd });

    if (entries.length > maxEntries) {
      const overflow = entries.length - maxEntries;
      entries.splice(0, overflow);
      index = Math.max(0, index - overflow);
    }

    index = entries.length - 1;
  }

  function reset(value: string, selectionStart = 0, selectionEnd = selectionStart) {
    entries = [{ value, selectionStart, selectionEnd }];
    index = 0;
  }

  function canUndo() {
    return index > 0;
  }

  function canRedo() {
    return index >= 0 && index < entries.length - 1;
  }

  function undo(): HistoryEntry | null {
    if (!canUndo()) return null;
    index -= 1;
    return entries[index] ?? null;
  }

  function redo(): HistoryEntry | null {
    if (!canRedo()) return null;
    index += 1;
    return entries[index] ?? null;
  }

  function isInitialState() {
    return entries.length === 1 && index === 0;
  }

  return {
    push,
    reset,
    canUndo,
    canRedo,
    undo,
    redo,
    isInitialState,
  };
}
