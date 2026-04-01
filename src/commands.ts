import { Editor, MarkdownView, Notice, Platform } from 'obsidian';
import MyPlugin from './main';
import SelectionsProcessing from './services/editor-utils/selections-processing';
import EditorSelectionManipulator from './services/editor-utils/editor-selection-manipulator';
import { escapeRegExp, flipBooleanSetting, getEditorValueWithoutFrontmatter } from './services/editor-utils/editor-utils';
import { processCurrentNote } from './ai-image-analysis';
import { ConfirmModal, zipVault } from './utils';
import { existsSync } from 'fs';
import { openSectionTranslationModal } from './views/section-translation-modal';
import { HeadingLevelModal } from './views/heading-level-modal';

/**
 * Wrap selected content with HTML tags
 * @param editor Editor instance
 * @param pre Opening tag
 * @param suf Closing tag
 */
export function wrap_content(editor: Editor, pre: string, suf: string) {
	const selected = editor.getSelection();
	if (selected === '') {
		editor.replaceRange(pre + suf, editor.getCursor())
		const justifyLen = pre.length
		const newCursor = editor.getCursor()
		newCursor.ch += justifyLen
		editor.setCursor(newCursor)
	} else {
		editor.replaceSelection(pre + selected + suf);
	}
}

/**
 * Register all plugin commands
 * @param plugin MyPlugin instance
 */
