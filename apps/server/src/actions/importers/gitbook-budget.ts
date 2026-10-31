import { ImportError } from '../../errors';

/** Shared by all source reads and include expansions in one import. */
export class GitBookImportBudget {
  private readonly started = Date.now();
  private files = 0;
  private bytes = 0;
  private includes = 0;
  private expanded = 0;

  check() {
    if (Date.now() - this.started > 10 * 60_000)
      throw new ImportError({ code: 'import:limit', message: 'GitBook import exceeded its time budget; the draft was preserved.' });
  }

  source(content: string) {
    this.check();
    this.files++;
    this.bytes += Buffer.byteLength(content);
    if (this.files > 4000 || this.bytes > 32 * 1024 * 1024)
      throw new ImportError({ code: 'import:limit', message: 'GitBook import exceeded its source budget; the draft was preserved.' });
  }

  page(content: string, path: string) {
    this.check();
    if (Buffer.byteLength(content) > 2 * 1024 * 1024)
      throw new ImportError({ code: 'import:limit', message: 'Expanded page exceeds 2 MiB; the draft was preserved.', details: { path } });
  }

  include() {
    this.check();
    if (++this.includes > 10_000)
      throw new ImportError({ code: 'import:limit', message: 'GitBook import exceeded its include budget; the draft was preserved.' });
  }

  expansion(content: string) {
    this.check();
    this.expanded += Buffer.byteLength(content);
    if (this.expanded > 64 * 1024 * 1024)
      throw new ImportError({ code: 'import:limit', message: 'GitBook import exceeded its expansion budget; the draft was preserved.' });
  }
}
