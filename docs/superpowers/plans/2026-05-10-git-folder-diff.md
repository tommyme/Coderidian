# Git Folder Diff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `[Git] Copy Folder Diff` and `[Git] Apply Folder Diff` commands — the first generates a custom-formatted diff of the current note's folder and shows it in an interactive popup; the second accepts a pasted diff and applies it to the current folder.

**Architecture:** A formatter module shells out to `git diff HEAD -U3` and converts the output to a custom text format; an applier parses that format and writes to vault files via the Obsidian API. Two `Modal` subclasses provide the UIs: a copy modal with a sidebar file tree + editable textarea, and an apply modal with a paste area + result view.

**Tech Stack:** TypeScript, Obsidian Plugin API (`Modal`, `TFile`, `App`, `Notice`), Node.js `child_process.exec` (via `execPromise` from `utils.ts`), `navigator.clipboard`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/services/git-diff/types.ts` | Create | Shared types and `\x1e` constants |
| `src/services/git-diff/git-diff-formatter.ts` | Create | `git diff HEAD` → custom format string + file list |
| `src/services/git-diff/git-diff-applier.ts` | Create | Custom format string → vault file operations |
| `src/services/git-diff/git-diff-modal.ts` | Create | Copy popup: sidebar tree + editable textarea |
| `src/services/git-diff/git-apply-modal.ts` | Create | Apply popup: paste textarea + result view |
| `src/commands.ts` | Modify | Register two new `[Git]` commands |
| `styles.css` | Modify | Styles for modal layouts |

---

## Format Reference

```
)filename(           ← file separator; path relative to diffed folder, .md stripped
\x1e\x1e            ← line 1 of new file section
full file content
\x1e\x1e            ← last line of new file section

)another-file(
\x1e                ← start of modified file
context before 1
context before 2
context before 3
new content line
context after 1
context after 2
context after 3
\x1e                ← hunk separator (also: last line = end of section)
second hunk content
\x1e

)deleted-note(      ← empty body = deleted file
)next-file(
...
```

Parsing rules (applied to body between consecutive `)name(` lines):
- Body empty → **deleted**
- First non-empty line is `\x1e\x1e` → **new file** (content between outer `\x1e\x1e` markers)
- First non-empty line is `\x1e` → **modified** (split interior by `\x1e` lines = hunks)

---

## Task 1: Types and Constants

**Files:**
- Create: `src/services/git-diff/types.ts`

- [ ] **Step 1: Write `types.ts`**

```typescript
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
```

- [ ] **Step 2: Compile and verify no errors**

```bash
pnpm compile
```

Expected: exits 0, `dist/main.js` updated.

- [ ] **Step 3: Commit**

```bash
git add src/services/git-diff/types.ts
git commit -m "feat(git-diff): add shared types and SEP constants"
```

---

## Task 2: Formatter

**Files:**
- Create: `src/services/git-diff/git-diff-formatter.ts`

- [ ] **Step 1: Write `git-diff-formatter.ts`**

```typescript
import { execPromise } from '../../utils';
import { SEP, SEP2, FileChangeType, FileEntry, FormatResult } from './types';

export async function formatFolderDiff(
  vaultBasePath: string,
  folderRelPath: string,
): Promise<FormatResult> {
  const folderArg = folderRelPath ? `${folderRelPath}/` : '.';
  const { stdout } = await execPromise(
    `git -C "${vaultBasePath}" diff HEAD -U3 -- "${folderArg}"`,
  );

  if (!stdout.trim()) return { content: '', files: [] };

  const blocks = splitDiffBlocks(stdout);
  const sections: string[] = [];
  const files: FileEntry[] = [];

  for (const block of blocks) {
    const parsed = parseBlock(block, folderRelPath);
    if (!parsed) continue;
    files.push({ name: parsed.name, type: parsed.type });
    sections.push(buildSection(parsed.name, parsed.type, parsed.hunks, parsed.newContent));
  }

  return { content: sections.join('\n'), files };
}

function splitDiffBlocks(raw: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith('diff --git ') && current.length > 0) {
      blocks.push(current.join('\n'));
      current = [];
    }
    current.push(line);
  }
  if (current.length > 0) blocks.push(current.join('\n'));
  return blocks;
}

