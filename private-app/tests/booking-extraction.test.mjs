import {test} from 'node:test';
import assert from 'node:assert/strict';
import {explicitBookingDate,extractBookingDraft} from '../web/booking-extraction.mjs';

test('Explicit calendar dates accept ISO and unambiguous written English, not numeric ambiguities',()=>{
 for(const [input,expected] of [
  ['2027-12-11','2027-12-11'],
  ['Dec 11, 2027','2027-12-11'],
  ['Saturday, December 11, 2027','2027-12-11'],
  ['11 December 2027','2027-12-11'],
  ['Feb 29, 2028','2028-02-29'],
  ['Nov. 3rd, 2027','2027-11-03'],
  ['2027-12-11 at 14:30','2027-12-11']]){
   assert.equal(explicitBookingDate(input),expected,input);
 }
 for(const input of ['05/06/2027','12/11/2027','Feb 29, 2027','2027-02-30',
   'November 11','2027-13-01','December 32, 2027','2027-12-11 and 2027-12-12'])
   assert.equal(explicitBookingDate(input),null,'Do not infer '+input);
});
test('Pasted hotel fields are only proposals; original and booking status never generated',()=>{
 const original=['Hotel: Synthetic Waterfront Inn',
   'Check-in date: Saturday, December 11, 2027',
   'Check-out date: 14 December 2027',
   'Booking reference: FICTIONAL-123',
   'Issued: 2026-11-01',
   'Personal message: synthetic content not to reprint'].join('\n');
 const snapshot=original;
 const r=extractBookingDraft(original);
 assert.deepEqual(r.fields,{kind:'stay',summary:'Synthetic Waterfront Inn',
   reference:'FICTIONAL-123',starts_on:'2027-12-11',ends_on:'2027-12-14'});
 assert.equal(Object.hasOwn(r.fields,'status'),false);
 assert.equal(Object.hasOwn(r,'source'),false,'Caller separately retains the original bytes');
 assert.equal(JSON.stringify(r).includes('Personal message'),false);
 assert.match(r.limitations,/No booking was confirmed/);
 assert.equal(original,snapshot);
});
test('Different supplier types are not conflated and overnight arrivals are explicit',()=>{
 const flight=extractBookingDraft('Airline: Synthetic Air\nFlight number: SF212\nDeparture: 2027-12-10\nArrival: 11 December 2027');
 assert.deepEqual(flight.fields,{kind:'flight',supplier:'Synthetic Air',
   starts_on:'2027-12-10',ends_on:'2027-12-11'});
 const day=extractBookingDraft('Event date: 17 October 2027\nEvent: Fictional Museum');
 assert.deepEqual(day.fields,{kind:'activity',summary:'Fictional Museum',
   starts_on:'2027-10-17',ends_on:'2027-10-17'});
 const single=extractBookingDraft('Date: 2027-11-20');
 assert.equal(single.fields.starts_on,'2027-11-20');
 assert.equal(single.fields.ends_on,undefined,'A checkout/arrival is never invented');
 assert.match(single.warnings.join(' '),/reviewed and completed/);
});
test('Contradictions and cancellations trigger explicit review instead of manufacturing a valid stay',()=>{
 const contradictory=extractBookingDraft('Hotel: Synthetic Inn\nCheck-in: 2027-11-04\nCheck-in: 2027-11-05\nCheck-out: 2027-11-03\nReservation status: Cancelled');
 assert.equal(contradictory.fields.starts_on,undefined);
 assert.equal(contradictory.fields.ends_on,'2027-11-03');
 assert.match(contradictory.warnings.join(' '),/Conflicting start dates/);
 assert.match(contradictory.warnings.join(' '),/cancellation/);
 const backwards=extractBookingDraft('Check-in: 2027-11-05\nCheck-out: 2027-11-03');
 assert.equal(backwards.fields.starts_on,undefined);
 assert.equal(backwards.fields.ends_on,undefined);
 assert.match(backwards.warnings.join(' '),/end date precedes/);
 const same=extractBookingDraft('Check-in: 2027-11-05\nCheck-out: 2027-11-05');
 assert.equal(same.fields.ends_on,undefined);
 assert.match(same.warnings.join(' '),/Accommodation/);
});
test('No field extraction from arbitrary email dates, unknown language or oversized text',()=>{
 const raw='Subject: Booked on 2027-12-11\nPlease read these terms by 2027-12-21';
 const r=extractBookingDraft(raw);
 assert.deepEqual(r.fields,{});
 assert.match(r.warnings.join(' '),/No supported labelled fields/);
 const mixed=extractBookingDraft('Hotel: Fictional Inn\nFlight number: AB123\nDeparture: 2027-11-20');
 assert.equal(mixed.fields.kind,undefined);
 assert.match(mixed.warnings.join(' '),/Multiple booking types/);
 assert.throws(()=>extractBookingDraft('x'.repeat(4001)),/4,000/);
 assert.throws(()=>extractBookingDraft(''),/Paste/);
});
