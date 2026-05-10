import { readFileSync } from 'fs';
import { join } from 'path';
import { execPromise } from '../../utils';
import { SEP, SEP2, FileChangeType, FileEntry, FormatResult } from './types';

export async function formatFolderDiff(
  vaultBasePath: string,
  folderRelPath: string,
): Promise<FormatResult> {
  const folderArg = folderRelPath ? `${folderRelPath}/` : '.';
  const sections: string[] = [];
  const files: FileEntry[] = [];

  // Tracked changes (modified, deleted, staged-new)
  const { stdout } = await execPromise(
    `git -C "${vaultBasePath}" diff HEAD -U3 -- "${folderArg}"`,
  );
  if (stdout.trim()) {
    for (const block of splitDiffBlocks(stdout)) {
      const parsed = parseBlock(block, folderRelPath);
      if (!parsed) continue;
      files.push({ name: parsed.name, type: parsed.type });
      sections.push(buildSection(parsed.name, parsed.type, parsed.hunks, parsed.newContent));
    }
  }

  // Untracked files (new files not yet staged)
  const { stdout: untrackedOut } = await execPromise(
    `git -C "${vaultBasePath}" ls-files --others --exclude-standard -- "${folderArg}"`,
  );
  const prefix = folderRelPath ? `${folderRelPath}/` : '';
  for (const repoRelPath of untrackedOut.trim().split('\n').filter(Boolean)) {
    const relPath = repoRelPath.startsWith(prefix) ? repoRelPath.slice(prefix.length) : repoRelPath;
    const name = relPath.endsWith('.md') ? relPath.slice(0, -3) : relPath;
    let newContent: string;
    try {
      newContent = readFileSync(join(vaultBasePath, repoRelPath), 'utf8');
    } catch {
      continue;
    }
    files.push({ name, type: 'new' });
    sections.push(buildSection(name, 'new', [], newContent));
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