interface ParsedBlock {
  name: string;
  type: FileChangeType;
  hunks: string[];       // non-empty only for 'modified'
  newContent: string;    // non-empty only for 'new'
}

function parseBlock(block: string, folderRelPath: string): ParsedBlock | null {
  const firstLine = block.split('\n')[0];
  // "diff --git a/<path> b/<path>"
  const m = firstLine.match(/^diff --git a\/.+ b\/(.+)$/);
  if (!m) return null;
  const repoRelPath = m[1];

  const prefix = folderRelPath ? `${folderRelPath}/` : '';
  const relPath = repoRelPath.startsWith(prefix)
    ? repoRelPath.slice(prefix.length)
    : repoRelPath;
  const name = relPath.endsWith('.md') ? relPath.slice(0, -3) : relPath;

  const type: FileChangeType = block.includes('\nnew file mode ')
    ? 'new'
    : block.includes('\ndeleted file mode ')
    ? 'deleted'
    : 'modified';

  const lines = block.split('\n');

  if (type === 'new') {
    const newContent = lines
      .filter(l => l.startsWith('+') && !l.startsWith('+++'))
      .map(l => l.slice(1))
      .join('\n');
    return { name, type, hunks: [], newContent };
  }

  if (type === 'deleted') {
    return { name, type, hunks: [], newContent: '' };
  }

  // modified — parse hunks
  const hunks = parseHunks(lines);
  return { name, type, hunks, newContent: '' };
}

function parseHunks(lines: string[]): string[] {
  const hunks: string[] = [];
  let currentHunk: string[] | null = null;

  for (const line of lines) {
    if (line.startsWith('@@ ')) {
      if (currentHunk !== null && currentHunk.length > 0) {
        hunks.push(currentHunk.join('\n'));
      }
      currentHunk = [];
    } else if (currentHunk !== null) {
      if (line.startsWith('-') || line.startsWith('\\ ')) continue;
      if (line.startsWith(' ') || line.startsWith('+')) {
        currentHunk.push(line.slice(1));
      }
    }
  }
  if (currentHunk !== null && currentHunk.length > 0) {
    hunks.push(currentHunk.join('\n'));
  }
  return hunks;
}

