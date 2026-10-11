import { authenticate } from './identity.mjs';
const headers = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };
const response = (data, status = 200) => new Response(JSON.stringify(data), {status, headers:{...headers,'content-type':'application/json; charset=utf-8'}});
const bad = (msg, code=400) => response({error:msg},code);
const now = () => new Date().toISOString();
const newId = () => crypto.randomUUID();
const validBody = s => typeof s === 'string' && s.trim().length > 0 && s.trim().length <= 2000;
async function sha256Hex(bytes) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join(''); }
function base64(bytes) {
  let s = ''; const view = new Uint8Array(bytes);
  for(let i=0;i<view.length;i+=16384) s += String.fromCharCode(...view.subarray(i,i+16384));
  return btoa(s);
}
async function readInput(request) {try {return await request.json();} catch {return null;} }

// Injection is used only by the Node tests; the deployed default export always authenticates
// via signed Firebase JWTs. Missing Firebase project/member config fails closed.
export function makeWorker(verify = authenticate) {
  return { async fetch(request, env) {
    if (!env.DB || !env.MEDIA || !env.ROOM_ID) return bad('Service not configured',503);
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return bad('Not found',404);
    let actor;
    try { actor = await verify(request,env); } catch { return bad('Authentication unavailable',503); }
    if (!actor || !actor.members?.includes(actor.uid) || !actor.personId || actor.members.length!==2) return bad('Unauthorised',401);
    const room = env.ROOM_ID;
    const path = url.pathname;
    try {
      if (path==='/api/me' && request.method==='GET') return response({personId:actor.personId});
      if (path==='/api/messages' && request.method==='GET') {
        const result=await env.DB.prepare('SELECT * FROM messages WHERE room=? ORDER BY created_at,id').bind(room).all();
        return response(result.results);
      }
      if (path==='/api/messages' && request.method==='POST') {
        const data=await readInput(request);
        if (!validBody(data?.body)) return bad('Invalid message');
        const id=newId();
        await env.DB.prepare('INSERT INTO messages(id,room,author_id,body,created_at) VALUES(?,?,?,?,?)').bind(id,room,actor.personId,data.body.trim(),now()).run();
        return response({id},201);
      }
      if (path==='/api/decisions' && request.method==='GET') {
        const decisions=(await env.DB.prepare('SELECT * FROM decisions WHERE room=? ORDER BY created_at,id').bind(room).all()).results;
        const approvals=(await env.DB.prepare('SELECT a.decision_id,a.person_id FROM approvals a JOIN decisions d ON d.id=a.decision_id WHERE d.room=?').bind(room).all()).results;
        return response(decisions.map(d=>({...d,approvedBy:approvals.filter(x=>x.decision_id===d.id).map(x=>x.person_id)})));
      }
      if (path==='/api/decisions' && request.method==='POST') {
        const data=await readInput(request);
        if (!validBody(data?.body)) return bad('Invalid proposal');
        const id=newId();
        await env.DB.prepare('INSERT INTO decisions(id,room,author_id,body,status,created_at) VALUES(?,?,?,?,?,?)').bind(id,room,actor.personId,data.body.trim(),'proposed',now()).run();
        return response({id,status:'proposed'},201);
      }
      const approve = /^\/api\/decisions\/([a-f0-9-]+)\/approve$/.exec(path);
      if (approve && request.method==='POST') {
        const id=approve[1];
        // Atomic batch ensures duplicate approvals are idempotent and the two-person
        // transition cannot lose updates under concurrent requests.
        const record=await env.DB.prepare('SELECT status FROM decisions WHERE room=? AND id=?').bind(room,id).first();
        if (!record) return bad('Not found',404);
        if (record.status==='locked') return response({status:'locked'});
        await env.DB.batch([
          env.DB.prepare('INSERT OR IGNORE INTO approvals(decision_id,person_id,created_at) VALUES(?,?,?)').bind(id,actor.personId,now()),
          env.DB.prepare("UPDATE decisions SET status='locked' WHERE id=? AND room=? AND status='proposed' AND (SELECT COUNT(*) FROM approvals WHERE decision_id=?)=2").bind(id,room,id)
        ]);
        const after=await env.DB.prepare('SELECT status FROM decisions WHERE id=? AND room=?').bind(id,room).first();
        return response({status:after.status});
      }
      if (path==='/api/media' && request.method==='POST') {
        const mime=request.headers.get('content-type')?.split(';')[0];
        if (!['image/png','image/jpeg'].includes(mime)) return bad('Only PNG and JPEG supported');
        const size=Number(request.headers.get('content-length')||'0');
        if (size>1024*1024) return bad('File too large',413);
        const bytes=await request.arrayBuffer();
        if (!bytes.byteLength || bytes.byteLength>1024*1024) return bad('Invalid file size',413);
        const v=new Uint8Array(bytes);
        const isPng=v.length>=8 && [137,80,78,71,13,10,26,10].every((x,i)=>v[i]===x);
        const isJpeg=v.length>=4 && v[0]===255 && v[1]===216 && v[v.length-2]===255 && v[v.length-1]===217;
        if (mime==='image/png'&&!isPng || mime==='image/jpeg'&&!isJpeg) return bad('Incorrect file signature');
        const id=newId(), key=`${room}/${id}`;
        await env.MEDIA.put(key,bytes,{httpMetadata:{contentType:mime}});
        try {
          await env.DB.prepare('INSERT INTO media(id,room,author_id,object_key,mime,length,sha256,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(id,room,actor.personId,key,mime,bytes.byteLength,await sha256Hex(bytes),now()).run();
        } catch (e) {await env.MEDIA.delete(key); throw e;}
        return response({id},201);
      }
      const media = /^\/api\/media\/([a-f0-9-]+)$/.exec(path);
      if (media && request.method==='GET') {
        const record=await env.DB.prepare('SELECT * FROM media WHERE room=? AND id=?').bind(room,media[1]).first();
        if (!record) return bad('Not found',404);
        const file=await env.MEDIA.get(record.object_key);
        if (!file) return bad('Missing object',404);
        return new Response(file.body,{headers:{...headers,'content-type':record.mime,'content-disposition':'inline'}});
      }
      if (path==='/api/export' && request.method==='GET') {
        const messages=(await env.DB.prepare('SELECT * FROM messages WHERE room=? ORDER BY created_at,id').bind(room).all()).results;
        const decisions=(await env.DB.prepare('SELECT * FROM decisions WHERE room=? ORDER BY created_at,id').bind(room).all()).results;
        const approvals=(await env.DB.prepare('SELECT a.* FROM approvals a JOIN decisions d ON d.id=a.decision_id WHERE d.room=? ORDER BY a.decision_id,a.person_id').bind(room).all()).results;
        const records=(await env.DB.prepare('SELECT * FROM media WHERE room=? ORDER BY created_at,id').bind(room).all()).results;
        const files=[];
        for (const rec of records) {
          const object=await env.MEDIA.get(rec.object_key);
          if (!object) return bad('Export failed: missing file',409);
          const bytes=await object.arrayBuffer();
          if (await sha256Hex(bytes)!==rec.sha256) return bad('Export failed: corrupt file',409);
          files.push({id:rec.id,room:rec.room,author_id:rec.author_id,mime:rec.mime,sha256:rec.sha256,bytes:base64(bytes),created_at:rec.created_at});
        }
        return response({format:'justelle-poc-v1',room,messages,decisions,approvals,files});
      }
      return bad('Not found',404);
    } catch (e) {
      // No private record contents, credentials or user IDs in public errors.
      return bad('Request failed',500);
    }
  }};
}
export default makeWorker();
