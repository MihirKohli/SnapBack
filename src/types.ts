export interface Snapshot {
  content: string;
  timestamp: number;
}

export interface FileHistory {
  undoStack: Snapshot[];
  redoStack: Snapshot[];
}

export type StorageMap = Record<string, FileHistory>;

export type IndexMap = Record<string, string>;