function buildSection(
  name: string,
  type: FileChangeType,
  hunks: string[],
  newContent: string,
): string {
  const header = `)${name}(`;
  if (type === 'deleted') return header;
  if (type === 'new') return `${header}\n${SEP2}\n${newContent}\n${SEP2}`;
  // modified
  return `${header}\n${SEP}\n${hunks.join(`\n${SEP}\n`)}\n${SEP}`;
}
```

- [ ] **Step 2: Compile**

```bash
pnpm compile
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/services/git-diff/git-diff-formatter.ts
git commit -m "feat(git-diff): implement git diff formatter"
```

---

## Task 3: Applier

**Files:**
- Create: `src/services/git-diff/git-diff-applier.ts`

- [ ] **Step 1: Write `git-diff-applier.ts`**

```typescript
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
  const hunkLines = hunk.split('\n').filter(l => l !== '');
  if (hunkLines.length === 0) return { success: false, error: 'empty hunk' };

  const fileLines = fileContent.split('\n');

  // Start anchor: first ≤3 lines of hunk
  const startAnchor = hunkLines.slice(0, Math.min(3, hunkLines.length));
  // End anchor: last ≤3 lines of hunk (avoid overlapping start anchor)
  const endAnchorStart = Math.max(startAnchor.length, hunkLines.length - 3);
  const endAnchor = hunkLines.slice(endAnchorStart);

  const startIdx = findAnchor(fileLines, startAnchor, 0);
  if (startIdx === -1) return { success: false, error: 'start anchor not found' };

  const endIdx =
    endAnchor.length > 0
      ? findAnchor(fileLines, endAnchor, startIdx)
      : startIdx + startAnchor.length - 1;
  if (endIdx === -1) return { success: false, error: 'end anchor not found' };

  const endExclusive = endIdx + (endAnchor.length || 0);

  const newLines = [
    ...fileLines.slice(0, startIdx),
    ...hunkLines,
    ...fileLines.slice(endExclusive),
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
```

- [ ] **Step 2: Compile**

```bash
pnpm compile
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/services/git-diff/git-diff-applier.ts
git commit -m "feat(git-diff): implement diff applier with anchor-based hunk patching"
```

---

## Task 4: Copy Modal + CSS

**Files:**
- Create: `src/services/git-diff/git-diff-modal.ts`
- Modify: `styles.css` (append)

- [ ] **Step 1: Write `git-diff-modal.ts`**

```typescript
import { App, Modal } from 'obsidian';
import { FileEntry } from './types';

export class GitDiffModal extends Modal {
  private content: string;
  private files: FileEntry[];
  private folderName: string;

  constructor(app: App, content: string, files: FileEntry[], folderName: string) {
    super(app);
    this.content = content;
    this.files = files;
    this.folderName = folderName;
  }

  onOpen(): void {
    this.modalEl.addClass('coderidian-git-diff-modal');
    const { contentEl } = this;

    // Header
    const header = contentEl.createDiv({ cls: 'coderidian-git-header' });
    header.createSpan({ text: `Folder Diff: ${this.folderName}` });
    const copyBtn = header.createEl('button', { text: '复制全部' });

    // Body: sidebar + textarea
    const body = contentEl.createDiv({ cls: 'coderidian-git-modal-body' });
    const sidebar = body.createDiv({ cls: 'coderidian-git-sidebar' });
    const textarea = body.createEl('textarea', { cls: 'coderidian-git-textarea' });
    textarea.value = this.content;
    textarea.spellcheck = false;

    copyBtn.addEventListener('click', async () => {
      await navigator.clipboard.writeText(textarea.value);
      copyBtn.setText('Copied!');
      setTimeout(() => copyBtn.setText('复制全部'), 1500);
    });

    this.renderTree(sidebar, textarea);
  }

  onClose(): void {
    this.contentEl.empty();
  }

  // ── Tree ────────────────────────────────────────────────────────────────────

  private renderTree(container: HTMLElement, textarea: HTMLTextAreaElement): void {
    const root = buildTreeNodes(this.files);
    renderLevel(container, root, textarea, 0);
  }
}

// ── Tree data structure ───────────────────────────────────────────────────────

interface TreeNode {
  label: string;
  name: string;        // full relative name (for content operations)
  children: TreeNode[];
  isDir: boolean;
}

function buildTreeNodes(files: FileEntry[]): TreeNode[] {
  const root: TreeNode[] = [];

  for (const file of files) {
    const parts = file.name.split('/');
    insertNode(root, parts, file.name, 0);
  }

  return root;
}

function insertNode(
  nodes: TreeNode[],
  parts: string[],
  fullName: string,
  depth: number,
): void {
  const label = parts[depth];

  if (depth === parts.length - 1) {
    nodes.push({ label, name: fullName, children: [], isDir: false });
    return;
  }

  // Find or create folder node
  let folder = nodes.find(n => n.isDir && n.label === label);
  if (!folder) {
    folder = { label, name: parts.slice(0, depth + 1).join('/'), children: [], isDir: true };
    nodes.push(folder);
  }
  insertNode(folder.children, parts, fullName, depth + 1);
}

function collectLeaves(node: TreeNode): TreeNode[] {
  if (!node.isDir) return [node];
  return node.children.flatMap(collectLeaves);
}

// ── Tree rendering ────────────────────────────────────────────────────────────

function renderLevel(
  container: HTMLElement,
  nodes: TreeNode[],
  textarea: HTMLTextAreaElement,
  depth: number,
): void {
  for (const node of nodes) {
    renderNode(container, node, textarea, depth);
  }
}

function renderNode(
  container: HTMLElement,
  node: TreeNode,
  textarea: HTMLTextAreaElement,
  depth: number,
): void {
  const row = container.createDiv({ cls: 'coderidian-git-tree-row' });
  row.style.paddingLeft = `${depth * 14}px`;

  if (node.isDir) {
    let collapsed = true;
    const toggle = row.createSpan({ text: '▶ ', cls: 'coderidian-git-tree-toggle' });
    row.createSpan({ text: node.label + '/' });

    const childrenEl = container.createDiv({ cls: 'coderidian-git-tree-children' });
    childrenEl.style.display = 'none';
    renderLevel(childrenEl, node.children, textarea, depth + 1);

    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      collapsed = !collapsed;
      childrenEl.style.display = collapsed ? 'none' : 'block';
      toggle.setText(collapsed ? '▶ ' : '▼ ');
    });
    row.addEventListener('click', () => {
      collapsed = !collapsed;
      childrenEl.style.display = collapsed ? 'none' : 'block';
      toggle.setText(collapsed ? '▶ ' : '▼ ');
    });

    const delBtn = row.createEl('button', { text: '×', cls: 'coderidian-git-tree-delete' });
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      for (const leaf of collectLeaves(node)) {
        textarea.value = removeSection(textarea.value, leaf.name);
      }
      row.remove();
      childrenEl.remove();
    });
  } else {
    row.createSpan({ text: node.label });
    row.addEventListener('click', () => selectSection(textarea, node.name));

    const delBtn = row.createEl('button', { text: '×', cls: 'coderidian-git-tree-delete' });
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      textarea.value = removeSection(textarea.value, node.name);
      row.remove();
    });
  }
}

