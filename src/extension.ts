import * as vscode from "vscode";
import { UndoRedoManager } from "./UndoRedoManager";
import { DiskPersistence } from "./DiskPersistence";

/** Snapshot of each file's content captured just before the latest change.
 *  Lets us hand the "previous content" to the manager on every edit. */
const previousContents = new Map<string, string>();

let manager: UndoRedoManager;
let statusBar: vscode.StatusBarItem;

// ─── Activation ────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
  const cfg = vscode.workspace.getConfiguration("persistentUndoRedo");
  const maxHistory = cfg.get<number>("maxHistory", 100);

  const persistence = new DiskPersistence(context.globalStorageUri.fsPath);
  manager = new UndoRedoManager(persistence, maxHistory);

  // ── Status-bar item ──────────────────────────────────────────────────────
  statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    10
  );
  statusBar.command = "persistentUndoRedo.showHistory";
  statusBar.tooltip = "Persistent Undo/Redo — click for details";
  context.subscriptions.push(statusBar);

  // ── Seed previousContents for already-open documents ────────────────────
  vscode.workspace.textDocuments.forEach(seedDoc);

  // ── Listeners ────────────────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(seedDoc)
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      const doc = event.document;

      // Ignore non-file schemes (output channels, git diffs, …)
      if (doc.uri.scheme !== "file") return;
      // Ignore no-op events
      if (event.contentChanges.length === 0) return;
      // Ignore changes we caused ourselves
      if (manager.isApplying) return;

      const key = doc.uri.toString();
      const previous = previousContents.get(key);

      if (previous !== undefined && previous !== doc.getText()) {
        manager.recordChange(doc.uri, previous);
      }

      // Always keep previousContents current
      previousContents.set(key, doc.getText());
      refreshStatusBar();
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => refreshStatusBar())
  );

  // ── Commands ─────────────────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "persistentUndoRedo.undo",
      async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const ok = await manager.undo(editor);
        if (!ok) {
          vscode.window.setStatusBarMessage(
            "$(circle-slash) No more persistent undo history",
            2500
          );
        }
        refreshStatusBar();
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "persistentUndoRedo.redo",
      async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const ok = await manager.redo(editor);
        if (!ok) {
          vscode.window.setStatusBarMessage(
            "$(circle-slash) No more persistent redo history",
            2500
          );
        }
        refreshStatusBar();
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "persistentUndoRedo.showHistory",
      () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showInformationMessage("No active editor.");
          return;
        }
        const { undo, redo } = manager.getStackSizes(editor.document.uri);
        vscode.window.showInformationMessage(
          `Persistent History for ${editor.document.fileName}\n` +
            `  Undo stack : ${undo} / ${maxHistory} entries\n` +
            `  Redo stack : ${redo} / ${maxHistory} entries`
        );
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "persistentUndoRedo.clearFile",
      () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;
        manager.clearFile(editor.document.uri);
        vscode.window.showInformationMessage(
          "Persistent undo/redo history cleared for this file."
        );
        refreshStatusBar();
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "persistentUndoRedo.clearAll",
      async () => {
        const answer = await vscode.window.showWarningMessage(
          "Clear persistent undo/redo history for ALL files in this workspace?",
          { modal: true },
          "Yes, clear all"
        );
        if (answer === "Yes, clear all") {
          manager.clearAll();
          vscode.window.showInformationMessage(
            "All persistent history cleared."
          );
          refreshStatusBar();
        }
      }
    )
  );

  refreshStatusBar();
  console.log("persistent-undo-redo: activated");
}

export function deactivate(): void {
  /* nothing to clean up – disposables handled by context.subscriptions */
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function seedDoc(doc: vscode.TextDocument): void {
  if (doc.uri.scheme === "file") {
    previousContents.set(doc.uri.toString(), doc.getText());
  }
}

function refreshStatusBar(): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== "file") {
    statusBar.hide();
    return;
  }
  const { undo, redo } = manager.getStackSizes(editor.document.uri);
  statusBar.text = `$(history) U:${undo}  R:${redo}`;
  statusBar.show();
}