export function registerCommands(plugin: MyPlugin) {
	// Open VSCode commands
	// [VSCode] commands
	plugin.addCommand({
		id: 'open-vscode',
		name: '[VSCode] Open Vault',
		callback: () => {
			plugin.openVSCode();
		}
	});

	plugin.addCommand({
		id: 'open-vscode-via-url',
		name: '[VSCode] Open Vault (via URL)',
		callback: () => {
			plugin.openVSCodeViaURL();
		}
	});

	// [Editor] commands
	plugin.addCommand({
		id: 'toggle-bold-or-sidebar',
		name: '[Editor] Toggle Bold / Sidebar',
		hotkeys: [
			{
				modifiers: ["Mod"],
				key: "b"
			}
		],
		callback: () => {
			if (plugin.isBoldMode) {
				plugin.app.commands.executeCommandById('editor:toggle-bold');
			} else {
				plugin.app.commands.executeCommandById('app:toggle-left-sidebar');
			}
		}
	});

	plugin.addCommand({
		id: 'toggle-bold-or-sidebar-switch',
		name: '[Editor] Switch Bold / Sidebar Mode',
		callback: () => plugin.toggleSidebarOrBoldMode()
	});

	plugin.addCommand({
		id: 'wrap-html-gray',
		name: '[Editor] Wrap: Gray Text',
		editorCallback: (editor: Editor, view: MarkdownView) => {
			wrap_content(editor, '<font color="#888888">', '</font>');
		}
	});

	plugin.addCommand({
		id: 'wrap-html-a',
		name: '[Editor] Wrap: Link <a>',
		editorCallback(editor, ctx) {
			wrap_content(editor, '<a href="">', '</a>');
		},
	});

	// h1~h3 title style commands
	for (let i = 1; i < 4; i++) {
		let tag_name = `h${String(i)}`;
		plugin.addCommand({
			id: `wrap-html-${tag_name}`,
			name: `[Editor] Wrap: <${tag_name}>`,
			editorCallback(editor, ctx) {
				wrap_content(editor, `<${tag_name}>`, `</${tag_name}>`);
			},
		})
	}

	plugin.addCommand({
		id: 'adjust-heading-level',
		name: '[Editor] Adjust Heading Level',
		editorCallback: (editor) => {
			new HeadingLevelModal(plugin.app, editor).open();
		},
	});

	plugin.addCommand({
		id: 'copy-selected-lf-content',
		name: '[Editor] Copy Selection with CRLF',
		async editorCallback(editor, ctx) {
			let selectedText = editor.getSelection();
			selectedText = selectedText.replace(/\n/g, '\r\n');
			await navigator.clipboard.writeText(selectedText);
		},
	});

	// [Vault] commands
	plugin.addCommand({
		id: 'zip-the-vault',
		name: '[Vault] Zip Vault',
		async editorCallback(editor, ctx) {
			const vaultPath = plugin.app.vault.adapter.basePath;
			const zipFilePath = `${vaultPath}.zip`;

			if (existsSync(zipFilePath)) {
				new ConfirmModal(plugin.app, {
					title: '确认覆盖',
					message: '目标 zip 文件已存在，是否覆盖？',
					confirmText: '覆盖',
					onConfirm: () => zipVault(vaultPath, zipFilePath, true)
				}).open();
			} else {
				await zipVault(vaultPath, zipFilePath, false);
			}
		},
	});

	// [Editor] Translate section at cursor
	plugin.addCommand({
		id: 'translate-section-at-cursor',
		name: '[Editor] Translate Section at Cursor',
		editorCallback: async (editor: Editor) => {
			await openSectionTranslationModal(plugin.app, editor);
		},
	});

	// [Image] commands
	plugin.addCommand({
		id: 'analyze-note-with-ai',
		name: '[Image] Analyze Note Images with AI',
		callback: async () => { await processCurrentNote(plugin.app); }
	});

	// [Similarity] commands
	plugin.addCommand({
		id: 'embed-test-current',
		name: '[Similarity] Test Embed Current File',
		callback: async () => {
			if (!plugin.noteSimilarityService) {
				new Notice('Note Similarity is not enabled. Enable it in Settings first.');
				return;
			}
			const notice = new Notice('Embedding current file…', 0);
			try {
				const result = await plugin.noteSimilarityService.testEmbedCurrentFile();
				notice.hide();
				new Notice(`✅ Embed succeeded! ${result.chunks} chunks, dims: ${result.dims}, time: ${result.durationMs}ms\nPreview: ${result.textPreview}`, 10000);
				console.log('[EmbedTest] result:', result);
			} catch (e) {
				notice.hide();
				const msg = e instanceof Error ? e.message : String(e);
				new Notice(`❌ Embed failed: ${msg}`, 10000);
				console.error('[EmbedTest] Error:', e);
				if (e instanceof Error) console.error('[EmbedTest] Stack:', e.stack);
			}
		},
	});

	plugin.addCommand({
		id: 'open-similar-notes',
		name: '[Similarity] Open Related Notes Panel',
		callback: () => plugin.openSimilarNotesView(),
	});

	plugin.addCommand({
		id: 'reindex-all-notes',
		name: '[Similarity] Reindex All Notes',
		callback: async () => {
			if (!plugin.noteSimilarityService) {
				new Notice('Note Similarity is not enabled. Enable it in Settings first.');
				return;
			}
			await plugin.noteSimilarityService.reindexAll(
				plugin.settings.embeddingExcludeFolders,
			);
		},
	});

	plugin.addCommand({
		id: 'find-similar-notes',
		name: '[Similarity] Find Similar Notes',
		callback: async () => {
			if (!plugin.noteSimilarityService) {
				new Notice('Note Similarity is not enabled. Enable it in Settings first.');
				return;
			}
			const activeFile = plugin.app.workspace.getActiveFile();
			if (!activeFile) {
				new Notice('No active file.');
				return;
			}
			const notice = new Notice('正在查找…', 0);
			try {
				const results = await plugin.noteSimilarityService.findSimilar(activeFile, plugin.settings.similarNotesLimit);
				notice.hide();
				console.log('[find-similar-notes]', results);
				new Notice(
					results.length > 0
						? `✅ 找到 ${results.length} 条相关笔记`
						: '🔍 未找到相关笔记',
					3000,
				);
			} catch (e) {
				notice.hide();
				new Notice(`❌ 失败：${e instanceof Error ? e.message : String(e)}`);
			}
		},
	});

	// [Debug] commands
	plugin.addCommand({
		id: 'debug-expose-similarity',
		name: '[Debug] Expose Note Similarity to window.__coderidian',
		callback: () => {
			(window as any).__coderidian = {
				service: plugin.noteSimilarityService,
				get store() { return plugin.noteSimilarityService?.getStore(); },
				get notes() { return plugin.noteSimilarityService?.getStore().notes; },
				status() { return plugin.noteSimilarityService?.getIndexStatus(); },
			};
			new Notice('✅ window.__coderidian mounted. Type __coderidian in the console.', 5000);
			console.log('[Debug] window.__coderidian =', (window as any).__coderidian);
		},
	});

	// HTTP Interceptor: Test request
	plugin.addCommand({
		id: 'http-interceptor-test',
		name: '[Debug] HTTP Interceptor: Test Request',
		callback: async () => {
			new Notice('Sending GET and POST requests...', 0);
			try {
				// Send GET request
				const getResponse = await (globalThis as any).requestUrl({
					url: 'https://httpbin.org/get?foo=bar&test=123',
					method: 'GET',
					headers: {
						'X-Test-Header': 'Coderidian-Test'
					}
				});
				// Send POST request
				const postResponse = await (globalThis as any).requestUrl({
					url: 'https://httpbin.org/post',
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'X-Test-Header': 'Coderidian-Post'
					},
					body: JSON.stringify({
						name: 'Coderidian',
						features: ['interceptor', 'cache', 'retry']
					})
				});
			} catch (err) {
				new Notice(`Request failed: ${err instanceof Error ? err.message : String(err)}`);
				console.error('[Test] Error:', err);
			}
		}
	});

	// [Terminal] commands
	const terminalNotReady = () => new Notice('Terminal is initializing, please try again in a moment.', 3000);

	plugin.addCommand({
		id: 'terminal-open',
		name: '[Terminal] Open terminal',
		callback: () => plugin.terminalService ? plugin.terminalService.openTerminal() : terminalNotReady(),
	});

	plugin.addCommand({
		id: 'terminal-open-bottom',
		name: '[Terminal] Open terminal — Bottom split',
		callback: () => plugin.terminalService ? plugin.terminalService.openTerminal('bottom', true) : terminalNotReady(),
	});

	plugin.addCommand({
		id: 'terminal-open-right',
		name: '[Terminal] Open terminal — Right sidebar',
		callback: () => plugin.terminalService ? plugin.terminalService.openTerminal('right', true) : terminalNotReady(),
	});

	plugin.addCommand({
		id: 'terminal-open-tab',
		name: '[Terminal] Open terminal — New tab',
		callback: () => plugin.terminalService ? plugin.terminalService.openTerminal('tab', true) : terminalNotReady(),
	});

	plugin.addCommand({
		id: 'terminal-open-window',
		name: '[Terminal] Open terminal — Floating window',
		callback: () => plugin.terminalService ? plugin.terminalService.openTerminal('window', true) : terminalNotReady(),
	});

	// [Editor] Expand line selection (VSCode Cmd+L)
	plugin.addCommand({
		id: 'expand-line-selection',
		name: '[Editor] Expand Line Selection',
		repeatable: true,
		hotkeys: [{ modifiers: ['Mod'], key: 'l' }],
		editorCallback: (editor: Editor) => {
			const lastLine = editor.lastLine();
			const newSelections = editor.listSelections().map(({ anchor, head }) => {
				// Normalize: a <= h
				const [a, h] = (anchor.line < head.line || (anchor.line === head.line && anchor.ch <= head.ch))
					? [anchor, head] : [head, anchor];

				const isCaret = a.line === h.line && a.ch === h.ch;
				// "Whole-line" selection: anchor at col 0, head at col 0 of some line
				// (or at very end of document)
				const isWholeLine = !isCaret && a.ch === 0 &&
					(h.ch === 0 || (h.line === lastLine && h.ch === editor.getLine(lastLine).length));

				if (isWholeLine) {
					// Extend by one more line
					if (h.line < lastLine) {
						return { anchor: a, head: { line: h.line + 1, ch: 0 } };
					}
					// Already at document end — extend to end of last line
					return { anchor: a, head: { line: lastLine, ch: editor.getLine(lastLine).length } };
				}
				// Select current line: col 0 → start of next line (handles empty lines uniformly)
				return {
					anchor: { line: a.line, ch: 0 },
					head: a.line < lastLine
						? { line: a.line + 1, ch: 0 }
						: { line: a.line, ch: editor.getLine(a.line).length },
				};
			});
			editor.setSelections(newSelections);
		},
	});

	// [Settings] toggles
	plugin.addCommand({
		id: 'toggle-line-numbers',
		name: '[Settings] Toggle Line Numbers',
		callback: () => flipBooleanSetting(plugin.app, 'showLineNumber'),
	});

	plugin.addCommand({
		id: 'toggle-readable-line-width',
		name: '[Settings] Toggle Readable Line Width',
		callback: () => flipBooleanSetting(plugin.app, 'readableLineLength'),
	});

	plugin.addCommand({
		id: 'toggle-inline-title',
		name: '[Settings] Toggle Inline Title',
		callback: () => flipBooleanSetting(plugin.app, 'showInlineTitle'),
	});

	// [Editor] Text transforms
	plugin.addCommand({
		id: 'uppercase-selection',
		name: '[Editor] Uppercase Selection',
		editorCallback: (editor: Editor) => SelectionsProcessing.selectionsReplacer(editor, (s) => s.toUpperCase()),
	});

	plugin.addCommand({
		id: 'lowercase-selection',
		name: '[Editor] Lowercase Selection',
		editorCallback: (editor: Editor) => SelectionsProcessing.selectionsReplacer(editor, (s) => s.toLowerCase()),
	});

	plugin.addCommand({
		id: 'titlecase-selection',
		name: '[Editor] Titlecase Selection',
		editorCallback: (editor: Editor) =>
			SelectionsProcessing.selectionsReplacer(editor, (s) =>
				s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()),
			),
	});

	plugin.addCommand({
		id: 'toggle-kebab-case',
		name: '[Editor] Toggle Kebab-case',
		editorCallback: (editor: Editor) => SelectionsProcessing.convertOneToOtherChars(editor, '-', ' '),
	});

	plugin.addCommand({
		id: 'toggle-snake-case',
		name: '[Editor] Toggle Snake_case',
		editorCallback: (editor: Editor) => SelectionsProcessing.convertOneToOtherChars(editor, '_', ' '),
	});

	// [Editor] Line manipulation
	plugin.addCommand({
		id: 'move-lines-up',
		name: '[Editor] Move Lines Up',
		repeatable: true,
		hotkeys: [{ modifiers: ['Alt'], key: 'ArrowUp' }],
		editorCallback: (editor: Editor) => moveLines(editor, -1, 0),
	});

	plugin.addCommand({
		id: 'move-lines-down',
		name: '[Editor] Move Lines Down',
		repeatable: true,
		hotkeys: [{ modifiers: ['Alt'], key: 'ArrowDown' }],
		editorCallback: (editor: Editor) => moveLines(editor, 1, editor.lastLine()),
	});

	plugin.addCommand({
		id: 'duplicate-line-up',
		name: '[Editor] Duplicate Line Up',
		repeatable: true,
		hotkeys: [{ modifiers: ['Shift', 'Alt'], key: 'ArrowUp' }],
		editorCallback: (editor: Editor) => duplicateLine(editor, -1),
	});

	plugin.addCommand({
		id: 'duplicate-line-down',
		name: '[Editor] Duplicate Line Down',
		repeatable: true,
		hotkeys: [{ modifiers: ['Shift', 'Alt'], key: 'ArrowDown' }],
		editorCallback: (editor: Editor) => duplicateLine(editor, 1),
	});

	plugin.addCommand({
		id: 'join-selected-lines',
		name: '[Editor] Join Selected Lines',
		hotkeys: [{ modifiers: ['Mod'], key: 'j' }],
		editorCallback: (editor: Editor) => joinLines(editor),
	});

	// [Editor] Multi-cursor
	plugin.addCommand({
		id: 'add-caret-above',
		name: '[Editor] Add Caret Above',
		repeatable: true,
		hotkeys: [{ modifiers: ['Mod', 'Alt'], key: 'ArrowUp' }],
		editorCallback: (editor: Editor) => addCarets(editor, -1, 0),
	});

	plugin.addCommand({
		id: 'add-caret-below',
		name: '[Editor] Add Caret Below',
		repeatable: true,
		hotkeys: [{ modifiers: ['Mod', 'Alt'], key: 'ArrowDown' }],
		editorCallback: (editor: Editor) => addCarets(editor, 1, editor.lineCount()),
	});

	plugin.addCommand({
		id: 'select-next-word-instance',
		name: '[Editor] Select Next Word Instance',
		hotkeys: [{ modifiers: ['Mod'], key: 'd' }],
		editorCallback: (editor: Editor, view: MarkdownView) => selectNextWordInstance(editor, view),
	});

	plugin.addCommand({
		id: 'select-all-word-instances',
		name: '[Editor] Select All Word Instances',
		hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'l' }],
		editorCallback: (editor: Editor, view: MarkdownView) => selectAllWordInstances(editor, view),
	});

	plugin.addCommand({
		id: 'trim-selection-lines',
		name: '[Editor] Trim Selection Lines',
		editorCallback: (editor: Editor) =>
			SelectionsProcessing.selectionsReplacer(editor, (s) =>
				s.split('\n').map((line) => line.trim()).join('\n'),
			),
	});

	plugin.addCommand({
		id: 'start-select',
		name: '[Editor] Start Select (Set Mark)',
		editorCallback: (editor: Editor) => {
			plugin.selectionMark = editor.getCursor();
			new Notice('Mark set');
		},
	});

	plugin.addCommand({
		id: 'end-select',
		name: '[Editor] End Select (Select to Mark)',
		editorCallback: (editor: Editor) => {
			if (!plugin.selectionMark) {
				new Notice('No mark set — use "Start Select" first');
				return;
			}
			editor.setSelection(plugin.selectionMark, editor.getCursor());
			plugin.selectionMark = null;
		},
	});

	// [FileExplorer] commands
	plugin.addCommand({
		id: 'toggle-file-hider',
		name: '[FileExplorer] Toggle File Hiding',
		callback: () => {
			plugin.settings.fileHiderEnabled = !plugin.settings.fileHiderEnabled;
			plugin.fileHiderService?.setEnabled(plugin.settings.fileHiderEnabled);
			plugin.saveSettings();
			new Notice(plugin.settings.fileHiderEnabled ? 'File hiding enabled' : 'File hiding disabled');
		},
	});
}

