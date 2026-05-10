import { App, TFile } from 'obsidian';
import { SEP, SEP2, ApplyResult } from './types';

export async function applyFolderDiff(
  app: App,
  folderPath: string,
  content: string,
): Promise<ApplyResult[]> {
  const sections = parseContent(content);
  const results: ApplyResult[] = [];
  for (const [name, section] of sections) {
    results.push(await applySection(app, folderPath, name, section));
  }
  return results;
}

// ── Parser ────────────────────────────────────────────────────────────────────

interface ParsedSection {
  type: 'new' | 'modified' | 'deleted';
  fileContent?: string;
  hunks?: string[];
}

function parseContent(content: string): Map<string, ParsedSection> {
  const result = new Map<string, ParsedSection>();
  const lines = content.split('\n');
  const FILE_HEADER = /^\)([^(]+)\($/;

  let currentName: string | null = null;
  let bodyLines: string[] = [];

  const flush = () => {
    if (currentName === null) return;
    // Trim trailing empty lines
    while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1] === '') {
      bodyLines.pop();
    }
    result.set(currentName, parseBody(bodyLines));
    currentName = null;
    bodyLines = [];
  };

  for (const line of lines) {
    const m = line.match(FILE_HEADER);
    if (m) {
      flush();
      currentName = m[1];
    } else if (currentName !== null) {
      bodyLines.push(line);
    }
  }
  flush();
  return result;
}

function parseBody(body: string[]): ParsedSection {
  // Trim leading empty lines
  let start = 0;
  while (start < body.length && body[start] === '') start++;
  const trimmed = body.slice(start);

  if (trimmed.length === 0) return { type: 'deleted' };

  if (trimmed[0] === SEP2) {
    // New file: content between first and last SEP2
    const lastSep2 = trimmed.lastIndexOf(SEP2);
    const fileContent = trimmed.slice(1, lastSep2 === 0 ? undefined : lastSep2).join('\n');
    return { type: 'new', fileContent };
  }

  if (trimmed[0] === SEP) {
    // Modified: split by SEP lines (skip first and last)
    const hunks: string[] = [];
    let current: string[] = [];
    for (let i = 1; i < trimmed.length; i++) {
      if (trimmed[i] === SEP) {
        if (current.length > 0) hunks.push(current.join('\n'));
        current = [];
      } else {
        current.push(trimmed[i]);
      }
    }
    if (current.length > 0) hunks.push(current.join('\n'));
    return { type: 'modified', hunks };
  }

  return { type: 'deleted' };
}

// ── Applier ───────────────────────────────────────────────────────────────────

function resolveFilePath(folderPath: string, name: string): string {
  const lastSegment = name.split('/').pop() ?? name;
  const hasExtension = lastSegment.includes('.');
  const fileName = hasExtension ? name : `${name}.md`;
  return folderPath ? `${folderPath}/${fileName}` : fileName;
}

async function ensureParentFolders(app: App, filePath: string): Promise<void> {
  const parts = filePath.split('/');
  parts.pop(); // remove filename
  let current = '';
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(current)) {
      await app.vault.createFolder(current);
    }
  }
}

async function applySection(
  app: App,
  folderPath: string,
  name: string,
  section: ParsedSection,
): Promise<ApplyResult> {
  const filePath = resolveFilePath(folderPath, name);

  if (section.type === 'deleted') {
    const file = app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) {
      return { name, status: 'error', errors: [`File not found: ${filePath}`] };
    }
    await app.vault.delete(file);
    return { name, status: 'deleted' };
  }

  if (section.type === 'new') {
    await ensureParentFolders(app, filePath);
    const existing = app.vault.getAbstractFileByPath(filePath);
    if (existing instanceof TFile) {
      await app.vault.modify(existing, section.fileContent ?? '');
    } else {
      await app.vault.create(filePath, section.fileContent ?? '');
    }
    return { name, status: 'created' };
  }

  // modified
  const file = app.vault.getAbstractFileByPath(filePath);
  if (!(file instanceof TFile)) {
    return { name, status: 'error', errors: [`File not found: ${filePath}`] };
  }

  let fileContent = await app.vault.read(file);
  const errors: string[] = [];
  let hunksApplied = 0;

  for (let i = 0; i < (section.hunks?.length ?? 0); i++) {
    const r = applyHunk(fileContent, section.hunks![i]);
    if (r.success) {
      fileContent = r.content;
      hunksApplied++;
    } else {
      errors.push(`Hunk ${i + 1}: ${r.error}`);
    }
  }

  await app.vault.modify(file, fileContent);
  return {
    name,
    status: errors.length === 0 ? 'modified' : 'error',
    hunksApplied,
    errors: errors.length > 0 ? errors : undefined,
  };
}

function applyHunk(
  fileContent: string,
  hunk: string,
): { success: true; content: string } | { success: false; error: string } {
  const rawLines = hunk.split('\n');
  let trimStart = 0;
  let trimEnd = rawLines.length;
  while (trimStart < trimEnd && rawLines[trimStart] === '') trimStart++;
  while (trimEnd > trimStart && rawLines[trimEnd - 1] === '') trimEnd--;
  const hunkLines = rawLines.slice(trimStart, trimEnd);
  if (hunkLines.length === 0) return { success: false, error: 'empty hunk' };

  const fileLines = fileContent.split('\n');
  const MAX_CTX = 3;

  // Start context: longest prefix of hunk (0–3 lines) that exists in the file
  let startCtxLen = 0;
  let insertStart = 0; // file index right after the start context
  for (let len = Math.min(MAX_CTX, hunkLines.length); len >= 1; len--) {
    const pos = findAnchor(fileLines, hunkLines.slice(0, len), 0);
    if (pos !== -1) {
      startCtxLen = len;
      insertStart = pos + len;
      break;
    }
  }

  // End context: longest suffix of hunk (0–3 lines) that exists in the file
  // after insertStart, not overlapping start context
  const maxEndCtx = Math.min(MAX_CTX, hunkLines.length - startCtxLen);
  let endCtxLen = 0;
  let insertEnd = insertStart; // file index where end context begins
  for (let len = maxEndCtx; len >= 1; len--) {
    const pos = findAnchor(fileLines, hunkLines.slice(hunkLines.length - len), insertStart);
    if (pos !== -1) {
      endCtxLen = len;
      insertEnd = pos;
      break;
    }
  }

  // New content = hunk lines between start and end context
  const newContent = hunkLines.slice(startCtxLen, hunkLines.length - endCtxLen);

  const newLines = [
    ...fileLines.slice(0, insertStart),
    ...newContent,
    ...fileLines.slice(insertEnd),
  ];

  return { success: true, content: newLines.join('\n') };
}

function findAnchor(fileLines: string[], anchor: string[], from: number): number {
  outer: for (let i = from; i <= fileLines.length - anchor.length; i++) {
    for (let j = 0; j < anchor.length; j++) {
      if (fileLines[i + j] !== anchor[j]) continue outer;
    }
    return i;
  }
  return -1;
}
