// Deterministic, offline-only reading of explicit fields in pasted booking text.
// No provider calls, free-form AI inference, supplier verification or auto-save.
const months=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const labels=/^\s*(check[ -]?in(?: date)?|check[ -]?out(?: date)?|departure(?: date)?|arrival(?: date)?|start(?: date)?|end(?: date)?|event date|date|booking title|property|hotel|supplier|operator|airline|flight number|train|rail|ferry|bus|event|activity|booking reference|reservation number)\s*:\s*(.*?)\s*$/i;
const weekday=/^(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\s*,?\s+/i;
const cleanLabel=s=>s.toLowerCase().replace(/[- ]/g,'');
function calendarDate(year,month,day){
  const y=Number(year),m=Number(month),d=Number(day);
  if(!Number.isSafeInteger(y)||y<1900||y>2200||
     !Number.isInteger(m)||m<1||m>12||!Number.isInteger(d)||d<1||d>31)return null;
  const actual=new Date(Date.UTC(y,m-1,d));
  if(actual.getUTCFullYear()!==y||actual.getUTCMonth()!==m-1||
     actual.getUTCDate()!==d)return null;
  return actual.toISOString().slice(0,10);
}
function monthNumber(name){
  const key=name.toLowerCase().replace(/\.$/,'');
  const normalized=key==='sept'?'sep':key.slice(0,3);
  return months.includes(normalized)?months.indexOf(normalized)+1:null;
}
export function explicitBookingDate(value){
  if(typeof value!=='string'||value.length>100)return null;
  let s=value.trim().replace(weekday,'');
  // Optional clock annotation is omitted deliberately: V1 stores local dates,
  // not reservation departure times or supplier time zones.
  s=s.replace(/\s*\([^()]*\)\s*$/,'')
    .replace(/\s+at\s+\d{1,2}:\d{2}(?:\s*(?:am|pm))?\s*$/i,'').trim();
  let m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if(m)return calendarDate(m[1],m[2],m[3]);
  m=/^([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i.exec(s);
  if(m)return calendarDate(m[3],monthNumber(m[1]),m[2]);
  m=/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?\s+(\d{4})$/i.exec(s);
  if(m)return calendarDate(m[3],monthNumber(m[2]),m[1]);
  return null;
}
const startLabels=new Set(['checkin','checkindate','departure','departuredate','start','startdate']);
const endLabels=new Set(['checkout','checkoutdate','arrival','arrivaldate','end','enddate']);
const dateLabels=new Set([...startLabels,...endLabels,'eventdate','date']);
const kinds={
  stay:new Set(['checkin','checkout','hotel','property']),
  flight:new Set(['airline','flightnumber']),
  transport:new Set(['train','rail','ferry','bus']),
  activity:new Set(['event','activity','eventdate'])
};
const first=(items)=>[...new Set(items)].length===1?[...new Set(items)][0]:null;
export function extractBookingDraft(source){
  if(typeof source!=='string'||!source.trim()||source.length>4000)
    throw Error('Paste up to 4,000 characters of a booking or travel note.');
  const starts=[],ends=[],hints=new Set(),values=new Map(),warnings=[];
  let recognised=0;
  const valueFor=(key,val)=>{const matches=values.get(key)||[];matches.push(val);values.set(key,matches);};
  for(const line of source.split(/\r?\n/)){
    const match=labels.exec(line);
    if(!match)continue;
    recognised++;
    const key=cleanLabel(match[1]),value=match[2].trim();
    for(const [kind,keys] of Object.entries(kinds))if(keys.has(key))hints.add(kind);
    if(dateLabels.has(key)){
      const date=explicitBookingDate(value);
      if(!date){warnings.push('A labelled date was unclear; enter it manually.');continue;}
      if(startLabels.has(key))starts.push(date);
      else if(endLabels.has(key))ends.push(date);
      else if(key==='eventdate'){starts.push(date);ends.push(date);}
      else starts.push(date); // Generic Date: no inferred checkout or return.
    }else if(value&&value.length<=180)valueFor(key,value);
    else if(value)warnings.push('An excessively long labelled field was left for manual review.');
  }
  const start=first(starts),end=first(ends);
  if(new Set(starts).size>1)warnings.push('Conflicting start dates were not copied.');
  if(new Set(ends).size>1)warnings.push('Conflicting end dates were not copied.');
  const kind=hints.size===1?[...hints][0]:null;
  if(hints.size>1)warnings.push('Multiple booking types appear; choose the type manually.');
  const summary=first([...(values.get('bookingtitle')||[]),
    ...(values.get('hotel')||[]),...(values.get('property')||[]),
    ...(values.get('event')||[])])||null;
  const supplier=first([...(values.get('supplier')||[]),
    ...(values.get('operator')||[]),...(values.get('airline')||[])])||null;
  const reference=first([...(values.get('bookingreference')||[]),
    ...(values.get('reservationnumber')||[])])||null;
  if(start&&end&&end<start)warnings.push('The end date precedes the start date; verify both.');
  if(start&&end&&start===end&&kind==='stay')
    warnings.push('Accommodation check-out must be after check-in.');
  if(!start||!end)warnings.push('Start and end dates must be reviewed and completed before saving.');
  if(/(?:^|\n)\s*(?:booking status|reservation status)\s*:\s*(?:cancelled|canceled|voided)/im.test(source)||
     /\byour (?:booking|reservation) (?:was|has been) cancel(?:led|ed)\b/i.test(source))
    warnings.push('The copied text indicates cancellation; do not treat it as a current confirmation.');
  if(!recognised)warnings.push('No supported labelled fields were found; enter the details manually.');
  return {fields:{...(kind?{kind}:{}),...(summary?{summary}:{}),
    ...(supplier?{supplier}:{}),...(reference?{reference}:{}),
    ...(start&&(!end||end>=start)?{starts_on:start}:{}),
    ...(end&&(!start||end>=start)&&!(start===end&&kind==='stay')?{ends_on:end}:{})},
    warnings:[...new Set(warnings)],recognised_labels:recognised,
    limitations:'Only explicitly labelled dates and fields were read locally. No booking was confirmed, supplier checked, time inferred or record saved.'};
}
