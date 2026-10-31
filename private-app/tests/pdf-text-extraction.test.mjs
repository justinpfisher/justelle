import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractSelectablePdfText } from '../web/pdf-text-extraction.mjs';
import { extractBookingDraft } from '../web/booking-extraction.mjs';
import { syntheticBookingPdf } from './synthetic-booking-pdf.mjs';

test('pinned PDF.js reads selectable text locally for the existing deterministic booking parser', async () => {
  const bytes = syntheticBookingPdf('Hotel: Synthetic Inn\nCheck-in: 2027-06-05\nCheck-out: 2027-06-08\nBooking reference: FICT-204');
  const extracted = await extractSelectablePdfText(bytes, { getDocument: pdfjs.getDocument });
  assert.equal(extracted.pages, 1);
  assert.match(extracted.text, /Synthetic Inn/);
  const draft = extractBookingDraft(extracted.text);
  assert.deepEqual(draft.fields, { kind: 'stay', summary: 'Synthetic Inn', reference: 'FICT-204', starts_on: '2027-06-05', ends_on: '2027-06-08' });
  assert.equal(Object.hasOwn(draft.fields, 'status'), false);
});

test('rejects non-PDF input before invoking PDF.js', async () => {
  let called = false;
  await assert.rejects(extractSelectablePdfText(new TextEncoder().encode('not a pdf'), { getDocument() { called = true; } }), /valid PDF/);
  assert.equal(called, false);
});

test('bounds pages, text and load duration', async () => {
  const bytes = syntheticBookingPdf('Synthetic text');
  await assert.rejects(extractSelectablePdfText(bytes, { getDocument: () => ({ promise: Promise.resolve({ numPages: 13 }) }) }), /12 pages/);
  const pdf = { numPages: 1, getPage: async () => ({ getTextContent: async () => ({ items: [{ str: 'x'.repeat(5) }] }) }) };
  await assert.rejects(extractSelectablePdfText(bytes, { getDocument: () => ({ promise: Promise.resolve(pdf), destroy: async () => {} }), limits: { maxCharacters: 4 } }), /more text/);
  await assert.rejects(extractSelectablePdfText(bytes, { getDocument: () => ({ promise: new Promise(() => {}), destroy: async () => {} }), limits: { timeoutMs: 5 } }), /too long/);
});
test('cancels an in-flight PDF.js task when the owning form is invalidated', async () => {
  const bytes = syntheticBookingPdf('Synthetic text');
  const controller = new AbortController();
  let destroyed = 0;
  const pending = extractSelectablePdfText(bytes, {
    signal: controller.signal,
    getDocument: () => ({
      promise: new Promise(() => {}),
      destroy: async () => { destroyed++; }
    })
  });
  controller.abort();
  await assert.rejects(pending, error => error.name === 'AbortError');
  assert.equal(destroyed, 1);
});
test('returns no suggestions for a PDF without selectable text', async () => {
  const bytes = syntheticBookingPdf('');
  const result = await extractSelectablePdfText(bytes, { getDocument: pdfjs.getDocument });
  assert.equal(result.text, '');
  assert.equal(result.pages, 1);
});
