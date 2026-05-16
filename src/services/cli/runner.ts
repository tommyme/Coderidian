/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any */
const DEFAULT_EXTRA_PATHS = [
	'/opt/homebrew/bin',
	'/opt/homebrew/sbin',
	'/usr/local/bin',
	`${process.env.HOME ?? ''}/.local/bin`,
	`${process.env.HOME ?? ''}/bin`,
];

/**
 * Runs one-shot shell commands inside Electron.
 * Augments PATH so Homebrew/nvm tools are found even though /bin/sh
 * does not load the user's shell profile.
 */
export class CliRunner {
	private env: NodeJS.ProcessEnv;

	constructor(extraPaths: string[] = DEFAULT_EXTRA_PATHS) {
		const PATH = [process.env.PATH, extraPaths.join(':')].filter(Boolean).join(':');
		this.env = { ...process.env, PATH };
	}

	run(command: string, timeoutMs = 30_000): Promise<string> {
		const { exec } = require('child_process');
		return new Promise((resolve, reject) => {
			exec(
				command,
				{ encoding: 'utf8', timeout: timeoutMs, env: this.env },
				(err: any, stdout: string, stderr: string) => {
					if (err) reject(new Error(stderr?.trim() || err.message));
					else resolve(stdout);
				},
			);
		});
	}
}
