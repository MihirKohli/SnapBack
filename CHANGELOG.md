# Changelog

## [0.0.2] - 2026-05-03

### Fixed
- Renamed all command IDs from `persistentUndoRedo.*` to `returnBack.*` to match the published extension name, resolving "command not found" errors after marketplace install.

### Changed
- Extension renamed to **Return Back**.
- Configuration key updated from `persistentUndoRedo.maxHistory` to `returnBack.maxHistory`.
- Icon resized to 128×128 px to reduce package size.

---

## [0.0.1] - 2026-05-03

### Added
- Initial release of **Return Back**.
- Persistent undo/redo history across VSCode restarts (up to `returnBack.maxHistory` snapshots per file).
- History stored in `workspaceState` (SQLite-backed), scoped per workspace.
- Commands: Undo, Redo, Show History & Stats, Clear File History, Clear All History.
- Default keybindings: `Ctrl+Z` / `Cmd+Z` (undo), `Ctrl+Y` / `Cmd+Shift+Z` (redo).
- Right-click context menu submenu under **Return Back**.
