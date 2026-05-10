# Git Folder Diff — Design Spec

**Date:** 2026-05-10  
**Status:** Approved

---

## Overview

Two new commands added to the Command Palette:

1. **`[Git] Copy Folder Diff`** — generates a custom-formatted diff of all uncommitted changes in the current note's folder and shows them in an interactive popup.
2. **`[Git] Apply Folder Diff`** — accepts a previously copied diff (pasted into a textarea) and applies it to the current note's folder.

---

## Command: Copy Folder Diff

### Trigger

Runs in the context of the active markdown note. Derives the folder path from `app.workspace.getActiveFile().parent`.

### Git Operation

```
git diff HEAD -- <folder-path>/
```

Captures all uncommitted changes (staged + unstaged) scoped to the folder.

### Output Format

The formatted output is a plain text string. File sections are delimited by:

```
)filename(
```

where `filename` is the file path **relative to the diffed folder**, with the `.md` extension stripped (other extensions kept).

#### File type encoding via `\x1E` (U+001E, ASCII Record Separator)

Each `\x1E` occupies its own line (i.e. the line contains only `\x1E` followed by a newline).

| File type | Content between `)name(` markers |
|-----------|----------------------------------|
| **New file** | `\x1E\x1E` line, full file content, `\x1E\x1E` line |
| **Modified file** | `\x1E` line, hunk₁, `\x1E` line, hunk₂, …, `\x1E` line |
| **Deleted file** | *(empty — nothing between the two file delimiters)* |

#### Modified file hunks

Each hunk shows the **new state** of the changed region with 3 lines of context on each side. Overlapping context regions are merged into a single hunk.

Apply algorithm uses the first ≤3 lines as a "start anchor" and the last ≤3 lines as an "end anchor" to locate the region in the target file, then replaces the entire region (anchors inclusive) with the hunk content.

#### Binary / unreadable files

Skipped silently; not included in the output.

#### Example output

```
)api(
\x1E\x1E
# API Documentation

Full content of new file.
\x1E\x1E
)config.json(
\x1E
context line 1
context line 2
context line 3
updated content line
context line 4
context line 5
context line 6
\x1E
context before second change
another updated line
context after second change
\x1E
)old-note(
)sub/nested(
\x1E
context lines
new content here
more context
\x1E
```

---

## Popup Modal: Copy View

### Layout

Two-column layout within an Obsidian `Modal`:

```
┌─────────────────────────────────────────────────┐
│  Folder Diff: <folder-name>            [复制全部] │
├──────────────────┬──────────────────────────────┤
│  api         [x] │                              │
│  config.json [x] │  <editable textarea>         │
│  ▶ sub/          │  (monospace font)            │
│    └ nested  [x] │                              │
│  old-note    [x] │                              │
└──────────────────┴──────────────────────────────┘
```

### Sidebar (left, ~200px fixed)

- **Tree view** of all files in the diff, organized by path hierarchy.
- Folder nodes are collapsible (▶/▼).
- Each leaf node has a **`[x]` delete button** that:
  - Removes that file's section (from its `)name(` line to just before the next `)name(` line) from the textarea content.
  - Removes the node from the tree.
- Deleting a folder node recursively removes all children and their sections.
- Clicking a file node **scrolls the textarea** to that file's `)name(` line and selects the entire section.

### Textarea (right, flex-grow)

- Editable, monospace font (`font-family: var(--font-monospace)`).
- Initialized with the formatted diff content.
- The user may freely edit before copying.

### Copy Button

- Located in the modal header.
- Copies current textarea content to clipboard via `navigator.clipboard.writeText()`.
- Shows a brief "Copied!" confirmation.

---

## Command: Apply Folder Diff

### Trigger

Runs in the context of the active markdown note. Target folder = `app.workspace.getActiveFile().parent`. All paths in the diff are resolved relative to this folder.

### Popup Modal: Apply View

```
┌──────────────────────────────────────┐
│  Apply Folder Diff                   │
│                                      │
│  ┌────────────────────────────────┐  │
│  │ paste diff content here…       │  │
│  │                                │  │
│  └────────────────────────────────┘  │
│                                      │
│              [取消]  [应用]           │
└──────────────────────────────────────┘
```

Textarea is editable. Clicking **应用** runs the apply algorithm.

### Path Resolution

When applying, `)name(` is resolved to a vault file as follows:
- If `name` contains no file extension (e.g. `api`, `sub/nested`) → append `.md` → `api.md`, `sub/nested.md`
- If `name` already has a non-`.md` extension (e.g. `config.json`) → use as-is

### Apply Algorithm

Parse the pasted content into file sections split by `)name(` lines.

For each section:

**Empty content → Delete file**  
Resolve `name` to a file path (see Path Resolution above). Delete the file. Show warning if file doesn't exist.

**Starts with `\x1E\x1E` → New file**  
Extract content between the outer `\x1E\x1E` markers. Create (or overwrite) the file.

**Starts with `\x1E` (single) → Modified file**  
Split content by `\x1E` lines into hunks. For each hunk:
1. Take first ≤3 non-empty lines as **start anchor**.
2. Take last ≤3 non-empty lines as **end anchor**.
3. Locate start anchor in the target file (exact substring match, line-by-line).
4. From that position, locate end anchor.
5. Replace lines from start of start-anchor to end of end-anchor with the full hunk content.
6. If anchor not found: report error for this hunk, skip it, continue with remaining hunks.

### Result Display

After applying, replace the modal content with a result summary:

```
✅ api — created
✅ config.json — 2 hunks applied
⚠️  sub/nested — hunk 1 failed: start anchor not found
✅ old-note — deleted
```

Close button dismisses.

---

## File Structure

```
src/services/git-diff/
├── git-diff-formatter.ts   # git diff HEAD → custom format string
├── git-diff-applier.ts     # custom format string → vault file operations
├── git-diff-modal.ts       # Copy popup (sidebar + textarea)
└── git-apply-modal.ts      # Apply popup (paste + results)
```

Commands registered in `src/commands.ts` under the `[Git]` group.

---

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| No active file | `Notice`: "No active file" |
| Folder has no git repo | `Notice`: git error message |
| No changes in folder | Modal opens with empty textarea and "No changes" notice |
| Apply: file missing for delete | Warning in result summary, continue |
| Apply: anchor not found | Warning per hunk in result summary, continue |
| Apply: file create fails | Error in result summary |