// ── Editor command helpers ────────────────────────────────────────────────────

function moveLines(editor: Editor, direction: number, border: number): void {
	SelectionsProcessing.selectionsProcessorTransaction(editor, (sel) => {
		const norm = sel.asNormalized();
		if (direction === 1 ? norm.head.line === border : norm.anchor.line === border) {
			return { finalSelection: sel };
		}
		const replaceSel = norm
			.moveLines(direction === -1 ? direction : 0, direction === 1 ? direction : 0)
			.expand();
		let replaceText = replaceSel.getText();
		if (sel.isCaret()) {
			replaceText = replaceText.split('\n').reverse().join('\n');
		} else {
			const lines = replaceText.split('\n');
			if (direction === 1) {
				lines.unshift(lines.pop()!);
			} else {
				lines.push(lines.shift()!);
			}
			replaceText = lines.join('\n');
		}
		return { replaceSelection: replaceSel, replaceText, finalSelection: sel.clone().moveLines(direction) };
	});
}

function duplicateLine(editor: Editor, direction: number): void {
	SelectionsProcessing.selectionsProcessorTransaction(editor, (sel) => {
		const expanded = sel.clone().normalize().expand();
		return {
			finalSelection: direction > 0 ? sel.clone().moveLines(sel.clone().normalize().linesCount) : sel.clone(),
			replaceSelection: expanded,
			replaceText: expanded.getText() + '\n' + expanded.getText(),
		};
	});
}

