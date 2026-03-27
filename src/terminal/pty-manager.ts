import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import ptyHelperCode from './pty_helper.py';

export interface PtySpawnOptions {
    shell: string;
    shellArgs: string[];
    cwd: string;
    cols: number;
    rows: number;
    pluginDir: string;
}

export class PtyManager {
    private process: child_process.ChildProcess | null = null;
    private resizePipe: NodeJS.WritableStream | null = null;
    public alive = false;

    onData: ((data: Uint8Array) => void) | null = null;
    onExit: ((code: number | null) => void) | null = null;
    onError: ((err: Error) => void) | null = null;

    spawn(opts: PtySpawnOptions): void {
        if (this.alive) this.kill();

        const helperPath = this.getHelperPath(opts.pluginDir);
        this.ensureHelper(helperPath);

        const python = process.platform === 'darwin' ? '/usr/bin/python3' : 'python3';
        const shellArgs = opts.shellArgs.length > 0 ? opts.shellArgs : [];

        const proc = child_process.spawn(
            python,
            [helperPath, opts.shell, ...shellArgs],
            {
                cwd: opts.cwd,
                env: {
                    ...process.env,
                    TERM: 'xterm-256color',
                    TERM_PROGRAM: 'coderidian',
                    COLORTERM: 'truecolor',
                    COLUMNS: String(opts.cols),
                    LINES: String(opts.rows),
                },
                stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
            }
        );

        this.process = proc;
        this.resizePipe = proc.stdio[3] as NodeJS.WritableStream;
        this.alive = true;

        proc.stdout?.on('data', (data: Buffer) => {
            this.onData?.(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
        });

        proc.on('close', (code) => {
            this.alive = false;
            this.onExit?.(code);
        });

        proc.on('error', (err) => {
            this.alive = false;
            this.onError?.(err);
        });

        proc.stderr?.on('data', (data: Buffer) => {
            console.error('[Coderidian/Terminal PTY]', data.toString());
        });
    }

    /** Send input bytes to the shell */
    write(data: string): void {
        if (!this.alive || !this.process?.stdin) return;
        this.process.stdin.write(data, 'utf8');
    }

    /** Send resize frame: 4-byte big-endian [rows uint16, cols uint16] on fd 3 */
    resize(cols: number, rows: number): void {
        if (!this.alive || !this.resizePipe) return;
        const buf = Buffer.alloc(4);
        buf.writeUInt16BE(rows, 0);
        buf.writeUInt16BE(cols, 2);
        try {
            this.resizePipe.write(buf);
        } catch {
            // pipe may be closed
        }
    }

    kill(): void {
        this.alive = false;
        const proc = this.process;
        if (!proc) return;
        this.process = null;
        this.resizePipe = null;
        try { proc.stdin?.destroy(); } catch { /* ignore */ }
        try { proc.stdout?.destroy(); } catch { /* ignore */ }
        try { (proc.stdio[3] as NodeJS.WritableStream)?.destroy?.(); } catch { /* ignore */ }
        try { proc.kill('SIGTERM'); } catch { /* ignore */ }
        // SIGKILL fallback
        const pid = proc.pid;
        if (pid) {
            setTimeout(() => {
                try { process.kill(pid, 'SIGKILL'); } catch { /* already dead */ }
            }, 500);
        }
    }

    private getHelperPath(pluginDir: string): string {
        return path.join(pluginDir, 'pty_helper.py');
    }

    private ensureHelper(helperPath: string): void {
        try {
            if (!fs.existsSync(helperPath) ||
                fs.readFileSync(helperPath, 'utf8') !== ptyHelperCode) {
                fs.writeFileSync(helperPath, ptyHelperCode, { mode: 0o755 });
            }
        } catch (e) {
            console.error('[Coderidian/Terminal] Failed to write pty_helper.py:', e);
        }
    }
}
