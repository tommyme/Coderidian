import { ItemView, Notice, Scope, TFile, WorkspaceLeaf, ViewStateResult } from 'obsidian';
import { Terminal, FitAddon } from 'ghostty-web';
import { PtyManager } from './pty-manager';
import { GhosttyConfig } from './ghostty-config';
import {
    buildEffectiveKeybinds,
    findKeybind,
    isPassToObsidian,
    unescapeGhosttyText,
} from './keybinds';
import { TerminalSettings, TerminalSessionState } from './types';

export const TERMINAL_VIEW_TYPE = 'coderidian-terminal';

const CHAR_MEASURE_ID = 'coderidian-terminal-char-measure';

export class TerminalView extends ItemView {
    navigation = false; // Prevent workspace:close (Cmd+W) from closing the terminal
    private terminal: Terminal | null = null;
    private fitAddon: FitAddon | null = null;
    private ptyManager: PtyManager = new PtyManager();
    private resizeObserver: ResizeObserver | null = null;
    private termEl: HTMLElement | null = null;
    private sessionState: TerminalSessionState = { position: 'bottom' };
    private charWidth = 8;
    private charHeight = 16;
    private _scope: Scope = new Scope();
    private _dataDisposable: { dispose: () => void } | null = null;
    private _resizeTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(
        leaf: WorkspaceLeaf,
        private ghosttyConfig: GhosttyConfig,
        private settings: TerminalSettings,
        private pluginDir: string,
    ) {
        super(leaf);
    }

    getViewType(): string { return TERMINAL_VIEW_TYPE; }
    getDisplayText(): string { return 'Terminal'; }
    getIcon(): string { return 'terminal'; }

    setState(state: Partial<TerminalSessionState>, result: ViewStateResult): Promise<void> {
        if (state?.cwd) this.sessionState.cwd = state.cwd;
        if (state?.position) this.sessionState.position = state.position;
        return super.setState(state as Record<string, unknown>, result);
    }

    getState(): TerminalSessionState {
        return this.sessionState;
    }

    async onOpen(): Promise<void> {
        // Yield to let Obsidian finish laying out the pane before we measure dimensions
        await Promise.resolve();

        // Pin this leaf so file-explorer clicks don't replace it
        this.leaf.setPinned(true);

        // Hide Obsidian's view-header (back/forward nav bar) — terminal needs all vertical space.
        (this.containerEl.children[0] as HTMLElement)?.style.setProperty('display', 'none');

        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('coderidian-terminal-container');

        const wrapper = container.createDiv({ cls: 'coderidian-terminal-wrapper' });
        this.termEl = wrapper.createDiv({ cls: 'coderidian-terminal-term' });

        this.measureCharDimensions();
        this.initTerminal();
        this.setupCloseProtection();
        this.spawnPty();

        // Push/pop the keymap scope with DOM focus so Mod+W is blocked at
        // Obsidian's command-dispatch level (before any DOM capture handlers).
        this.termEl.addEventListener('focusin', () => {
            this.app.keymap.pushScope(this._scope);
        }, { capture: true });
        this.termEl.addEventListener('focusout', () => {
            this.app.keymap.popScope(this._scope);
        });

        this.setupDragDrop();

        this.resizeObserver = new ResizeObserver(() => {
            // Debounce: fitAddon.fit() changes dimensions which can re-trigger the observer
            if (this._resizeTimer) clearTimeout(this._resizeTimer);
            this._resizeTimer = setTimeout(() => this.handleResize(), 100);
        });
        this.resizeObserver.observe(this.termEl);

        // Initial fit must run after browser layout; clientHeight is 0 until then.
        requestAnimationFrame(() => this.handleResize());
    }

    async onClose(): Promise<void> {
        this.app.keymap.popScope(this._scope);
        this._dataDisposable?.dispose();
        this._dataDisposable = null;
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        this.ptyManager.kill();
        this.fitAddon?.dispose?.();
        this.terminal?.dispose?.();
        this.terminal = null;
        this.fitAddon = null;
        this.termEl = null;
    }

