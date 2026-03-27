import { App, Notice, WorkspaceLeaf } from 'obsidian';
import { init as initGhosttyWasm } from 'ghostty-web';
import { parseGhosttyConfig, GhosttyConfig } from './ghostty-config';
import { TerminalView, TERMINAL_VIEW_TYPE } from './terminal-view';
import { TerminalSettings, TerminalOpenPosition } from './types';

export class TerminalService {
    private wasmReady = false;
    private ghosttyConfig: GhosttyConfig = { colors: {}, keybinds: [] };

    constructor(
        private app: App,
        private settings: TerminalSettings,
        private pluginDir: string,
        private registerViewFn: (type: string, factory: (leaf: WorkspaceLeaf) => TerminalView) => void,
    ) {}

    async initialize(): Promise<void> {
        // 1. Parse Ghostty config
        this.ghosttyConfig = parseGhosttyConfig(this.settings.ghosttyConfigPath || undefined);

        // 2. Init ghostty-web WASM (base64 inline, no file fetch needed)
        try {
            await initGhosttyWasm();
            this.wasmReady = true;
            console.debug('[Coderidian/Terminal] WASM initialized');
        } catch (e) {
            console.error('[Coderidian/Terminal] WASM init failed:', e);
            new Notice('[Coderidian] Terminal engine failed to initialize. See console.', 8000);
            return;
        }

        // 3. Register view type (after WASM is ready so new Terminal() won't fail in onOpen)
        this.registerViewFn(TERMINAL_VIEW_TYPE, (leaf) =>
            new TerminalView(leaf, this.ghosttyConfig, this.settings, this.pluginDir)
        );
    }

    destroy(): void {
        const leaves = this.app.workspace.getLeavesOfType(TERMINAL_VIEW_TYPE);
        leaves.forEach(leaf => {
            try {
                leaf.setPinned(false);
                leaf.detach();
            } catch { /* ignore */ }
        });
        this.app.workspace.detachLeavesOfType(TERMINAL_VIEW_TYPE);
    }

    /** Open a terminal, or reveal an existing one (forceNew = always create new) */
    async openTerminal(position?: TerminalOpenPosition, forceNew = false): Promise<void> {
        if (!this.wasmReady) {
            new Notice('[Coderidian] Terminal not ready yet. Try again in a moment.', 4000);
            return;
        }

        const pos = position ?? this.settings.defaultPosition;

        if (!forceNew) {
            // Reveal existing terminal if one is open
            const existing = this.app.workspace.getLeavesOfType(TERMINAL_VIEW_TYPE);
            if (existing.length > 0) {
                this.app.workspace.revealLeaf(existing[0]);
                existing[0].view?.containerEl.focus();
                return;
            }
        }

        const leaf = this.getLeafForPosition(pos);
        await leaf.setViewState({ type: TERMINAL_VIEW_TYPE, active: true });
        this.app.workspace.revealLeaf(leaf);
    }

    /** Open a terminal with a specific starting cwd (from file-menu context) */
    async openTerminalAt(vaultRelativePath: string): Promise<void> {
        if (!this.wasmReady) {
            new Notice('[Coderidian] Terminal not ready yet.', 4000);
            return;
        }

        const leaf = this.getLeafForPosition(this.settings.defaultPosition);
        await leaf.setViewState({
            type: TERMINAL_VIEW_TYPE,
            active: true,
            state: { cwd: vaultRelativePath, position: this.settings.defaultPosition },
        });
        this.app.workspace.revealLeaf(leaf);
    }

    /** Send text to the active terminal, or the first open one.
     *  @param newline append \n (execute as command) when true
     *  @returns true if sent, false if no terminal is available */
    sendText(text: string, newline = false): boolean {
        const active = this.app.workspace.getActiveViewOfType(TerminalView);
        const view: TerminalView | null = active ?? (() => {
            const leaves = this.app.workspace.getLeavesOfType(TERMINAL_VIEW_TYPE);
            return leaves.length > 0 ? (leaves[0].view as TerminalView) : null;
        })();
        if (!view) return false;
        view.sendText(newline ? text + '\n' : text);
        return true;
    }

    /** Reload Ghostty config (e.g., after user changes the config path in settings) */
    reloadGhosttyConfig(): void {
        this.ghosttyConfig = parseGhosttyConfig(this.settings.ghosttyConfigPath || undefined);
    }

    private getLeafForPosition(position: TerminalOpenPosition): WorkspaceLeaf {
        switch (position) {
            case 'bottom':
                // Horizontal split creates a panel below the current editor — VSCode-style
                return (this.app.workspace as unknown as {
                    getLeaf(type: string, direction?: string): WorkspaceLeaf
                }).getLeaf('split', 'horizontal');
            case 'right':
                return this.app.workspace.getRightLeaf(false)!;
            case 'tab':
                return this.app.workspace.getLeaf('tab');
            case 'window':
                return this.app.workspace.getLeaf('window');
        }
    }
}
