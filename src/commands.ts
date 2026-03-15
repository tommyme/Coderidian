import { Editor, MarkdownView, Notice } from 'obsidian';
import MyPlugin from './main';
import { processCurrentNote } from './ai-image-analysis';
import { ConfirmModal, zipVault } from './utils';
import { existsSync } from 'fs';
import { openSectionTranslationModal } from './views/section-translation-modal';

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
}