function joinLines(editor: Editor): void {
	SelectionsProcessing.selectionsProcessorTransaction(
		editor,
		(sel) => {
			if (sel.isCaret() || sel.isOneLine()) {
				if (sel.anchor.line === editor.lastLine()) {
					return { finalSelection: sel, replaceSelection: sel, replaceText: sel.getText() };
				}
				if (sel.isOneLine() && !sel.isCaret()) {
					return {
						finalSelection: sel.clone(),
						replaceSelection: sel.moveLines(0, 1).expand(),
						replaceText: joinLinesMarkdownAware(sel.getText()),
					};
				}
				return {
					finalSelection: sel.clone().setChars(sel.anchor.getLine().length),
					replaceSelection: sel.moveLines(0, 1).expand(),
					replaceText: joinLinesMarkdownAware(sel.getText()),
				};
			}
			const anchor = sel.asNormalized().anchor;
			const length = sel.getText().length;
			return {
				finalSelection: sel.asNormalized().collapse().setChars(anchor.ch, anchor.ch + length),
				replaceText: joinLinesMarkdownAware(sel.getText()),
				replaceSelection: sel,
			};
		},
		(array) => {
			let lastIndex = -1;
			return array
				.sort((a, b) => a.anchor.line - b.anchor.line)
				.filter((sel, i, arr) => {
					if (i === 0) return true;
					const prev = arr[i - 1];
					if (prev.anchor.line === sel.anchor.line - 1 && lastIndex !== i - 1) {
						if (!prev.isCaret()) prev.head = sel.head;
						lastIndex = i;
						return false;
					}
					return true;
				});
		},
		false,
	);
}

