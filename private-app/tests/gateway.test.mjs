import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createHash} from 'node:crypto';
import {createApiHandler} from '../hosting/api-handler.mjs';
import {createResponseService} from '../ai/response-service.mjs';
import {createMediaHandler} from '../hosting/media-handler.mjs';
const id='00000000-0000-4000-8000-000000000001';
const room={uids:['fictional-a','fictional-b'],people:{'fictional-a':'person-a','fictional-b':'person-b'}};
const member={uid:'fictional-a',justelle_member:true,justelle_room:'fictional-room',auth_time:100};
function res(){return {headersSent:false,writeHead(s,h){this.status=s;this.headers=h;this.headersSent=true;},end(body=''){this.body=body;}};}
function req(body={},extra={}){return {url:'/api/respond',method:'POST',headers:{authorization:'Bearer fictional-token','content-type':'application/json'},rawBody:Buffer.from(JSON.stringify(body)),...extra};}
test('Hosted JSON body reaches response service; untrusted extra fields, methods and oversized payloads are denied',async()=>{
  const calls=[],handler=createApiHandler({origin:'https://fictional.web.app',media:()=>{},respond:async(t,s)=>{calls.push({t,s});return {message_id:s};}});
  const good=res();await handler(req({source_message_id:id}),good);assert.equal(good.status,200);assert.deepEqual(calls,[{t:'fictional-token',s:id}]);
  for(const [request,status] of [[req({source_message_id:id,lock:true}),400],[req({}, {method:'GET'}),405],
    [req({}, {headers:{'content-type':'application/json'}}),401],[req({}, {rawBody:Buffer.alloc(4097)}),413],
    [req({}, {headers:{origin:'https://outsider.invalid'}}),403]]){
    const result=res();await handler(request,result);assert.equal(result.status,status);
  }
  assert.equal(calls.length,1);
});
test('Firebase-consumed image streams use rawBody and remain immutable',async()=>{
  let bytes,options;
  const handler=createMediaHandler({roomId:'fictional-room',verifyIdentity:async()=>member,readMembership:async()=>room,
    bucket:{file:()=>({save:async(b,o)=>{bytes=b;options=o;},getMetadata:async()=>[{}]})}});
  const request=Readable.from([]);Object.assign(request,{url:'/api/media/'+id+'/original',method:'PUT',
    headers:{authorization:'Bearer token','content-type':'image/png'},rawBody:Buffer.from('synthetic')});
  const result=res();await handler(request,result);assert.equal(result.status,201);assert.equal(bytes.toString(),'synthetic');assert.equal(options.preconditionOpts.ifGenerationMatch,0);
});
function service({identity=member,revoked=false,settings=room,heic=false,tokenMetadata=false}={}){
  const image=Buffer.from('synthetic-original'),preview=Buffer.from('synthetic-jpeg'),writes=[],calls=[];
  const path='rooms/fictional-room';
  const source={kind:'person',body:'Please suggest a plan',author_id:'person-a',conversation_id:'conversation-shared',attachment_ids:[id]};
  const documents=new Map([[path,settings],[path+'/messages/'+id,source],[path+'/attachments/'+id,{id,mime:heic?'image/heic':'image/png',size:image.length,
    sha256:createHash('sha256').update(image).digest('hex'),original_path:path+'/media/'+id,preview_path:heic?path+'/media/'+id+'-preview':null}]]);
  const snap=key=>({id:key.split('/').at(-1),exists:documents.has(key),data:()=>documents.get(key)});
  const query={where(){return this;},orderBy(){return this;},limit(){return this;},async get(){return {docs:[]};}};
  const db={doc:key=>({id:key.split('/').at(-1),get:async()=>snap(key)}),collection:()=>query,batch:()=>({create:(ref,row)=>writes.push({ref,row}),commit:async()=>{}})};
  const response=createResponseService({db,roomId:'fictional-room',verifyIdentity:async(t,o)=>{assert.equal(o.checkRevoked,true);if(revoked)throw Error('Revoked');return identity;},
    serverTimestamp:()=>new Date(),provider:async()=>({name:'qualified-vision',respond:async input=>{calls.push(input);return {reply:'Synthetic reply',proposal:{body:'Synthetic suggestion',why:'Both decide'}};}}),
    bucket:{file:key=>({getMetadata:async()=>[{contentType:key.endsWith('-preview')?'image/jpeg':heic?'image/heic':'image/png',size:key.endsWith('-preview')?preview.length:image.length,
      metadata:{attachment_id:id,role:key.endsWith('-preview')?'preview':'original',...(tokenMetadata?{firebaseStorageDownloadTokens:'forbidden'}:{})}}],download:async()=>[key.endsWith('-preview')?preview:image]})}});
  return {response,writes,calls,documents};
}
test('Hosted response supplies verified permission, uses JPEG for HEIC and creates only unapproved suggestions',async()=>{
  const s=service({heic:true});await s.response('token',id);
  assert.equal(s.calls[0].message.id,id);assert.equal(s.calls[0].permission.sourceMessageId,id);
  assert.equal(s.calls[0].images[0].mime,'image/jpeg');assert.equal(Buffer.from(s.calls[0].images[0].bytes).toString(),'synthetic-jpeg');
  assert.equal(s.writes.length,2);assert.equal(s.writes[0].row.author_id,'ai-justelle');
  assert.equal(s.writes[1].row.status,'proposed');assert.deepEqual(s.writes[1].row.approvals,{});assert.equal(s.writes[1].row.locked_at,null);
  s.documents.set('rooms/fictional-room/messages/ai-'+id,{});
  assert.equal((await s.response('token',id)).replayed,true);assert.equal(s.calls.length,1);
});
test('Outsiders, revoked identities, room revocation and token-bearing originals never reach the AI provider',async()=>{
  for(const [options,status] of [[{identity:{...member,uid:'outsider'}},403],[{revoked:true},401],
    [{settings:{...room,revoked_auth_before:{'fictional-a':100}}},401],[{tokenMetadata:true},503]]){
    const s=service(options);await assert.rejects(s.response('token',id),e=>e.status===status);assert.equal(s.calls.length,0);assert.equal(s.writes.length,0);
  }
});

