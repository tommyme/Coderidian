export const SEP = '\x1e';
export const SEP2 = '\x1e\x1e';

export type FileChangeType = 'new' | 'modified' | 'deleted';

export interface FileEntry {
  name: string;           // vault-folder-relative path, .md stripped
  type: FileChangeType;
}

export interface FormatResult {
  content: string;
  files: FileEntry[];
}

export interface ApplyResult {
  name: string;
  status: 'created' | 'deleted' | 'modified' | 'error';
  hunksApplied?: number;
  errors?: string[];
}
