import { App, Modal } from 'obsidian';
import { applyFolderDiff } from './git-diff-applier';
import { ApplyResult } from './types';

export class GitApplyModal extends Modal {
  private folderPath: string;
  private folderName: string;

  constructor(app: App, folderPath: string) {
    super(app);
    this.folderPath = folderPath;
    this.folderName = folderPath.split('/').pop() ?? folderPath || 'vault root';
  }

  onOpen(): void {
    this.modalEl.addClass('coderidian-git-apply-modal');
    const { titleEl, contentEl } = this;
    titleEl.setText(`Apply Diff → ${this.folderName}`);
    this.renderInputView(contentEl);
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private renderInputView(contentEl: HTMLElement): void {
    contentEl.empty();

    const textarea = contentEl.createEl('textarea', {
      cls: 'coderidian-git-apply-area',
      attr: { placeholder: 'Paste diff content here…', spellcheck: 'false' },
    });

    const footer = contentEl.createDiv({ cls: 'coderidian-git-apply-footer' });
    const cancelBtn = footer.createEl('button', { text: '取消' });
    const applyBtn = footer.createEl('button', { text: '应用', cls: 'mod-cta' });

    cancelBtn.addEventListener('click', () => this.close());

    applyBtn.addEventListener('click', async () => {
      const content = textarea.value.trim();
      if (!content) return;

      applyBtn.setAttr('disabled', 'true');
      applyBtn.setText('应用中…');

      const results = await applyFolderDiff(this.app, this.folderPath, content);
      this.renderResultView(contentEl, results);
    });
  }

  private renderResultView(contentEl: HTMLElement, results: ApplyResult[]): void {
    contentEl.empty();

    const resultsEl = contentEl.createDiv({ cls: 'coderidian-git-apply-results' });

    for (const r of results) {
      const icon =
        r.status === 'created' ? '✅' :
        r.status === 'deleted' ? '🗑️' :
        r.status === 'modified' ? '✅' : '⚠️';

      const detail =
        r.status === 'created' ? 'created' :
        r.status === 'deleted' ? 'deleted' :
        r.status === 'modified' ? `${r.hunksApplied} hunk(s) applied` :
        'error';

      const row = resultsEl.createDiv({
        cls: `coderidian-git-apply-result-row${r.status === 'error' ? ' error' : ''}`,
      });
      row.createSpan({ text: `${icon} ${r.name} — ${detail}` });

      if (r.errors?.length) {
        const errEl = resultsEl.createDiv({ cls: 'coderidian-git-apply-result-errors' });
        for (const err of r.errors) {
          errEl.createDiv({ text: err });
        }
      }
    }

    const footer = contentEl.createDiv({ cls: 'coderidian-git-apply-footer' });
    footer.createEl('button', { text: '关闭', cls: 'mod-cta' }).addEventListener('click', () =>
      this.close(),
    );
  }
}
