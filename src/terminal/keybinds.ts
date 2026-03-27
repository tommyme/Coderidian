import { GhosttyKeybind } from './ghostty-config';

// Ghostty's built-in defaults always enforced
export const GHOSTTY_BUILTIN_KEYBINDS: GhosttyKeybind[] = [
    { mods: new Set(['super']), key: 'c',     action: 'copy_to_clipboard' },
    { mods: new Set(['super']), key: 'v',     action: 'paste_from_clipboard' },
    { mods: new Set(['shift']), key: 'enter', action: 'text:\x1b[13;2u' },
    { mods: new Set(['super']), key: 'enter', action: 'text:\x1b[13;9u' },
];

// Key combos that ALWAYS block Obsidian — user cannot remove these
export const HARDCODED_BLOCK_COMBOS = [
    { metaKey: true,  ctrlKey: false, shiftKey: false, key: 'w' },  // macOS Cmd+W
    { metaKey: false, ctrlKey: true,  shiftKey: false, key: 'w' },  // Linux/Win Ctrl+W
];

/**
 * Parse a "mod+key" combo string to a matcher object.
 * "mod" maps to metaKey on macOS, ctrlKey on other platforms.
 */
export function parseComboString(combo: string): { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; key: string } | null {
    const parts = combo.toLowerCase().trim().split('+');
    if (parts.length === 0) return null;
    const key = parts[parts.length - 1];
    if (!key) return null;
    const mods = new Set(parts.slice(0, -1));
    const isMod = mods.has('mod');
    const isMac = process.platform === 'darwin';
    return {
        metaKey: isMod ? isMac : mods.has('meta') || mods.has('super'),
        ctrlKey: isMod ? !isMac : mods.has('ctrl'),
        shiftKey: mods.has('shift'),
        altKey: mods.has('alt'),
        key,
    };
}

/** Returns true if e matches any hardcoded block combo OR any in the user list */
export function isBlockedKey(e: KeyboardEvent, userBlockList: string[]): boolean {
    // Hardcoded
    for (const c of HARDCODED_BLOCK_COMBOS) {
        if (e.key.toLowerCase() === c.key && e.metaKey === c.metaKey && e.ctrlKey === c.ctrlKey) return true;
    }
    // User-configured
    for (const combo of userBlockList) {
        const m = parseComboString(combo);
        if (!m) continue;
        if (
            e.key.toLowerCase() === m.key &&
            e.metaKey === m.metaKey &&
            e.ctrlKey === m.ctrlKey &&
            e.shiftKey === m.shiftKey &&
            e.altKey === m.altKey
        ) return true;
    }
    return false;
}

/** Returns true if e matches any combo in the passToObsidian list */
export function isPassToObsidian(e: KeyboardEvent, passList: string[]): boolean {
    for (const combo of passList) {
        const m = parseComboString(combo);
        if (!m) continue;
        if (
            e.key.toLowerCase() === m.key &&
            e.metaKey === m.metaKey &&
            e.ctrlKey === m.ctrlKey &&
            e.shiftKey === m.shiftKey &&
            e.altKey === m.altKey
        ) return true;
    }
    return false;
}

/** Merge built-in defaults with user config keybinds (user entries override defaults) */
export function buildEffectiveKeybinds(userKeybinds: GhosttyKeybind[]): GhosttyKeybind[] {
    const result: GhosttyKeybind[] = [...GHOSTTY_BUILTIN_KEYBINDS];
    for (const kb of userKeybinds) {
        const idx = result.findIndex(r => r.key === kb.key && setsEqual(r.mods, kb.mods));
        if (idx !== -1) result[idx] = kb;
        else result.push(kb);
    }
    return result;
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
    if (a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
}

/** Map DOM KeyboardEvent.key → Ghostty key name */
export function domKeyToGhostty(domKey: string): string {
    const map: Record<string, string> = {
        'Enter':      'enter',
        'Tab':        'tab',
        'Backspace':  'backspace',
        'Escape':     'escape',
        'Delete':     'delete',
        'Insert':     'insert',
        'Home':       'home',
        'End':        'end',
        'PageUp':     'page_up',
        'PageDown':   'page_down',
        'ArrowUp':    'up',
        'ArrowDown':  'down',
        'ArrowLeft':  'left',
        'ArrowRight': 'right',
        ' ':          'space',
    };
    if (map[domKey]) return map[domKey];
    if (/^F\d+$/.test(domKey)) return domKey.toLowerCase();
    if (domKey.length === 1) return domKey.toLowerCase();
    return domKey.toLowerCase();
}

/** Find matching Ghostty keybind for a keyboard event */
export function findKeybind(e: KeyboardEvent, keybinds: GhosttyKeybind[]): GhosttyKeybind | undefined {
    const eventMods = new Set<string>();
    if (e.metaKey)  eventMods.add('super');
    if (e.ctrlKey)  eventMods.add('ctrl');
    if (e.shiftKey) eventMods.add('shift');
    if (e.altKey)   eventMods.add('alt');

    const ghosttyKey = domKeyToGhostty(e.key);
    return keybinds.find(kb => kb.key === ghosttyKey && setsEqual(kb.mods, eventMods));
}

/** Unescape Ghostty text escape sequences */
export function unescapeGhosttyText(s: string): string {
    return s
        .replace(/\\e/g, '\x1b')
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\\\/g, '\\');
}
