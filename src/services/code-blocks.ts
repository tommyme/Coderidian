import { Plugin } from 'obsidian';

export function registerCodeBlockProcessors(plugin: Plugin) {
	plugin.registerMarkdownCodeBlockProcessor(`htmlx`, (source, el) => {
		const div = document.createElement("div");
		div.innerHTML = source;
		el.appendChild(div);
	});

	plugin.registerMarkdownCodeBlockProcessor(`hidden-js`, (source, el) => {
		const scriptEl = document.createElement("script");
		scriptEl.textContent = source;
		el.appendChild(scriptEl);
		
		const prompt = document.createElement("div");
		prompt.textContent = 'here is some hidden javascript code';
		el.appendChild(prompt);
	});

	plugin.registerMarkdownCodeBlockProcessor(`buttonjs`, (source, el) => {
		const lines = source.split('\n');
		const name = lines[0];
		const content = lines.slice(1).join('\n');

		const btn = document.createElement("button");
		btn.textContent = name;
		btn.addEventListener("click", () => eval(content));
		el.appendChild(btn);
	});
}
