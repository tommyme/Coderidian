import { App, TFolder } from 'obsidian';

const BODY_CLASS = 'coderidian-hide-files';
const HIDDEN_CLASS = 'coderidian-hidden';

/**
 * Converts a glob pattern to a RegExp.
 * - `**` matches any sequence including `/`
 * - `*`  matches any sequence except `/`
 * - `?`  matches a single character except `/`
 */
function globToRegex(glob: string): RegExp {
    // Escape regex special chars except our glob wildcards
    const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    const regexStr = escaped
        .replace(/\*\*/g, '\x00') // placeholder
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]')
        .replace(/\x00/g, '.*');
    return new RegExp(`^${regexStr}$`, 'i');
}

export class FileHiderService {
    private observer: MutationObserver | null = null;
    private markedPaths = new Set<string>();

    constructor(
        private app: App,
        private getPatterns: () => string[],
        private isEnabled: () => boolean,
    ) {}

    initialize(): void {
        this.refresh();
        this.startObserver();
    }

    destroy(): void {
        this.observer?.disconnect();
        this.observer = null;
        // Remove all CSS marks
        document.querySelectorAll<HTMLElement>(`.${HIDDEN_CLASS}`).forEach((el) => {
            el.removeClass(HIDDEN_CLASS);
        });
        this.markedPaths.clear();
        document.body.removeClass(BODY_CLASS);
    }

    refresh(): void {
        // Remove existing marks
        document.querySelectorAll<HTMLElement>(`.${HIDDEN_CLASS}`).forEach((el) => {
            el.removeClass(HIDDEN_CLASS);
        });
        this.markedPaths.clear();

        if (!this.isEnabled()) {
            document.body.removeClass(BODY_CLASS);
            return;
        }

        document.body.addClass(BODY_CLASS);

        // Scan all vault files and folders
        const allFiles = this.app.vault.getAllLoadedFiles();
        for (const file of allFiles) {
            if (this.matchesAnyPattern(file.path)) {
                this.markPath(file.path, file instanceof TFolder);
            }
        }
    }

    setEnabled(v: boolean): void {
        this.refresh();
        if (v) {
            document.body.addClass(BODY_CLASS);
        } else {
            document.body.removeClass(BODY_CLASS);
        }
    }

    private matchesAnyPattern(path: string): boolean {
        const patterns = this.getPatterns();
        if (patterns.length === 0) return false;

        const basename = path.includes('/') ? path.slice(path.lastIndexOf('/') + 1) : path;

        for (const raw of patterns) {
            const pattern = raw.trim();
            if (!pattern) continue;

            try {
                // Regex mode: {regex}... or /...
                if (pattern.startsWith('{regex}')) {
                    const regexStr = pattern.slice('{regex}'.length);
                    if (new RegExp(regexStr, 'i').test(path)) return true;
                } else {
                    // Glob mode: match against full path and basename
                    const re = globToRegex(pattern);
                    if (re.test(path) || re.test(basename)) return true;
                }
            } catch {
                // Invalid regex — skip silently
            }
        }
        return false;
    }

    private markPath(path: string, isFolder: boolean): void {
        this.markedPaths.add(path);
        const escapedPath = CSS.escape(path);
        const els = document.querySelectorAll<HTMLElement>(`[data-path='${escapedPath}']`);
        els.forEach((el) => {
            el.addClass(HIDDEN_CLASS);
            if (isFolder) {
                // For folders, also hide the containing .nav-folder wrapper
                const navFolder = el.closest<HTMLElement>('.nav-folder');
                if (navFolder) navFolder.addClass(HIDDEN_CLASS);
            }
        });
    }

    private unmarkPath(path: string): void {
        this.markedPaths.delete(path);
        const escapedPath = CSS.escape(path);
        document.querySelectorAll<HTMLElement>(`[data-path='${escapedPath}']`).forEach((el) => {
            el.removeClass(HIDDEN_CLASS);
            const navFolder = el.closest<HTMLElement>('.nav-folder');
            if (navFolder) navFolder.removeClass(HIDDEN_CLASS);
        });
    }

    private getFileExplorerEl(path: string): HTMLElement | null {
        const escapedPath = CSS.escape(path);
        return document.querySelector<HTMLElement>(`[data-path='${escapedPath}']`);
    }

    private startObserver(): void {
        this.observer = new MutationObserver((mutations) => {
            if (!this.isEnabled()) return;
            for (const mutation of mutations) {
                mutation.addedNodes.forEach((node) => {
                    if (!(node instanceof HTMLElement)) return;
                    // Check the node itself and all descendants
                    const candidates: HTMLElement[] = [];
                    const datePath = node.getAttribute?.('data-path');
                    if (datePath) candidates.push(node);
                    node.querySelectorAll<HTMLElement>('[data-path]').forEach((el) => candidates.push(el));

                    for (const el of candidates) {
                        const p = el.getAttribute('data-path');
                        if (p && this.matchesAnyPattern(p)) {
                            el.addClass(HIDDEN_CLASS);
                            const navFolder = el.closest<HTMLElement>('.nav-folder');
                            if (navFolder) navFolder.addClass(HIDDEN_CLASS);
                        }
                    }
                });
            }
        });

        this.observer.observe(document, { childList: true, subtree: true });
    }
}