// ── Content operations ────────────────────────────────────────────────────────

const FILE_HEADER_RE = /^\)[^(]+\($/;

function removeSection(content: string, name: string): string {
  const lines = content.split('\n');
  const headerLine = `)${name}(`;
  const startIdx = lines.findIndex(l => l === headerLine);
  if (startIdx === -1) return content;

  const endIdx = lines.findIndex((l, i) => i > startIdx && FILE_HEADER_RE.test(l));
  const removeUntil = endIdx === -1 ? lines.length : endIdx;

  return [...lines.slice(0, startIdx), ...lines.slice(removeUntil)].join('\n');
}

function selectSection(textarea: HTMLTextAreaElement, name: string): void {
  const lines = textarea.value.split('\n');
  const headerLine = `)${name}(`;

  const startLineIdx = lines.findIndex(l => l === headerLine);
  if (startLineIdx === -1) return;

  const endLineIdx = lines.findIndex((l, i) => i > startLineIdx && FILE_HEADER_RE.test(l));
  const endLine = endLineIdx === -1 ? lines.length : endLineIdx;

  // Compute character offsets
  let startChar = 0;
  for (let i = 0; i < startLineIdx; i++) startChar += lines[i].length + 1;
  let endChar = startChar;
  for (let i = startLineIdx; i < endLine; i++) endChar += lines[i].length + 1;

  textarea.focus();
  textarea.setSelectionRange(startChar, Math.min(endChar, textarea.value.length));

  const lineHeight = parseInt(window.getComputedStyle(textarea).lineHeight) || 20;
  textarea.scrollTop = startLineIdx * lineHeight;
}
```

- [ ] **Step 2: Append CSS to `styles.css`**

```css
/* ── Git Diff Modal ────────────────────────────────────────────────────────── */

.coderidian-git-diff-modal {
  width: 90vw;
  max-width: 1200px;
}

.coderidian-git-diff-modal .modal-content {
  display: flex;
  flex-direction: column;
  height: 75vh;
  padding: 0;
}

.coderidian-git-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid var(--background-modifier-border);
  font-weight: 600;
  flex-shrink: 0;
}

.coderidian-git-modal-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.coderidian-git-sidebar {
  width: 220px;
  flex-shrink: 0;
  overflow-y: auto;
  border-right: 1px solid var(--background-modifier-border);
  padding: 8px 0;
  font-size: 13px;
}

.coderidian-git-tree-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 3px 8px;
  cursor: pointer;
  border-radius: 4px;
  margin: 1px 4px;
  user-select: none;
}

.coderidian-git-tree-row:hover {
  background: var(--background-secondary);
}

.coderidian-git-tree-delete {
  opacity: 0;
  padding: 0 4px;
  line-height: 1;
  font-size: 14px;
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: 3px;
  flex-shrink: 0;
}

.coderidian-git-tree-row:hover .coderidian-git-tree-delete {
  opacity: 1;
}

