#[tauri::command]
fn get_cli_args() -> Vec<String> {
    std::env::args().collect()
}

fn instance_dir() -> std::path::PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
    std::path::PathBuf::from(home).join(".mug").join("instances")
}

fn instance_file() -> std::path::PathBuf {
    instance_dir().join(std::process::id().to_string())
}

#[tauri::command]
fn register_directory(dir: String) {
    let dir_path = instance_dir();
    let _ = std::fs::create_dir_all(&dir_path);
    let _ = std::fs::write(instance_file(), dir);
}

#[tauri::command]
fn unregister_directory() {
    let _ = std::fs::remove_file(instance_file());
}

#[tauri::command]
fn fzf_files(dir: String, query: String) -> Vec<String> {
    // Use fd for fast file listing, pipe to fzf for fuzzy matching
    let fd = std::process::Command::new("fd")
        .args(["--type", "f", "--hidden", "--exclude", ".git", "--exclude", "node_modules", "--exclude", "target", "--exclude", "dist", "--exclude", "build", "--exclude", ".svelte-kit"])
        .current_dir(&dir)
        .stdout(std::process::Stdio::piped())
        .spawn();

    let file_list = match fd {
        Ok(child) => child,
        Err(_) => {
            // Fallback: use find if fd not available
            match std::process::Command::new("find")
                .args([".", "-type", "f", "-not", "-path", "*/.git/*", "-not", "-path", "*/node_modules/*", "-not", "-path", "*/target/*"])
                .current_dir(&dir)
                .stdout(std::process::Stdio::piped())
                .spawn()
            {
                Ok(child) => child,
                Err(_) => return vec![],
            }
        }
    };

    if query.is_empty() {
        // No query: return first 100 files
        let output = match file_list.wait_with_output() {
            Ok(o) => o,
            Err(_) => return vec![],
        };
        return String::from_utf8_lossy(&output.stdout)
            .lines()
            .take(100)
            .map(|s| s.trim_start_matches("./").to_string())
            .collect();
    }

    let fzf = std::process::Command::new("fzf")
        .args(["--filter", &query])
        .stdin(file_list.stdout.unwrap())
        .stdout(std::process::Stdio::piped())
        .spawn();

    let output = match fzf {
        Ok(child) => match child.wait_with_output() {
            Ok(o) => o,
            Err(_) => return vec![],
        },
        Err(_) => return vec![],
    };

    String::from_utf8_lossy(&output.stdout)
        .lines()
        .take(50)
        .map(|s| s.trim_start_matches("./").to_string())
        .collect()
}

#[tauri::command]
fn zoxide_query(q: String) -> Vec<String> {
    let mut args = vec!["query", "-l"];
    let owned;
    if !q.is_empty() {
        owned = q;
        args.push(&owned);
    }
    let output = match std::process::Command::new("zoxide").args(&args).output() {
        Ok(o) if o.status.success() => o,
        _ => return vec![],
    };
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(|s| s.to_string())
        .collect()
}

#[tauri::command]
fn get_git_status(path: String) -> Vec<(String, String)> {
    let output = match std::process::Command::new("git")
        .args(["-C", &path, "status", "--porcelain", "-uall"])
        .output()
    {
        Ok(o) if o.status.success() => o,
        _ => return vec![],
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout
        .lines()
        .filter_map(|line| {
            if line.len() < 4 {
                return None;
            }
            let status = line[..2].trim().to_string();
            let file = line[3..].to_string();
            Some((file, status))
        })
        .collect()
}

#[tauri::command]
fn get_git_branch(path: String) -> Option<String> {
    let output = std::process::Command::new("git")
        .args(["-C", &path, "rev-parse", "--abbrev-ref", "HEAD"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if branch.is_empty() { None } else { Some(branch) }
}

fn parse_git_hunk_range(token: &str, prefix: char) -> Option<(usize, usize)> {
    let raw = token.strip_prefix(prefix)?;
    let mut parts = raw.split(',');
    let start = parts.next()?.parse::<usize>().ok()?;
    let count = parts
        .next()
        .map(|s| s.parse::<usize>().ok())
        .flatten()
        .unwrap_or(1);
    Some((start, count))
}

#[tauri::command]
fn get_git_file_line_changes(path: String, file: String) -> Vec<(String, usize, usize)> {
    // Untracked files: mark whole file as added.
    let status_output = std::process::Command::new("git")
        .args(["-C", &path, "status", "--porcelain", "--", &file])
        .output();

    if let Ok(out) = status_output {
        if out.status.success() {
            let status = String::from_utf8_lossy(&out.stdout);
            if status.lines().any(|line| line.starts_with("??")) {
                let abs = std::path::Path::new(&path).join(&file);
                let line_count = std::fs::read_to_string(&abs)
                    .ok()
                    .map(|s| s.lines().count())
                    .unwrap_or(1)
                    .max(1);
                return vec![("added".to_string(), 1, line_count)];
            }
        }
    }

    // Combined diff against HEAD includes staged + unstaged changes.
    let output = match std::process::Command::new("git")
        .args(["-C", &path, "diff", "--no-color", "--unified=0", "HEAD", "--", &file])
        .output()
    {
        Ok(o) if o.status.success() => o,
        _ => return vec![],
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut changes: Vec<(String, usize, usize)> = Vec::new();

    for line in stdout.lines() {
        if !line.starts_with("@@") {
            continue;
        }

        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 3 {
            continue;
        }

        let (old_start, old_count) = match parse_git_hunk_range(parts[1], '-') {
            Some(v) => v,
            None => continue,
        };
        let (new_start, new_count) = match parse_git_hunk_range(parts[2], '+') {
            Some(v) => v,
            None => continue,
        };

        if old_count == 0 && new_count > 0 {
            let start = new_start.max(1);
            let end = start + new_count.saturating_sub(1);
            changes.push(("added".to_string(), start, end));
        } else if new_count == 0 && old_count > 0 {
            let anchor = if new_start == 0 { old_start.max(1) } else { new_start.max(1) };
            changes.push(("deleted".to_string(), anchor, anchor));
        } else if old_count > 0 && new_count > 0 {
            let start = new_start.max(1);
            let end = start + new_count.saturating_sub(1);
            changes.push(("modified".to_string(), start, end));
        }
    }

    changes
}

// ── File I/O (no scope restrictions) ─────────────────────────

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("{}: {}", path, e))
}

#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| format!("{}: {}", path, e))
}

#[tauri::command]
fn stat_path(path: String) -> Result<(bool, bool), String> {
    let meta = std::fs::metadata(&path).map_err(|e| format!("{}: {}", path, e))?;
    Ok((meta.is_file(), meta.is_dir()))
}

#[tauri::command]
fn read_dir_entries(path: String) -> Result<Vec<(String, bool)>, String> {
    let mut entries = Vec::new();
    let dir = std::fs::read_dir(&path).map_err(|e| format!("{}: {}", path, e))?;
    for entry in dir.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        entries.push((name, is_dir));
    }
    Ok(entries)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![get_cli_args, get_git_branch, get_git_status, get_git_file_line_changes, zoxide_query, fzf_files, register_directory, unregister_directory, read_text_file, write_text_file, stat_path, read_dir_entries])
        .on_window_event(|_window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let _ = std::fs::remove_file(instance_file());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