function joinLinesMarkdownAware(text: string): string {
	const bulletClass = `[-+*]`;
	const lines = text.split('\n');
	const firstLine = (lines[0] ?? '').trimEnd();
	const rest = lines.slice(1).map((line) => {
		let s = (line ?? '').trim();
		s = s.replace(/^(?:>\s*)+/, '');
		s = s.replace(new RegExp(`^${bulletClass}[\\t ]*\\[[xX ]\\][\\t ]+`), '');
		s = s.replace(new RegExp(`^${bulletClass}[\\t ]+`), '');
		s = s.replace(/^\d+\.\s+/, '');
		return s.trim();
	});
	return [firstLine, ...rest.filter((s) => s.length > 0)].join(' ');
}

function addCarets(editor: Editor, direction: number, border: number): void {
	const selections = EditorSelectionManipulator.listSelections(editor).sort(
		(a, b) => a.anchor.toOffset() - b.anchor.toOffset(),
	);
	if (selections.some((s) => !s.isCaret())) return;

	const cursor = editor.getCursor();
	const main = selections.find((s) => s.anchor.line === cursor.line && s.anchor.ch === cursor.ch);
	if (!main) return;
	let mainIndex = selections.indexOf(main);

	const edgeSel = selections[direction > 0 ? selections.length - 1 : 0].clone();
	if (edgeSel.anchor.line === border) return;

	const newSel = edgeSel
		.moveLines(direction)
		.setChars(Math.min(editor.getLine(edgeSel.anchor.line).length, main.anchor.ch));

	if (direction === 1 && mainIndex !== 0) selections.shift();
	else if (direction === -1 && mainIndex !== selections.length - 1) selections.pop();
	else if (direction === 1) selections.push(newSel);
	else { selections.unshift(newSel); mainIndex++; }

	selections.splice(mainIndex, 1);
	selections.unshift(main);

	editor.setSelections([newSel]);
	editor.setSelections(selections);
	editor.scrollIntoView(
		newSel.anchor
			.clone()
			.setPos(Math.min(editor.lineCount() - 1, newSel.anchor.line + direction * 2), newSel.anchor.ch)
			.asEditorRange(),
	);
}