.coderidian-git-tree-delete:hover {
  background: var(--background-modifier-error);
  color: var(--text-on-accent);
}

.coderidian-git-textarea {
  flex: 1;
  resize: none;
  border: none;
  outline: none;
  padding: 12px;
  font-family: var(--font-monospace);
  font-size: 13px;
  line-height: 1.5;
  background: var(--background-primary);
  color: var(--text-normal);
  overflow-y: auto;
}

/* ── Git Apply Modal ───────────────────────────────────────────────────────── */

.coderidian-git-apply-modal .modal-content {
  display: flex;
  flex-direction: column;
  height: 60vh;
  padding: 0;
}

.coderidian-git-apply-area {
  flex: 1;
  resize: none;
  border: none;
  outline: none;
  padding: 12px;
  font-family: var(--font-monospace);
  font-size: 13px;
  line-height: 1.5;
  background: var(--background-primary);
  color: var(--text-normal);
}

.coderidian-git-apply-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 16px;
  border-top: 1px solid var(--background-modifier-border);
  flex-shrink: 0;
}

.coderidian-git-apply-results {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
  font-size: 13px;
}

.coderidian-git-apply-result-row {
  padding: 4px 0;
  display: flex;
  gap: 8px;
}

.coderidian-git-apply-result-row.error {
  color: var(--text-error);
}

.coderidian-git-apply-result-errors {
  font-size: 11px;
  color: var(--text-muted);
  padding-left: 24px;
}
```

- [ ] **Step 3: Compile**

```bash
pnpm compile
```

Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/services/git-diff/git-diff-modal.ts styles.css
git commit -m "feat(git-diff): add copy modal with sidebar tree and textarea"
```

---

## Task 5: Apply Modal

**Files:**
- Create: `src/services/git-diff/git-apply-modal.ts`

- [ ] **Step 1: Write `git-apply-modal.ts`**

```typescript
import { App, Modal } from 'obsidian';
import { applyFolderDiff } from './git-diff-applier';
import { ApplyResult } from './types';

export class GitApplyModal extends Modal {
  private folderPath: string;
  private folderName: string;

  constructor(app: App, folderPath: string) {
    super(app);
    this.folderPath = folderPath;
    this.folderName = folderPath.split('/').pop() ?? folderPath || 'vault root';
  }

  onOpen(): void {
    this.modalEl.addClass('coderidian-git-apply-modal');
    const { titleEl, contentEl } = this;
    titleEl.setText(`Apply Diff → ${this.folderName}`);
    this.renderInputView(contentEl);
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private renderInputView(contentEl: HTMLElement): void {
    contentEl.empty();

    const textarea = contentEl.createEl('textarea', {
      cls: 'coderidian-git-apply-area',
      attr: { placeholder: 'Paste diff content here…', spellcheck: 'false' },
    });

    const footer = contentEl.createDiv({ cls: 'coderidian-git-apply-footer' });
    const cancelBtn = footer.createEl('button', { text: '取消' });
    const applyBtn = footer.createEl('button', { text: '应用', cls: 'mod-cta' });

    cancelBtn.addEventListener('click', () => this.close());

    applyBtn.addEventListener('click', async () => {
      const content = textarea.value.trim();
      if (!content) return;

      applyBtn.setAttr('disabled', 'true');
      applyBtn.setText('应用中…');

      const results = await applyFolderDiff(this.app, this.folderPath, content);
      this.renderResultView(contentEl, results);
    });
  }

  private renderResultView(contentEl: HTMLElement, results: ApplyResult[]): void {
    contentEl.empty();

    const resultsEl = contentEl.createDiv({ cls: 'coderidian-git-apply-results' });

    for (const r of results) {
      const icon =
        r.status === 'created' ? '✅' :
        r.status === 'deleted' ? '🗑️' :
        r.status === 'modified' ? '✅' : '⚠️';

      const detail =
        r.status === 'created' ? 'created' :
        r.status === 'deleted' ? 'deleted' :
        r.status === 'modified' ? `${r.hunksApplied} hunk(s) applied` :
        'error';

      const row = resultsEl.createDiv({
        cls: `coderidian-git-apply-result-row${r.status === 'error' ? ' error' : ''}`,
      });
      row.createSpan({ text: `${icon} ${r.name} — ${detail}` });

      if (r.errors?.length) {
        const errEl = resultsEl.createDiv({ cls: 'coderidian-git-apply-result-errors' });
        for (const err of r.errors) {
          errEl.createDiv({ text: err });
        }
      }
    }

    const footer = contentEl.createDiv({ cls: 'coderidian-git-apply-footer' });
    footer.createEl('button', { text: '关闭', cls: 'mod-cta' }).addEventListener('click', () =>
      this.close(),
    );
  }
}
```

