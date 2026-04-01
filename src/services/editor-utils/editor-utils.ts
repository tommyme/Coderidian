import { App, Editor } from 'obsidian';

export function escapeRegExp(string: string): string {
	return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function getEditorValueWithoutFrontmatter(editor: Editor): string {
	const FENCE = '---';
	const lines = editor.getValue().split('\n');
	if (lines[0] === FENCE) {
		let start = 1;
		while (start < lines.length && lines[start] !== FENCE) start++;
		if (start !== lines.length) {
			lines.splice(0, start + 1);
		}
	}
	return lines.join('\n');
}

export function flipBooleanSetting(app: App, setting: string): void {
	const vault = app.vault as unknown as {
		getConfig: (key: string) => unknown;
		setConfig: (key: string, value: unknown) => void;
	};
	vault.setConfig(setting, !(vault.getConfig(setting) ?? false));
}