function selectNextWordInstance(editor: Editor, view: MarkdownView): void {
	const selections = EditorSelectionManipulator.listSelections(editor);
	let noteContent = editor.getValue();
	let frontmatterShift = 0;
	const isLivePreview = !(view.getState() as { source?: boolean }).source;
	if (isLivePreview) {
		const stripped = getEditorValueWithoutFrontmatter(editor);
		frontmatterShift = noteContent.length - stripped.length;
		noteContent = stripped;
	}

	if (selections.some((s) => s.isCaret())) {
		selections.filter((s) => s.isCaret()).forEach((sel, i) => (selections[i] = sel.selectWord()));
	} else if (selections.every((s) => !s.isCaret()) && SelectionsProcessing.selectionValuesEqual(selections, true)) {
		const sel = SelectionsProcessing.lowestSelection(selections).normalize();
		const tx = sel.getText();
		const searchFrom = sel.head.toOffset() - frontmatterShift;
		const match = noteContent.substring(searchFrom).match(escapeRegExp(tx));

		if (match !== null) {
			const newSel = EditorSelectionManipulator.documentStart(editor)
				.setChars(searchFrom)
				.moveChars(frontmatterShift)
				.moveChars(match.index ?? 0, (match.index ?? 0) + tx.length);
			selections.push(newSel);
			editor.setSelections(selections);
			editor.scrollIntoView(newSel.asEditorRange());
			return;
		}
		// wrap around
		let searchText = noteContent;
		let shift = 0;
		let m = searchText.match(escapeRegExp(tx));
		while (m !== null) {
			const start = shift + (m.index ?? 0);
			const candidate = EditorSelectionManipulator.documentStart(editor)
				.moveChars(frontmatterShift)
				.moveChars(start, start + tx.length);
			if (!selections.some((s) => s.equals(candidate))) {
				selections.push(candidate);
				editor.setSelections(selections);
				editor.scrollIntoView(candidate.asEditorRange());
				return;
			}
			shift += (m.index ?? 0) + tx.length;
			searchText = searchText.substring((m.index ?? 0) + tx.length);
			m = searchText.match(escapeRegExp(tx));
		}
	} else return;
	editor.setSelections(selections);
}

function selectAllWordInstances(editor: Editor, view: MarkdownView): void {
	const selections = EditorSelectionManipulator.listSelections(editor);
	let noteContent = editor.getValue();
	let frontmatterShift = 0;
	const isLivePreview = !(view.getState() as { source?: boolean }).source;
	if (isLivePreview) {
		const stripped = getEditorValueWithoutFrontmatter(editor);
		frontmatterShift = noteContent.length - stripped.length;
		noteContent = stripped;
	}

	selections.filter((s) => s.isCaret()).forEach((sel, i) => (selections[i] = sel.selectWord()));

	if (selections.every((s) => !s.isCaret()) && SelectionsProcessing.selectionValuesEqual(selections, true)) {
		const tx = selections[0].getText();
		Array.from(noteContent.matchAll(new RegExp(escapeRegExp(tx), 'g')), (v) => v.index ?? 0).forEach((v) => {
			selections.push(
				EditorSelectionManipulator.documentStart(editor)
					.moveChars(frontmatterShift)
					.moveChars(v, v + tx.length),
			);
		});
	} else return;
	editor.setSelections(selections);
}