- [ ] **Step 2: Compile**

```bash
pnpm compile
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/services/git-diff/git-apply-modal.ts
git commit -m "feat(git-diff): add apply modal with result view"
```

---

## Task 6: Register Commands

**Files:**
- Modify: `src/commands.ts`

- [ ] **Step 1: Add imports at the top of `commands.ts`**

Add after the existing imports (around line 10):

```typescript
import { formatFolderDiff } from './services/git-diff/git-diff-formatter';
import { GitDiffModal } from './services/git-diff/git-diff-modal';
import { GitApplyModal } from './services/git-diff/git-apply-modal';
```

- [ ] **Step 2: Add two commands inside `registerCommands` just before the `// [FileExplorer] commands` block**

```typescript
	// [Git] commands
	plugin.addCommand({
		id: 'git-copy-folder-diff',
		name: '[Git] Copy Folder Diff',
		callback: async () => {
			const activeFile = plugin.app.workspace.getActiveFile();
			if (!activeFile) {
				new Notice('No active file');
				return;
			}
			const folderRelPath = activeFile.parent?.path ?? '';
			const vaultBasePath = (plugin.app.vault.adapter as any).basePath as string;
			const folderName = folderRelPath.split('/').pop() ?? folderRelPath || 'vault root';

			const notice = new Notice('Getting git diff…', 0);
			try {
				const result = await formatFolderDiff(vaultBasePath, folderRelPath);
				notice.hide();
				if (result.files.length === 0) {
					new Notice('No changes in this folder');
					return;
				}
				new GitDiffModal(plugin.app, result.content, result.files, folderName).open();
			} catch (e) {
				notice.hide();
				const msg = e instanceof Error ? e.message : String(e);
				new Notice(`Git error: ${msg}`);
				console.error('[git-copy-folder-diff]', e);
			}
		},
	});

	plugin.addCommand({
		id: 'git-apply-folder-diff',
		name: '[Git] Apply Folder Diff',
		callback: () => {
			const activeFile = plugin.app.workspace.getActiveFile();
			if (!activeFile) {
				new Notice('No active file');
				return;
			}
			const folderPath = activeFile.parent?.path ?? '';
			new GitApplyModal(plugin.app, folderPath).open();
		},
	});
```

- [ ] **Step 3: Compile and deploy**

```bash
pnpm compile && pnpm test
```

Expected: exits 0, plugin reloaded in Obsidian.

- [ ] **Step 4: Manual test — Copy command**

  1. Open a note in a folder that has uncommitted git changes.
  2. Open Command Palette (`Cmd+P`), run `[Git] Copy Folder Diff`.
  3. Verify: modal opens, sidebar shows files with tree structure, textarea shows formatted content.
  4. Click a file in the sidebar → verify textarea scrolls and selects that file's section.
  5. Click `×` on a file → verify it disappears from both sidebar and textarea.
  6. Click `复制全部` → verify clipboard content matches textarea.

- [ ] **Step 5: Manual test — Apply command**

  1. Open a note in a fresh folder (different machine simulation: make a copy of the diff text).
  2. Run `[Git] Apply Folder Diff`.
  3. Paste the copied diff text into the textarea.
  4. Click `应用`.
  5. Verify: result view shows status for each file (✅ created / ✅ N hunk(s) applied / 🗑️ deleted).
  6. Check that the actual vault files were created/modified/deleted correctly.

- [ ] **Step 6: Commit**

```bash
git add src/commands.ts
git commit -m "feat(git-diff): register [Git] Copy Folder Diff and Apply commands"
```
