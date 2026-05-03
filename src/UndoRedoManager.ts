/**
 * UndoRedoManager
 * ───────────────
 * Maintains a per-file undo/redo stack (bounded to maxSize entries) and
 * delegates all disk I/O to DiskPersistence so that history survives
 * VSCode restarts and workspace switches.
 *
 * Recording strategy
 * ──────────────────
 * We capture the FULL document text *before* a change occurs (tracked in
 * `extension.ts` via `previousContents`).  Undo/redo therefore means
 * "replace the whole document with the saved snapshot", which is simple,
 * correct, and avoids the complexity of diff/patch handling.
 *
 * Re-entrancy guard
 * ─────────────────
 * When we apply a snapshot we call `editor.edit()`, which fires
 * `onDidChangeTextDocument` again.  The `isApplying` boolean prevents
 * that secondary event from being recorded as a new history entry.
 */

import * as vscode from "vscode";
import { DiskPersistence } from "./DiskPersistence";
import { FileHistory, Snapshot } from "./types";

export class UndoRedoManager {
  /** True while we are programmatically applying a snapshot. */
  public isApplying = false;

  private maxSize: number;
  private persistence: DiskPersistence;

  /** In-memory cache so we don't hit disk on every keystroke. */
  private cache: Map<string, FileHistory> = new Map();

  constructor(persistence: DiskPersistence, maxSize: number) {
    this.persistence = persistence;
    this.maxSize = maxSize;

    // Pre-warm the in-memory cache from disk at startup
    this.cache = persistence.loadAll();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Record the content the file had *before* the latest change.
   * Called by the document-change listener in extension.ts.
   */
  recordChange(uri: vscode.Uri, previousContent: string): void {
    if (this.isApplying) return;

    const history = this._get(uri);

    history.undoStack.push({
      content: previousContent,
      timestamp: Date.now(),
    } as Snapshot);

    // Enforce the cap — drop the oldest snapshot when we exceed maxSize
    if (history.undoStack.length > this.maxSize) {
      history.undoStack.shift();
    }

    // A new edit invalidates the redo branch entirely
    history.redoStack = [];

    this._save(uri, history);
  }

  /** Step back one snapshot. Returns false when the undo stack is empty. */
  async undo(editor: vscode.TextEditor): Promise<boolean> {
    const history = this._get(editor.document.uri);
    if (history.undoStack.length === 0) return false;

    history.redoStack.push(this._currentSnapshot(editor));
    const snapshot = history.undoStack.pop()!;

    await this._apply(editor, snapshot.content);
    this._save(editor.document.uri, history);
    return true;
  }

  /** Step forward one snapshot. Returns false when the redo stack is empty. */
  async redo(editor: vscode.TextEditor): Promise<boolean> {
    const history = this._get(editor.document.uri);
    if (history.redoStack.length === 0) return false;

    history.undoStack.push(this._currentSnapshot(editor));
    const snapshot = history.redoStack.pop()!;

    await this._apply(editor, snapshot.content);
    this._save(editor.document.uri, history);
    return true;
  }

  /** How many entries each stack currently holds for a file. */
  getStackSizes(uri: vscode.Uri): { undo: number; redo: number } {
    const h = this._get(uri);
    return { undo: h.undoStack.length, redo: h.redoStack.length };
  }

  /** Returns a formatted list of timestamps for the undo stack (most recent first). */
  getUndoTimestamps(uri: vscode.Uri): string[] {
    const h = this._get(uri);
    return [...h.undoStack]
      .reverse()
      .map((s) => new Date(s.timestamp).toLocaleString());
  }

  /** Wipe history for a single file from memory and disk. */
  clearFile(uri: vscode.Uri): void {
    this.cache.delete(uri.toString());
    this.persistence.delete(uri.toString());
  }

  /** Wipe ALL tracked history from memory and disk. */
  clearAll(): void {
    this.cache.clear();
    this.persistence.deleteAll();
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /** Get a file's history from the in-memory cache (or disk, or blank). */
  private _get(uri: vscode.Uri): FileHistory {
    const key = uri.toString();
    if (!this.cache.has(key)) {
      this.cache.set(key, this.persistence.load(key));
    }
    return this.cache.get(key)!;
  }

  /** Write through: update cache and immediately flush to disk. */
  private _save(uri: vscode.Uri, history: FileHistory): void {
    const key = uri.toString();
    this.cache.set(key, history);
    this.persistence.save(key, history);
  }

  /** Snapshot of the editor's current content. */
  private _currentSnapshot(editor: vscode.TextEditor): Snapshot {
    return { content: editor.document.getText(), timestamp: Date.now() };
  }

  /**
   * Replace the whole document with `content`.
   * Uses `undoStopBefore/After: false` so this replacement is NOT added to
   * VSCode's own undo stack — the two systems stay independent.
   */
  private async _apply(
    editor: vscode.TextEditor,
    content: string
  ): Promise<void> {
    this.isApplying = true;
    try {
      await editor.edit(
        (builder) => {
          const full = new vscode.Range(
            editor.document.positionAt(0),
            editor.document.positionAt(editor.document.getText().length)
          );
          builder.replace(full, content);
        },
        { undoStopBefore: false, undoStopAfter: false }
      );
    } finally {
      this.isApplying = false;
    }
  }
}
