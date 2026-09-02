/**
 * Splits parsed document text into overlapping chunks for embedding.
 *
 * Paragraph-aware rather than a fixed character window. Legal writing carries
 * its meaning in whole paragraphs — a numbered submission, a headnote, a quoted
 * passage — and a window that cuts mid-sentence produces chunks that retrieve
 * well and read badly when the judge is handed them. Only a paragraph longer
 * than the target on its own is cut by length, and then on a word boundary.
 *
 * The image descriptions the parser inlines arrive here as ordinary paragraphs,
 * so a chart in a PDF ends up searchable in exactly the same way body text does.
 */

/** Collapses the runs of blank lines the parsers emit around page headings. */
function toParagraphs(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean);
}

/** Cuts an oversized paragraph on word boundaries, never mid-word. */
function splitLongParagraph(paragraph, size) {
  const pieces = [];
  const words = paragraph.split(/\s+/);
  let current = '';
  for (const word of words) {
    if (current && current.length + 1 + word.length > size) {
      pieces.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

/**
 * @param {string} text
 * @param {{size?: number, overlap?: number, min?: number}} options
 * @returns {Array<{text: string, index: number}>} In document order.
 */
export function chunkText(text, { size = 1000, overlap = 200, min = 100 } = {}) {
  const paragraphs = toParagraphs(text).flatMap(
    paragraph => (paragraph.length > size ? splitLongParagraph(paragraph, size) : paragraph),
  );
  if (!paragraphs.length) return [];

  const chunks = [];
  let current = [];
  let currentLength = 0;

  const flush = () => {
    if (!current.length) return;
    chunks.push(current.join('\n\n'));
    if (overlap <= 0) {
      current = [];
      currentLength = 0;
      return;
    }
    // Carry whole trailing paragraphs forward as the overlap, so a chunk
    // boundary never lands inside a sentence.
    const carried = [];
    let carriedLength = 0;
    for (let i = current.length - 1; i >= 0; i -= 1) {
      if (carriedLength + current[i].length > overlap) break;
      carried.unshift(current[i]);
      carriedLength += current[i].length + 2;
    }
    // A paragraph that overshot the overlap budget still makes a useful bridge,
    // but only while it leaves room for new content — carrying one that nearly
    // fills a chunk would re-emit it as a chunk of its own on the next flush.
    const last = current[current.length - 1];
    if (!carried.length && current.length > 1 && last.length <= size / 2) carried.push(last);
    current = carried;
    currentLength = carried.reduce((total, paragraph) => total + paragraph.length + 2, 0);
  };

  for (const paragraph of paragraphs) {
    if (currentLength && currentLength + paragraph.length > size) flush();
    current.push(paragraph);
    currentLength += paragraph.length + 2;
  }
  if (current.length) chunks.push(current.join('\n\n'));

  return chunks
    // A trailing fragment shorter than `min` is noise on its own, but dropping
    // the only chunk a short document produced would lose the document.
    .filter((chunk, i, all) => chunk.length >= min || all.length === 1)
    .map((chunk, index) => ({ text: chunk, index }));
}
