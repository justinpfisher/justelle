const DEFAULT_LIMITS = Object.freeze({
  maxBytes: 12 * 1024 * 1024,
  maxPages: 12,
  maxItems: 4000,
  maxCharacters: 4000,
  timeoutMs: 10000
});
const safeErrors = new Set([
  'Choose a valid PDF that is 12 MiB or smaller.',
  'Choose a PDF with 12 pages or fewer.',
  'This PDF contains more text than can be reviewed at once.',
  'PDF text reading took too long. Try a smaller document.'
]);

export async function extractSelectablePdfText(input, { getDocument, limits = {} } = {}) {
  const bounds = { ...DEFAULT_LIMITS, ...limits };
  const bytes = Uint8Array.from(input);
  if (bytes.byteLength < 5 || bytes.byteLength > bounds.maxBytes ||
      String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') {
    throw new Error('Choose a valid PDF that is 12 MiB or smaller.');
  }
  if (typeof getDocument !== 'function') throw new Error('PDF text reading is unavailable.');

  let task;
  let timer;
  const read = async () => {
    task = getDocument({ data: bytes, isEvalSupported: false, enableXfa: false });
    const pdf = await task.promise;
    if (!Number.isInteger(pdf.numPages) || pdf.numPages < 1 || pdf.numPages > bounds.maxPages) {
      throw new Error('Choose a PDF with 12 pages or fewer.');
    }
    const lines = [];
    let itemCount = 0;
    let characterCount = 0;
    let previousY = null;
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      for (const item of content.items) {
        if (typeof item.str !== 'string' || !item.str) continue;
        if (++itemCount > bounds.maxItems ||
            characterCount + item.str.length > bounds.maxCharacters) {
          throw new Error('This PDF contains more text than can be reviewed at once.');
        }
        characterCount += item.str.length;
        const y = Number.isFinite(item.transform?.[5]) ? item.transform[5] : null;
        if (lines.length && lines.at(-1) !== '\n') {
          if (y !== null && previousY !== null && Math.abs(y - previousY) > 2) lines.push('\n');
          else lines.push(' ');
        }
        lines.push(item.str);
        if (item.hasEOL) lines.push('\n');
        previousY = y;
      }
    }
    return { text: lines.join(' ').replace(/ *\n */g, '\n').trim(), pages: pdf.numPages };
  };
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      Promise.resolve(task?.destroy?.()).catch(() => {});
      reject(new Error('PDF text reading took too long. Try a smaller document.'));
    }, bounds.timeoutMs);
  });
  try {
    return await Promise.race([read(), timeout]);
  } catch (error) {
    if (error instanceof Error && safeErrors.has(error.message)) throw error;
    throw new Error('Could not read selectable text from this PDF. You can enter details manually.');
  } finally {
    clearTimeout(timer);
    try { await task?.destroy?.(); } catch { /* Cleanup errors carry no user content. */ }
  }
}
