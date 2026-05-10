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
