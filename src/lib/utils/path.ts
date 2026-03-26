import type { BundledLanguage } from "shiki";

export function fileName(path: string | null): string {
  if (!path) return "Untitled";
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export function joinPath(parent: string, child: string): string {
  if (parent.endsWith("/") || parent.endsWith("\\")) return `${parent}${child}`;
  return `${parent}/${child}`;
}

export function parentPath(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const slash = normalized.lastIndexOf("/");
  const backslash = normalized.lastIndexOf("\\");
  const index = Math.max(slash, backslash);
  if (index <= 0) return path;
  return normalized.slice(0, index);
}

export function relativePath(path: string, base: string | null): string {
  if (!base) return path;
  if (!path.startsWith(base)) return path;
  const rel = path.slice(base.length).replace(/^[/\\]/, "");
  return rel || ".";
}

/**
 * Shorten a path by collapsing middle segments to "…" if too deep.
 * e.g. "src/lib/components/deep/nested/File.svelte" → "src/…/nested/File.svelte"
 * Keeps the first segment and last two segments visible.
 */
export function shortPath(path: string, maxSegments = 4): string {
  const parts = path.split(/[\\/]/);
  if (parts.length <= maxSegments) return parts.join("/");
  return [parts[0], "…", ...parts.slice(-2)].join("/");
}

const SHELL_FILES = new Set([
  ".zshrc", ".bashrc", ".bash_profile", ".bash_login", ".bash_logout",
  ".profile", ".zprofile", ".zshenv", ".zlogin", ".zlogout",
  ".env", ".envrc", ".xinitrc", ".xprofile",
]);

export function detectLanguage(path: string): BundledLanguage {
  const name = path.split(/[\\/]/).pop()?.toLowerCase() ?? "";

  // Known dotfiles / filenames
  if (SHELL_FILES.has(name)) return "bash";
  if (name === "makefile" || name === "gnumakefile") return "makefile" as BundledLanguage;
  if (name === "dockerfile") return "dockerfile" as BundledLanguage;
  if (name === "justfile") return "makefile" as BundledLanguage;

  const ext = name.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "ts":
      return "ts";
    case "js":
      return "js";
    case "svelte":
      return "svelte";
    case "py":
      return "python";
    case "json":
      return "json";
    case "md":
      return "md";
    case "html":
      return "html";
    case "css":
      return "css";
    case "rs":
      return "rust";
    case "rb":
      return "ruby";
    case "ex":
    case "exs":
    case "heex":
    case "eex":
      return "elixir";
    case "yml":
    case "yaml":
      return "yaml";
    case "toml":
      return "toml";
    case "sql":
      return "sql";
    case "go":
      return "go";
    case "sh":
    case "bash":
      return "bash";
    default:
      return "plaintext";
  }
}