    /** Send text to the PTY. Append \n yourself if you want to execute it as a command. */
    public sendText(text: string): void {
        if (this.ptyManager.alive) {
            this.ptyManager.write(text);
        }
    }

    // Called externally (from terminal-service) to restart PTY after layout restore
    public spawnPty(): void {
        if (!this.termEl) return;

        const gc = this.ghosttyConfig;
        const s = this.settings;

        const shell = s.shellPath || gc.shell || process.env.SHELL || '/bin/zsh';
        const { cols, rows } = this.terminalDimensions();

        // Resolve cwd
        const adapter = (this.app.vault.adapter as unknown as {
            getBasePath?: () => string;
            getFullPath?: (p: string) => string;
        });
        const vaultRoot = adapter.getBasePath?.() ?? require('os').homedir();
        const cwd = this.sessionState.cwd
            ? require('path').join(vaultRoot, this.sessionState.cwd)
            : vaultRoot;

        // Dispose previous onData listener before spawning new PTY
        this._dataDisposable?.dispose();
        this._dataDisposable = null;

        this.ptyManager.onData = (data: Uint8Array) => {
            // ghostty-web's write() already calls scrollToBottom() internally,
            // so no need to scroll again in the callback.
            this.terminal?.write(data);
        };

        this.ptyManager.onExit = (code: number | null) => {
            this.terminal?.write(
                `\r\n\x1b[33m[Process exited with code ${code ?? 0}]\x1b[0m\r\n`
            );
            // Auto-close leaf 500ms after exit
            setTimeout(() => {
                try {
                    this.leaf.setPinned(false);
                    this.leaf.detach();
                } catch { /* leaf already gone */ }
            }, 500);
        };

        this.ptyManager.onError = (err: Error) => {
            this.terminal?.write(`\x1b[31m[PTY error: ${err.message}]\x1b[0m\r\n`);
            new Notice(`Terminal: failed to start shell — ${err.message}`, 8000);
        };

        // Wire terminal input → PTY (after spawn setup)
        if (this.terminal) {
            this._dataDisposable = this.terminal.onData((data: string) => {
                if (this.ptyManager.alive) {
                    this.ptyManager.write(data);
                }
            });
        }

        this.ptyManager.spawn({ shell, shellArgs: s.shellArgs, cwd, cols, rows, pluginDir: this.pluginDir });
    }

