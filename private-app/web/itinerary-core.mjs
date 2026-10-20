// Provider-independent adventure planning model. Firestore commits the returned
// current plan and immutable event atomically; this module never writes data.
export const ITINERARY_SCHEMA = 'justelle-itinerary-v1';
const idPattern = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const kinds = ['stay', 'flight', 'transport', 'activity'];
const isId = value => typeof value === 'string' && idPattern.test(value);
const checkId = value => { if (!isId(value)) throw Error('Invalid stable ID'); return value; };
const clean = (value, max = 200) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw Error('Invalid text');
  return value.trim();
};
const isoDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(value + 'T12:00:00Z')) &&
  new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) === value;
const isoMonth = value => typeof value === 'string' &&
  /^(19|20|21|22)\d{2}-(0[1-9]|1[0-2])$/.test(value);
const clone = value => structuredClone(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const verifyPlan = plan => {
  if (!plan || plan.schema !== ITINERARY_SCHEMA || !isId(plan.id) ||
      !Number.isInteger(plan.duration_days) || plan.duration_days < 1 || plan.duration_days > 90 ||
      !Number.isSafeInteger(plan.revision) || plan.revision < 0 ||
      (plan.starts_on !== null && !isoDate(plan.starts_on)) ||
      (plan.starts_month != null && !isoMonth(plan.starts_month)) ||
      (plan.starts_on !== null && plan.starts_month != null) ||
      !['planning', 'archived'].includes(plan.status) ||
      !Array.isArray(plan.stops) || !Array.isArray(plan.bookings) || !Array.isArray(plan.lessons) ||
      (plan.experiences !== undefined && !Array.isArray(plan.experiences)))
    throw Error('Unsupported adventure plan');
  return plan;
};
const span = (record, plan) => {
  if (!Number.isInteger(record.from_day) || !Number.isInteger(record.through_day) ||
      record.from_day < 1 || record.through_day <= record.from_day ||
      record.through_day > plan.duration_days + 1) throw Error('Days exceed the trip');
};
function stop(value, plan) {
  if (!value || typeof value !== 'object') throw Error('Missing stop');
  const s = {
    id: checkId(value.id), place_id: checkId(value.place_id),
    title: clean(value.title), from_day: value.from_day,
    through_day: value.through_day, status: value.status || 'possible',
    latitude: value.latitude ?? null, longitude: value.longitude ?? null
  };
  if (!['possible', 'planned'].includes(s.status)) throw Error('Invalid stop status');
  if ((s.latitude === null) !== (s.longitude === null) ||
      (s.latitude !== null && (!Number.isFinite(s.latitude) || !Number.isFinite(s.longitude) ||
      s.latitude < -90 || s.latitude > 90 || s.longitude < -180 || s.longitude > 180)))
    throw Error('Invalid map coordinates');
  span(s, plan);
  return s;
}
// Optional on legacy plan snapshots so existing adventures gain experiences on first edit.
function experience(value, plan) {
  if (!value || typeof value !== 'object') throw Error('Missing experience');
  const e = {id:checkId(value.id),title:clean(value.title,200),day:value.day,
    status:value.status || 'possible',notes:value.notes ?? ''};
  if (!Number.isInteger(e.day) || e.day < 1 || e.day > plan.duration_days ||
      !['possible','planned'].includes(e.status) ||
      typeof e.notes !== 'string' || e.notes.length > 1000)
    throw Error('Invalid experience day, status or notes');
  return e;
}
function booking(value, plan) {
  if (!value || typeof value !== 'object') throw Error('Missing booking');
  const b = {
    id: checkId(value.id), kind: value.kind,
    stop_id: value.stop_id == null ? null : checkId(value.stop_id),
    starts_on: value.starts_on, ends_on: value.ends_on,
    status: value.status,
    source_id: value.source_id == null ? null : checkId(value.source_id),
    summary: clean(value.summary, 500)
  };
  if (!kinds.includes(b.kind) || !['unverified', 'confirmed', 'cancelled', 'voided'].includes(b.status))
    throw Error('Invalid booking kind or status');
  if (!isoDate(b.starts_on) || !isoDate(b.ends_on) ||
      b.starts_on > b.ends_on ||
      (b.kind === 'stay' && b.starts_on === b.ends_on))
    throw Error('Invalid booking calendar dates');
  return b;
}
export function createItinerary({id, title, durationDays = 21, startsOn = null, startsMonth = null}) {
  checkId(id); clean(title, 160);
  if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 90) throw Error('Invalid trip duration');
  if (startsOn !== null && !isoDate(startsOn)) throw Error('Invalid calendar date');
  if (startsMonth !== null && !isoMonth(startsMonth)) throw Error('Invalid approximate month');
  if (startsOn !== null && startsMonth !== null)
    throw Error('Choose either a precise date or an approximate month');
  return {schema: ITINERARY_SCHEMA, id, title: title.trim(), duration_days: durationDays,
    starts_on: startsOn, starts_month: startsMonth, status: 'planning',
    stops: [], experiences: [], bookings: [], lessons: [],
    revision: 0, last_event_id: null};
}
function collectionUpdate(plan, key, id, nextRecord) {
  const i = plan[key].findIndex(item => item.id === id);
  if (i < 0 && nextRecord === null) throw Error('Item does not exist');
  const before = i < 0 ? null : clone(plan[key][i]);
  if (i < 0) plan[key].push(nextRecord);
  else if (nextRecord === null) plan[key].splice(i, 1);
  else plan[key][i] = nextRecord;
  return before;
}
function readRecord(plan, key, id) {return (plan[key] ?? []).find(item => item.id === id) || null;}
export function applyItineraryEdit(input, change, {eventId, actorId, at, lastEvent = null}) {
  const original = verifyPlan(input);
  checkId(eventId); checkId(actorId);
  if (eventId === original.last_event_id || typeof at !== 'string' || Number.isNaN(Date.parse(at)))
    throw Error('Invalid event metadata');
  if (!change || typeof change.type !== 'string') throw Error('Invalid change');
  const plan = clone(original);
  let collection = null, recordId = null, before = null, after = null;
  if (change.type === 'add_stop') {
    collection = 'stops'; after = stop(change.stop, plan); recordId = after.id;
    if (readRecord(plan, collection, recordId)) throw Error('Stop already exists');
    collectionUpdate(plan, collection, recordId, after);
  } else if (change.type === 'edit_stop' || change.type === 'remove_stop') {
    collection = 'stops'; recordId = checkId(change.id);
    const old = readRecord(plan, collection, recordId);
    if (!old) throw Error('Stop does not exist');
    if (change.type === 'edit_stop') {
      const allowed = ['place_id', 'title', 'from_day', 'through_day', 'status', 'latitude', 'longitude'];
      if (!change.patch || Object.keys(change.patch).some(k => !allowed.includes(k))) throw Error('Invalid stop patch');
      after = stop({...old, ...change.patch}, plan);
    }
    before = collectionUpdate(plan, collection, recordId, after);
  } else if (change.type === 'add_experience') {
    collection = 'experiences';plan.experiences ??= [];
    after = experience(change.experience,plan);recordId = after.id;
    if (readRecord(plan,collection,recordId)) throw Error('Experience already exists');
    collectionUpdate(plan,collection,recordId,after);
  } else if (change.type === 'edit_experience' || change.type === 'remove_experience') {
    collection = 'experiences';recordId = checkId(change.id);
    const old = readRecord(plan,collection,recordId);
    if (!old) throw Error('Experience does not exist');
    if (change.type === 'edit_experience') {
      const allowed = ['title','day','status','notes'];
      if (!change.patch || !Object.keys(change.patch).length ||
          Object.keys(change.patch).some(k => !allowed.includes(k)))
        throw Error('Invalid experience patch');
      after = experience({...old,...change.patch},plan);
    }
    before = collectionUpdate(plan,collection,recordId,after);
  } else if (change.type === 'add_booking') {
    collection = 'bookings'; after = booking(change.booking, plan); recordId = after.id;
    if (readRecord(plan, collection, recordId)) throw Error('Booking already exists');
    collectionUpdate(plan, collection, recordId, after);
  } else if (change.type === 'correct_booking') {
    collection = 'bookings'; recordId = checkId(change.id);
    const old = readRecord(plan, collection, recordId);
    if (!old) throw Error('Booking does not exist');
    const allowed = ['kind', 'stop_id', 'starts_on', 'ends_on', 'status', 'source_id', 'summary'];
    if (!change.patch || Object.keys(change.patch).some(k => !allowed.includes(k))) throw Error('Invalid booking correction');
    after = booking({...old, ...change.patch}, plan);
    before = collectionUpdate(plan, collection, recordId, after);
  } else if (change.type === 'add_lesson') {
    collection = 'lessons'; recordId = checkId(change.id);
    if (readRecord(plan, collection, recordId)) throw Error('Lesson already exists');
    after = {id: recordId, text: clean(change.text, 2000)};
    collectionUpdate(plan, collection, recordId, after);
  } else if (change.type === 'edit_trip') {
    collection = 'trip'; recordId = original.id;
    const patch = change.patch;
    const allowed = ['title', 'starts_on', 'starts_month', 'duration_days'];
    if (!patch || !Object.keys(patch).length || Object.keys(patch).some(k => !allowed.includes(k)))
      throw Error('Invalid trip edit');
    before = {title: plan.title, starts_on: plan.starts_on, duration_days: plan.duration_days};
    // Old events did not have starts_month. Their original before/after shape
    // must be preserved for independent archive verification and Undo.
    if (Object.hasOwn(plan,'starts_month')) before.starts_month=plan.starts_month;
    after = {...before, ...patch};
    if (patch.starts_on != null && !Object.hasOwn(patch,'starts_month'))
      after.starts_month = null;
    if (patch.starts_month != null && !Object.hasOwn(patch,'starts_on'))
      after.starts_on = null;
    clean(after.title, 160);
    if (after.starts_on !== null && !isoDate(after.starts_on)) throw Error('Invalid calendar date');
    if (after.starts_month != null && !isoMonth(after.starts_month))
      throw Error('Invalid approximate month');
    if (after.starts_on !== null && after.starts_month != null)
      throw Error('Choose either a precise date or an approximate month');
    if (!Number.isInteger(after.duration_days) || after.duration_days < 1 || after.duration_days > 90 ||
        (plan.stops.some(s => s.through_day > after.duration_days + 1) ||
         (plan.experiences ?? []).some(e => e.day > after.duration_days)))
      throw Error('Trip duration conflicts with current stops');
    Object.assign(plan, after);
  } else if (change.type === 'set_status') {
    collection = 'status'; recordId = original.id;
    if (!['planning', 'archived'].includes(change.status)) throw Error('Invalid adventure status');
    before = plan.status; after = change.status; plan.status = after;
  } else if (change.type === 'undo_last') {
    if (!lastEvent || lastEvent.id !== original.last_event_id ||
        lastEvent.revision !== original.revision ||
        !['stops', 'experiences', 'bookings', 'lessons', 'status', 'trip'].includes(lastEvent.collection))
      throw Error('Latest event required for undo');
    collection = lastEvent.collection; recordId = lastEvent.record_id;
    if (collection === 'trip') {
      const current = {title: plan.title, starts_on: plan.starts_on, duration_days: plan.duration_days};
      if (Object.hasOwn(plan,'starts_month')) current.starts_month=plan.starts_month;
      if (!same(current, lastEvent.after)) throw Error('Trip changed since this event');
      before = current; after = clone(lastEvent.before); Object.assign(plan, after);
      if (!Object.hasOwn(after,'starts_month')) delete plan.starts_month;
    } else if (collection === 'status') {
      if (plan.status !== lastEvent.after) throw Error('Current status has changed');
      before = plan.status; after = lastEvent.before; plan.status = after;
    } else {
      const current = readRecord(plan, collection, recordId);
      if (!same(current, lastEvent.after)) throw Error('Item changed since this event');
      before = clone(current); after = clone(lastEvent.before);
      if (current === null && after !== null) plan[collection].push(after);
      else collectionUpdate(plan, collection, recordId, after);
    }
  } else throw Error('Unsupported plan change');
  plan.revision++;
  const event = {id: eventId, adventure_id: plan.id, revision: plan.revision,
    previous_event_id: original.last_event_id, actor_id: actorId, at,
    operation: change.type, collection, record_id: recordId, before: clone(before), after: clone(after)};
  plan.last_event_id = eventId;
  return {plan, event};
}
function dateAt(start, day) {
  if (!start) return null;
  const dt = new Date(start + 'T12:00:00Z');
  dt.setUTCDate(dt.getUTCDate() + day - 1);
  return dt.toISOString().slice(0, 10);
}
export function itineraryDays(input) {
  const plan = verifyPlan(input);
  return Array.from({length: plan.duration_days}, (_, i) => {
    const day = i + 1, date = dateAt(plan.starts_on, day);
    return {day, date,
      stops: plan.stops.filter(s => s.from_day <= day && day < s.through_day),
      experiences: (plan.experiences ?? []).filter(e => e.day === day),
      bookings: date === null ? [] : plan.bookings.filter(b => b.kind === 'stay' ?
        (b.starts_on <= date && date < b.ends_on) : b.starts_on === date)};
  });
}
export function itinerarySignals(input) {
  const plan = verifyPlan(input), signals = [];
  const planned = plan.stops.filter(s => s.status === 'planned');
  for (let i = 0; i < planned.length; i++) for (let j = i + 1; j < planned.length; j++) {
    const a = planned[i], b = planned[j];
    if (a.from_day < b.through_day && b.from_day < a.through_day)
      signals.push({code: 'overlapping_planned_stays', stop_ids: [a.id, b.id]});
  }
  for (const b of plan.bookings.filter(x => x.status === 'confirmed')) {
    const s = b.stop_id && plan.stops.find(x => x.id === b.stop_id);
    if (b.stop_id && !s) signals.push({code: 'booking_without_stop', booking_id: b.id});
    else if (s && b.kind === 'stay' && plan.starts_on &&
      (dateAt(plan.starts_on,s.from_day) !== b.starts_on ||
       dateAt(plan.starts_on,s.through_day) !== b.ends_on))
      signals.push({code: 'booking_plan_mismatch', booking_id: b.id, stop_id: s.id});
  }
  if (plan.starts_on) {
    const end = dateAt(plan.starts_on,plan.duration_days+1);
    for (const b of plan.bookings.filter(x => x.status === 'confirmed'))
      if (b.starts_on < plan.starts_on || b.starts_on >= end ||
          (b.kind === 'stay' && b.ends_on > end))
        signals.push({code:'booking_outside_trip',booking_id:b.id});
  }
  return signals;
}
export function sortAdventurePlans(plans, today) {
  if (!isoDate(today)) throw Error('Invalid comparison date');
  const key = p => {
    verifyPlan(p);
    if (p.status === 'archived') return [3, '9999-12-31'];
    if (!p.starts_on && p.starts_month){
      // Month-only is genuinely uncertain: no day can be inferred. Retain it
      // among upcoming/current ideas until its entire named month has passed.
      return p.starts_month >= today.slice(0,7) ?
        [0,p.starts_month+'-00'] : [1,p.starts_month+'-99'];
    }
    if (!p.starts_on) return [2, '9999-12-31'];
    const end = dateAt(p.starts_on, p.duration_days);
    return end >= today ? [0, p.starts_on <= today ? today : p.starts_on] : [1, p.starts_on];
  };
  return [...plans].sort((a,b) => {
    const x = key(a), y = key(b);
    return x[0]-y[0] || x[1].localeCompare(y[1]) || a.id.localeCompare(b.id);
  });
}