test('A lost upload acknowledgement replays only identical bytes from the original author without overwriting',async()=>{
  const bytes=Buffer.from('synthetic-image'),sha256=createHash('sha256').update(bytes).digest('hex');
  let identity=member,metadata={contentType:'image/png',size:bytes.length,metadata:{author_uid:member.uid,attachment_id:id,role:'original',sha256}};
  const handler=createMediaHandler({roomId:'fictional-room',verifyIdentity:async()=>identity,readMembership:async()=>room,
    bucket:{file:()=>({save:async()=>{throw Object.assign(Error('Already exists'),{code:412});},getMetadata:async()=>[metadata]})}});
  const request=()=>({url:'/api/media/'+id+'/original',method:'PUT',rawBody:bytes,headers:{authorization:'Bearer token','content-type':'image/png'}});
  const replay=res();await handler(request(),replay);assert.equal(replay.status,200);assert.equal(JSON.parse(replay.body).replayed,true);
  identity={...member,uid:'fictional-b'};const other=res();await handler(request(),other);assert.equal(other.status,409);
  identity=member;metadata={...metadata,metadata:{...metadata.metadata,sha256:'0'.repeat(64)}};
  const changed=res();await handler(request(),changed);assert.equal(changed.status,409);
});

test('Source PDFs use the protected immutable gateway; outsiders and altered replays fail',async()=>{
  const bytes=Buffer.from('%PDF-1.4\\nfictional\\n%%EOF'),digest=createHash('sha256').update(bytes).digest('hex');
  let identity=member,metadata=null,writes=0;
  const handler=createMediaHandler({roomId:'fictional-room',
    verifyIdentity:async()=>identity,readMembership:async()=>room,
    bucket:{file:()=>({
      async save(data,{metadata:headers,preconditionOpts}){
        assert.equal(preconditionOpts.ifGenerationMatch,0);
        if(metadata)throw Object.assign(Error('Already exists'),{code:412});
        assert.deepEqual(data,bytes);
        writes++;
        metadata={contentType:headers.contentType,size:data.length,
          metadata:{...headers.metadata}};
      },
      async getMetadata(){return [metadata];},
      createReadStream(){return Readable.from([bytes]);}
    })}});
  const url='/api/media/documents/'+id;
  const send=()=>({url,method:'PUT',rawBody:bytes,headers:{authorization:'Bearer fictional-token', 'content-type':'application/pdf'}});
  const put=res();await handler(send(),put);
  assert.equal(put.status,201);assert.equal(writes,1);
  assert.equal(metadata.metadata.sha256,digest);
  const retry=res();await handler(send(),retry);
  assert.equal(retry.status,200);assert.equal(writes,1);
  const read=res();const result=[];
  read.write=chunk=>{result.push(Buffer.from(chunk));return true;};
  await handler({url,method:'GET',headers:{authorization:'Bearer fictional-token'}},read);
  assert.equal(read.status,200);assert.deepEqual(Buffer.concat(result),bytes);
  identity={...member,uid:'outsider'};
  const forbidden=res();await handler(send(),forbidden);assert.equal(forbidden.status,403);
  identity=member;metadata.metadata.firebaseStorageDownloadTokens='public-token';
  const token=res();await handler({url,method:'GET',headers:{authorization:'Bearer fictional-token'}},token);
  assert.equal(token.status,503);
  const changed=res();
  await handler({url,method:'PUT',rawBody:Buffer.from('altered'),
    headers:{authorization:'Bearer fictional-token','content-type':'application/pdf'}},changed);
  assert.equal(changed.status,409);
});

test('Typed planner route needs bearer, exact source/revision shape and trusted origin',async()=>{
 const calls=[],handler=createApiHandler({origin:'https://fictional.web.app',
   media:()=>{},respond:async()=>({message_id:id}),
   planSuggest:async(token,body)=>{calls.push({token,body});return {
     kind:'preview',revision:body.revision,source_id:body.source_id};}});
 const input={plan_id:'fictional-trip',revision:0,source_id:id};
 const request=(body=input,extra={})=>req(body,{url:'/api/plan/suggest',...extra});
 const good=res();await handler(request(),good);
 assert.equal(good.status,200);
 assert.deepEqual(calls,[{token:'fictional-token',body:input}]);
 for(const [item,code] of [
   [request({...input,modify_booking:true}),400],
   [request({...input,revision:'zero'}),400],
   [request({}, {method:'GET'}),405],
   [request({}, {headers:{'content-type':'application/json'}}),401],
   [request({}, {headers:{origin:'https://outsider.invalid'}}),403]
 ]){
   const response=res();await handler(item,response);assert.equal(response.status,code);
 }
 assert.equal(calls.length,1,'Malformed requests never reach the service');
});
