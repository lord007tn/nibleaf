import type { SiteSnapshot } from '@nibleaf/shared/site';
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFString, StandardFonts } from 'pdf-lib';
import { chromium } from 'playwright-core';
import { type ExportAsset, type RenderedArtifact, renderPdfHtml } from './render';

const INTERNAL_PAGE_URL = 'https://nibleaf.invalid/export/page/';

/** Keep Chromium's DOM and decoded images bounded to one published article.
 * The combined PDF retains its original order, internal links and numbering. */
export const renderPdf = async (
  snapshot: SiteSnapshot,
  assets: ExportAsset[],
  options: { executablePath: string; checkCancelled?: () => Promise<void> },
): Promise<RenderedArtifact> => {
  const browser = await chromium.launch({
    executablePath: options.executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const document = await PDFDocument.create();
    const destinations = new Map<string, number>();
    const articles = snapshot.pages.filter((page) => page.kind === 'PAGE' && !page.hidden);
    // Render the cover separately so every article starts at a known PDF page.
    for (const article of [null, ...articles]) {
      await options.checkCancelled?.();
      const page = await browser.newPage();
      let bytes: Uint8Array;
      try {
        // Published content cannot make network requests from the export worker.
        await page.route('**/*', (route) => {
          const protocol = new URL(route.request().url()).protocol;
          return ['about:', 'data:'].includes(protocol) ? route.continue() : route.abort();
        });
        await page.setContent(
          renderPdfHtml(snapshot, assets, {
            pages: article ? [article] : [],
            includeCover: article === null,
            internalLinkPrefix: INTERNAL_PAGE_URL,
          }),
          { waitUntil: 'load' },
        );
        bytes = await page.pdf({ format: 'A4', printBackground: true });
      } finally {
        // newPage owns its context: closing it releases this article's images.
        await page.close();
      }
      if (article) destinations.set(encodeURIComponent(article.id), document.getPageCount());
      const part = await PDFDocument.load(bytes);
      for (const copied of await document.copyPages(part, part.getPageIndices())) document.addPage(copied);
    }

    await options.checkCancelled?.();
    const font = await document.embedFont(StandardFonts.Helvetica);
    const pages = document.getPages();
    for (const [index, page] of pages.entries()) {
      const label = `${index + 1} / ${pages.length}`;
      page.drawText(label, { font, size: 6, x: (page.getWidth() - font.widthOfTextAtSize(label, 6)) / 2, y: 18 });
      for (const entry of page.node.Annots()?.asArray() ?? []) {
        const annotation = document.context.lookup(entry, PDFDict);
        const action = annotation.lookupMaybe(PDFName.of('A'), PDFDict);
        const uri = action?.lookupMaybe(PDFName.of('URI'), PDFString, PDFHexString)?.decodeText();
        if (!uri?.startsWith(INTERNAL_PAGE_URL)) continue;
        const target = destinations.get(uri.slice(INTERNAL_PAGE_URL.length));
        const targetPage = target === undefined ? undefined : pages[target];
        if (targetPage) {
          annotation.set(PDFName.of('A'), document.context.obj({ S: 'GoTo', D: [targetPage.ref, 'Fit'] }));
        } else {
          // Hidden articles have no destination and must not leak marker URLs.
          annotation.delete(PDFName.of('A'));
        }
      }
    }
    document.setTitle(snapshot.project.name);
    document.setAuthor('Nibleaf');
    document.setSubject(snapshot.project.description ?? 'Published documentation export');
    document.setProducer('Nibleaf');
    document.setCreator('Nibleaf export worker');
    document.setCreationDate(new Date(snapshot.generatedAt));
    document.setKeywords(snapshot.project.languages.map((language) => language.code));
    return { bytes: await document.save(), contentType: 'application/pdf', extension: 'pdf' };
  } finally {
    await browser.close();
  }
};
