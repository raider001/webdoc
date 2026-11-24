import { loadDoc, type Doc } from './catalog.js';
import { renderDoc } from './reader.js';

/** Revalidate only the displayed source; capture reading state after the await. */
export async function refreshReadingDocument(doc: Doc, stillCurrent: () => boolean): Promise<void> {
  const body = doc.body, meta = JSON.stringify(doc.meta);
  await loadDoc(doc, true);
  if (stillCurrent() && (doc.body !== body || JSON.stringify(doc.meta) !== meta)) renderDoc(doc, { preserveReading: true });
}
