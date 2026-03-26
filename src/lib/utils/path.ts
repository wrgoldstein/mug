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

export function detectLanguage(path: string): BundledLanguage {
  const ext = path.split(".").pop()?.toLowerCase();
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
    case "sh":
    case "bash":
      return "bash";
    default:
      return "ts";
  }
}
