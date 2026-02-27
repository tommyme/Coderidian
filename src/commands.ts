import { Editor, MarkdownView } from 'obsidian';
import MyPlugin from './main';

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
	plugin.addCommand({
		id: 'open-vscode',
		name: 'Open Vault in VSCode',
		callback: () => {
			plugin.openVSCode();
		}
	});

	plugin.addCommand({
		id: 'open-vscode-via-url',
		name: 'Open Vault in VSCode (via URL)',
		callback: () => {
			plugin.openVSCodeViaURL();
		}
	});

	// Toggle bold or sidebar commands
	plugin.addCommand({
		id: 'toggle-bold-or-sidebar',
		name: 'Toggle Bold or Sidebar (depending on config)',
		hotkeys: [
			{
				modifiers: ["Ctrl"],
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
		name: 'Toggle Bold or Sidebar (do switch)',
		callback: () => plugin.toggleSidebarOrBoldMode()
	});

	// HTML wrapping commands
	plugin.addCommand({
		id: 'wrap-html-gray',
		name: 'wrap html gray',
		editorCallback: (editor: Editor, view: MarkdownView) => {
			wrap_content(editor, '<font color="#888888">', '</font>');
		}
	});

	plugin.addCommand({
		id: 'wrap-html-a',
		name: 'wrap html a',
		editorCallback(editor, ctx) {
			wrap_content(editor, '<a href="">', '</a>');
		},
	});

	// h1~h4 title style commands
	for (let i = 1; i < 4; i++) {
		let tag_name = `h${String(i)}`;
		plugin.addCommand({
			id: `wrap-html-${tag_name}`,
			name: `wrap html ${tag_name}`,
			editorCallback(editor, ctx) {
				wrap_content(editor, `<${tag_name}>`, `</${tag_name}>`);
			},
		})
	}

	// Zip vault command
	plugin.addCommand({
		id: 'zip-the-vault',
		name: 'zip the vault',
		async editorCallback(editor, ctx) {
			const vaultPath = plugin.app.vault.adapter.basePath;
			const zipFilePath = `${vaultPath}.zip`;

			if (existsSync(zipFilePath)) {
				new ConfirmModal(() => zipVault(vaultPath, zipFilePath, true)).open();
			} else {
				await zipVault(vaultPath, zipFilePath, false);
			}
		},
	});

	// Copy selected LF content command
	plugin.addCommand({
		id: 'copy-selected-lf-content',
		name: 'copy selected lf content',
		async editorCallback(editor, ctx) {
			let selectedText = editor.getSelection();
			selectedText = selectedText.replace(/\n/g, '\r\n');
			await navigator.clipboard.writeText(selectedText);
		},
	});
}
