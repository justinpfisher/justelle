import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { extractSelectablePdfText } from './pdf-text-extraction.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export function extractPdfBookingText(bytes) {
  return extractSelectablePdfText(bytes, { getDocument: pdfjs.getDocument });
}
