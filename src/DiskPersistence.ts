/**
 * DiskPersistence
 * ───────────────
 * Stores each file's undo/redo history as an individual JSON file inside
 * VSCode's globalStorageUri directory.  This directory is independent of
 * any workspace, so history survives:
 *   • closing the editor
 *   • switching workspaces
 *   • full VSCode restarts
 *
 * Layout on disk
 * ──────────────
 *   <globalStorageUri>/
 *     index.json          ← maps fileKey → historyFilename
 *     <sha256>.json       ← FileHistory for one source file
 *     <sha256>.json
 *     …
 *
 * Every write is atomic-ish: we write the payload file first, then update
 * the index.  A crash between the two leaves an orphan file but never
 * corrupts existing history.
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { FileHistory, IndexMap } from "./types";

const INDEX_FILE = "index.json";

export class DiskPersistence {
  private storageDir: string;
  private index: IndexMap = {};

  constructor(globalStorageUriPath: string) {
    this.storageDir = globalStorageUriPath;
    this._ensureDir(this.storageDir);
    this.index = this._readJson<IndexMap>(
      path.join(this.storageDir, INDEX_FILE),
      {}
    );
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /** Persist a FileHistory to disk for the given file key (URI string). */
  save(fileKey: string, history: FileHistory): void {
    const filename = this._filenameFor(fileKey);
    const filepath = path.join(this.storageDir, filename);
    this._writeJson(filepath, history);

    // Update index only after the payload file is safely written
    if (this.index[fileKey] !== filename) {
      this.index[fileKey] = filename;
      this._writeJson(path.join(this.storageDir, INDEX_FILE), this.index);
    }
  }

  /** Load a FileHistory from disk, or return a blank one. */
  load(fileKey: string): FileHistory {
    const filename = this.index[fileKey];
    if (!filename) {
      return emptyHistory();
    }
    return this._readJson<FileHistory>(
      path.join(this.storageDir, filename),
      emptyHistory()
    );
  }

  /** Load every tracked FileHistory from disk (called once at startup). */
  loadAll(): Map<string, FileHistory> {
    const result = new Map<string, FileHistory>();
    for (const [fileKey, filename] of Object.entries(this.index)) {
      const filepath = path.join(this.storageDir, filename);
      const history = this._readJson<FileHistory>(filepath, emptyHistory());
      result.set(fileKey, history);
    }
    return result;
  }

  /** Remove a single file's history from disk. */
  delete(fileKey: string): void {
    const filename = this.index[fileKey];
    if (!filename) return;

    const filepath = path.join(this.storageDir, filename);
    try {
      fs.unlinkSync(filepath);
    } catch {
      /* file may already be gone */
    }

    delete this.index[fileKey];
    this._writeJson(path.join(this.storageDir, INDEX_FILE), this.index);
  }

  /** Wipe everything from disk and reset the index. */
  deleteAll(): void {
    for (const filename of Object.values(this.index)) {
      try {
        fs.unlinkSync(path.join(this.storageDir, filename));
      } catch {
        /* ignore */
      }
    }
    this.index = {};
    this._writeJson(path.join(this.storageDir, INDEX_FILE), this.index);
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /**
   * Map a file URI string to a stable filename by hashing it.
   * Using a hash keeps filenames short and filesystem-safe regardless of
   * the original URI (long paths, special characters, etc.).
   */
  private _filenameFor(fileKey: string): string {
    // Re-use the existing filename if we already have one, so the hash doesn't
    // change if the underlying URI changes representation.
    if (this.index[fileKey]) {
      return this.index[fileKey];
    }
    const hash = crypto
      .createHash("sha256")
      .update(fileKey)
      .digest("hex")
      .slice(0, 16); // 16 hex chars is plenty for uniqueness
    return `${hash}.json`;
  }

  private _ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private _readJson<T>(filepath: string, fallback: T): T {
    try {
      const raw = fs.readFileSync(filepath, "utf8");
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  private _writeJson(filepath: string, data: unknown): void {
    try {
      fs.writeFileSync(filepath, JSON.stringify(data), "utf8");
    } catch (err) {
      console.error(`[PersistentUndoRedo] Failed to write ${filepath}:`, err);
    }
  }
}

function emptyHistory(): FileHistory {
  return { undoStack: [], redoStack: [] };
}