    private initTerminal(): void {
        const gc = this.ghosttyConfig;
        const s = this.settings;

        const fontFamily = s.fontFamilyOverride || gc.fontFamily || 'Menlo, Monaco, "Courier New", monospace';
        const fontSize = s.fontSizeOverride > 0 ? s.fontSizeOverride : (gc.fontSize ?? 13);
        const scrollback = s.scrollbackLines;

        const theme = {
            background: gc.colors.background ?? '#1e1e2e',
            foreground: gc.colors.foreground ?? '#cdd6f4',
            cursor: gc.colors.cursor ?? '#f5e0dc',
            black: gc.colors.black ?? '#45475a',
            red: gc.colors.red ?? '#f38ba8',
            green: gc.colors.green ?? '#a6e3a1',
            yellow: gc.colors.yellow ?? '#f9e2af',
            blue: gc.colors.blue ?? '#89b4fa',
            magenta: gc.colors.magenta ?? '#f5c2e7',
            cyan: gc.colors.cyan ?? '#94e2d5',
            white: gc.colors.white ?? '#bac2de',
            brightBlack: gc.colors.brightBlack ?? '#585b70',
            brightRed: gc.colors.brightRed ?? '#f38ba8',
            brightGreen: gc.colors.brightGreen ?? '#a6e3a1',
            brightYellow: gc.colors.brightYellow ?? '#f9e2af',
            brightBlue: gc.colors.brightBlue ?? '#89b4fa',
            brightMagenta: gc.colors.brightMagenta ?? '#f5c2e7',
            brightCyan: gc.colors.brightCyan ?? '#94e2d5',
            brightWhite: gc.colors.brightWhite ?? '#a6adc8',
        };

        this.terminal = new Terminal({
            fontSize,
            fontFamily,
            theme,
            scrollback,
            cursorStyle: gc.cursorStyle ?? 'block',
            cursorBlink: gc.cursorBlink ?? false,
        });

        this.fitAddon = new FitAddon();
        this.terminal.loadAddon(this.fitAddon);
        this.terminal.open(this.termEl!);

        // Set up Ghostty keybinds + pass-to-Obsidian interception
        const effectiveKeybinds = buildEffectiveKeybinds(gc.keybinds);

        this.termEl!.addEventListener('keydown', (e: KeyboardEvent) => {
            // 0. Tab / Shift+Tab: prevent browser focus traversal.
            //    Regular Tab falls through to ghostty-web; Shift+Tab sends Back-Tab (\x1b[Z).
            if (e.key === 'Tab') {
                e.preventDefault();
                e.stopImmediatePropagation();
                if (this.ptyManager.alive) {
                    this.ptyManager.write(e.shiftKey ? '\x1b[Z' : '\t');
                }
                return;
            }

            // 1. Pass-to-Obsidian: intercept, prevent terminal from receiving,
            //    re-dispatch to document.body so Obsidian's bubble handlers fire.
            if (isPassToObsidian(e, this.settings.passToObsidian)) {
                e.stopImmediatePropagation();
                e.preventDefault();
                // Temporarily pop our scope so Obsidian's global command dispatcher
                // can process the re-dispatched event (scope blocks unregistered keys).
                // dispatchEvent is synchronous, so the scope is restored before any
                // other code runs.
                this.app.keymap.popScope(this._scope);
                document.body.dispatchEvent(new KeyboardEvent('keydown', {
                    key: e.key, code: e.code,
                    metaKey: e.metaKey, ctrlKey: e.ctrlKey,
                    shiftKey: e.shiftKey, altKey: e.altKey,
                    bubbles: true, cancelable: true,
                }));
                // dispatchEvent is synchronous — if it opened a modal (e.g. command palette),
                // focus has already moved away and focusout already fired.
                // Only re-push scope if termEl still owns focus.
                if (this.termEl?.contains(document.activeElement)) {
                    this.app.keymap.pushScope(this._scope);
                }
                return;
            }

            // 2. Ghostty keybinds
            const match = findKeybind(e, effectiveKeybinds);
            if (!match) return;

            const action = match.action;

            if (action === 'copy_to_clipboard') {
                e.preventDefault();
                e.stopImmediatePropagation();
                const text = this.terminal?.getSelection() ?? window.getSelection()?.toString() ?? '';
                if (text) navigator.clipboard.writeText(text).catch(() => { /* ignore */ });

            } else if (action === 'paste_from_clipboard') {
                e.preventDefault();
                e.stopImmediatePropagation();
                navigator.clipboard.readText().then(text => {
                    if (this.ptyManager.alive && text) {
                        this.ptyManager.write(text);
                    }
                }).catch(() => { /* ignore */ });

            } else if (action.startsWith('text:')) {
                e.preventDefault();
                e.stopImmediatePropagation();
                const text = unescapeGhosttyText(action.slice(5));
                if (this.ptyManager.alive) {
                    this.ptyManager.write(text);
                }

            } else {
                // Unknown action — block Obsidian from stealing key but let ghostty-web handle
                e.stopPropagation();
            }
        }, { capture: true });

        this.fitAddon.fit();
        this.measureCharDimensions();
    }

