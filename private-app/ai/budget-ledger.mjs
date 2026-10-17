// Persistent shared reservations. The server owns this collection; clients cannot write it.
// Reserve the worst-case approved cost before a model call. Unknown failures retain it.
export class FirestoreBudgetLedger{
  constructor({db,roomId,monthlyCadMicros,dailyCadMicros}){
    for(const n of [monthlyCadMicros,dailyCadMicros])if(!Number.isSafeInteger(n)||n<=0)throw Error('An explicit positive CAD budget is required');
    if(dailyCadMicros>monthlyCadMicros)throw Error('Daily budget exceeds monthly budget');
    this.db=db;this.roomId=roomId;this.monthly=monthlyCadMicros;this.daily=dailyCadMicros;
  }
  periods(now=new Date()){
    const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).map(x=>[x.type,x.value]));
    return {month:p.year+'-'+p.month,day:p.year+'-'+p.month+'-'+p.day};
  }
  async reserve({id,fingerprint,ceilingCadMicros,now=new Date()}){
    if(!/^[a-f0-9]{64}$/.test(id)||!/^[a-f0-9]{64}$/.test(fingerprint)||!Number.isSafeInteger(ceilingCadMicros)||ceilingCadMicros<=0)throw Error('Invalid AI reservation');
    const periods=this.periods(now),root='rooms/'+this.roomId;
    const receipt=this.db.doc(root+'/ai_requests/'+id),month=this.db.doc(root+'/ai_budgets/month-'+periods.month),day=this.db.doc(root+'/ai_budgets/day-'+periods.day);
    return this.db.runTransaction(async t=>{
      const [existing,m,d]=await Promise.all([t.get(receipt),t.get(month),t.get(day)]);
      if(existing.exists){
        const r=existing.data();if(r.fingerprint!==fingerprint)throw Error('AI request changed after reservation');
        if(r.state==='completed')return {replayed:true,result:r.result};
        throw Error('That AI request is already running or needs recovery; no second paid call was made');
      }
      const total=m.data()?.reserved_cad_micros||0,today=d.data()?.reserved_cad_micros||0;
      if(total+ceilingCadMicros>this.monthly||today+ceilingCadMicros>this.daily)throw Error('Justelle has reached its AI allowance for now');
      t.set(month,{reserved_cad_micros:total+ceilingCadMicros,updated_at:now.toISOString()});
      t.set(day,{reserved_cad_micros:today+ceilingCadMicros,updated_at:now.toISOString()});
      t.create(receipt,{state:'reserved',fingerprint,ceiling_cad_micros:ceilingCadMicros,created_at:now.toISOString(),month:periods.month,day:periods.day});
      return {replayed:false};
    });
  }
  async complete({id,result}){
    const receipt=this.db.doc('rooms/'+this.roomId+'/ai_requests/'+id);
    await this.db.runTransaction(async t=>{
      const snap=await t.get(receipt);if(!snap.exists||snap.data().state!=='reserved')throw Error('AI reservation is not pending');
      t.update(receipt,{state:'completed',result});
    });
  }
}
