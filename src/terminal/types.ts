export type TerminalOpenPosition = 'bottom' | 'right' | 'tab' | 'window';

export interface TerminalSettings {
    defaultPosition: TerminalOpenPosition;
    shellPath: string;           // '' → fall back to process.env.SHELL → /bin/zsh
    shellArgs: string[];         // default []
    ghosttyConfigPath: string;   // '' → auto-detect default paths
    fontFamilyOverride: string;  // '' → use ghostty config value
    fontSizeOverride: number;    // 0  → use ghostty config value
    scrollbackLines: number;     // default 10000
    passToObsidian: string[];    // e.g. ['mod+p', 'mod+o'] — pass to Obsidian, not PTY
    blockFromObsidian: string[]; // e.g. ['mod+w'] — swallow entirely (plus hardcoded Mod+W)
}

export const DEFAULT_TERMINAL_SETTINGS: TerminalSettings = {
    defaultPosition: 'bottom',
    shellPath: '',
    shellArgs: [],
    ghosttyConfigPath: '',
    fontFamilyOverride: '',
    fontSizeOverride: 0,
    scrollbackLines: 10000,
    passToObsidian: ['mod+p', 'mod+o'],
    blockFromObsidian: [],
};

export interface TerminalSessionState {
    cwd?: string;
    position: TerminalOpenPosition;
}