    private setupCloseProtection(): void {
        // Register hardcoded Mod+W block on the Obsidian keymap scope.
        // The scope is pushed/popped via focusin/focusout on termEl (see onOpen).
        // Returning non-false from a scope handler consumes the event before
        // Obsidian's command dispatcher sees it.
        this._scope.register(['Mod'], 'w', (e) => {
            e.preventDefault();
            // return value other than false = consumed
        });

        // User-configured blockFromObsidian combos
        for (const combo of this.settings.blockFromObsidian) {
            const parts = combo.toLowerCase().trim().split('+');
            const key = parts[parts.length - 1];
            const mods = new Set(parts.slice(0, -1));
            const obsidianMods: import('obsidian').Modifier[] = [];
            if (mods.has('mod'))   obsidianMods.push('Mod');
            if (mods.has('ctrl'))  obsidianMods.push('Ctrl');
            if (mods.has('shift')) obsidianMods.push('Shift');
            if (mods.has('alt'))   obsidianMods.push('Alt');
            if (mods.has('meta'))  obsidianMods.push('Meta');
            this._scope.register(obsidianMods, key, (e) => { e.preventDefault(); });
        }
    }

    private setupDragDrop(): void {
        this.termEl!.addEventListener('dragover', (e: DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        });

        this.termEl!.addEventListener('drop', (e: DragEvent) => {
            e.preventDefault();
            e.stopPropagation();

            const adapter = (this.app.vault.adapter as unknown as { getBasePath?: () => string });
            const basePath = adapter.getBasePath?.() ?? '';

            // 1. Obsidian internal drag (File Explorer)
            const draggable = (this.app as unknown as { dragManager?: { draggable?: { file?: TFile } } })
                .dragManager?.draggable;
            if (draggable?.file) {
                const absPath = require('path').join(basePath, draggable.file.path);
                if (this.ptyManager.alive) this.ptyManager.write(this.shellQuotePath(absPath) + ' ');
                return;
            }

            // 2. Filesystem file dragged from Finder (Electron provides .path on File objects)
            const files = e.dataTransfer?.files;
            if (files && files.length > 0) {
                const filePath = (files[0] as unknown as { path?: string }).path;
                if (filePath && this.ptyManager.alive) {
                    this.ptyManager.write(this.shellQuotePath(filePath) + ' ');
                }
                return;
            }
        });
    }

    /** Wrap a path in single quotes for safe shell insertion (escapes embedded single quotes). */
    private shellQuotePath(p: string): string {
        return "'" + p.replace(/'/g, "'\\''") + "'";
    }

    private measureCharDimensions(): void {
        let measure = document.getElementById(CHAR_MEASURE_ID) as HTMLCanvasElement | null;
        if (!measure) {
            measure = document.createElement('canvas');
            measure.id = CHAR_MEASURE_ID;
            measure.className = 'coderidian-terminal-char-measure';
            document.body.appendChild(measure);
        }

        const ctx = measure.getContext('2d');
        if (!ctx) return;

        const gc = this.ghosttyConfig;
        const s = this.settings;
        const fontFamily = s.fontFamilyOverride || gc.fontFamily || 'Menlo, Monaco, "Courier New", monospace';
        const fontSize = s.fontSizeOverride > 0 ? s.fontSizeOverride : (gc.fontSize ?? 13);

        ctx.font = `${fontSize}px ${fontFamily}`;
        const measured = ctx.measureText('W');

        this.charWidth = Math.ceil(measured.width);
        const ascent = measured.actualBoundingBoxAscent ?? fontSize * 0.8;
        const descent = measured.actualBoundingBoxDescent ?? fontSize * 0.2;
        this.charHeight = Math.ceil((ascent + descent) * 1.2);
    }

    private terminalDimensions(): { cols: number; rows: number } {
        const el = this.termEl;
        if (!el) return { cols: 80, rows: 24 };
        const rect = el.getBoundingClientRect();
        const cols = Math.max(10, Math.floor(rect.width / this.charWidth));
        const rows = Math.max(5, Math.floor(rect.height / this.charHeight));
        return { cols, rows };
    }

    private handleResize(): void {
        if (!this.terminal || !this.fitAddon) return;
        this.fitAddon.fit();
        const { cols, rows } = this.terminal;
        if (this.ptyManager.alive) {
            this.ptyManager.resize(cols, rows);
        }
    }
}
