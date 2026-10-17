// HTTP handler core for a separately qualified HTTPS deployment.
// Dependencies grant verified identity, membership reads and one private bucket.
import {createHash} from 'node:crypto';
const MAX=12*1024*1024;
const ALLOWED=new Set(['image/png','image/jpeg','image/heic','image/heif']);
const DOCUMENTS=new Set([...ALLOWED,'application/pdf']);
const deny=(status,message)=>Object.assign(Error(message),{status});
export async function approvedMember(token,{verifyIdentity,readMembership,roomId}){
  if(!token)throw deny(401,'Sign-in required');
  let identity;try{identity=await verifyIdentity(token,{checkRevoked:true});}catch{throw deny(401,'Sign-in required');}
  if(identity.justelle_member!==true||identity.justelle_room!==roomId)throw deny(403,'Member access required');
  const room=await readMembership(roomId);
  if(!room?.uids?.includes(identity.uid)||!room.people?.[identity.uid]||room.uids.length!==2)throw deny(403,'Member access required');
  if((identity.auth_time||0)<=(room.revoked_auth_before?.[identity.uid]??-1))throw deny(401,'Sign-in required');
  return {uid:identity.uid,personId:room.people[identity.uid],roomId};
}
export function createMediaHandler(dependencies){
  return async(req,res)=>{
    const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
    function response(status,body){res.writeHead(status,{...headers,'Content-Type':'application/json'});res.end(JSON.stringify(body));}
    try{
      const bearer=/^Bearer (.+)$/.exec(req.headers.authorization||'');
      const member=await approvedMember(bearer?.[1],dependencies);
      const docMatch=/^\/api\/media\/documents\/([a-f0-9-]{36})$/.exec(req.url||'');
      const match=/^\/api\/media\/([a-f0-9-]{36})\/(original|preview)$/.exec(req.url||'');
      if((!match&&!docMatch)||!['GET','PUT'].includes(req.method))throw deny(404,'File not found');
      const id=docMatch?docMatch[1]:match[1],variant=docMatch?'document':match[2];
      const path=variant==='document'?'rooms/'+member.roomId+'/documents/'+id:
        'rooms/'+member.roomId+'/media/'+id+(variant==='preview'?'-preview':'');
      const file=dependencies.bucket.file(path);
      if(req.method==='PUT'){
        const mime=req.headers['content-type'];
        if(!(variant==='document'?DOCUMENTS:ALLOWED).has(mime)||(variant==='preview'&&mime!=='image/jpeg'))throw deny(400,'Unsupported file');
        const chunks=[];let size=0;
        const body=req.rawBody?[req.rawBody]:req;
        for await(const input of body){size+=input.length;if(size>MAX)throw deny(413,'Image too large');chunks.push(input);}
        if(size===0)throw deny(400,'Choose a file');const bytes=Buffer.concat(chunks);
        // GCS API, not Firebase upload endpoints. No signed URL or download token.
        const sha256=createHash('sha256').update(bytes).digest('hex');
        let replayed=false;
        try{
          await file.save(bytes,{resumable:false,preconditionOpts:{ifGenerationMatch:0},metadata:{
            contentType:mime,cacheControl:'private, no-store',metadata:{author_uid:member.uid,attachment_id:id,role:variant,sha256}
          }});
        }catch(e){
          if(e.code!==412)throw e;
          const [existing]=await file.getMetadata();
          if(existing.metadata?.firebaseStorageDownloadTokens||existing.contentType!==mime||Number(existing.size)!==size||
            existing.metadata?.author_uid!==member.uid||existing.metadata?.attachment_id!==id||
            existing.metadata?.role!==variant||existing.metadata?.sha256!==sha256)throw deny(409,'This file is already saved differently');
          replayed=true;
        }
        const [metadata]=await file.getMetadata();
        if(metadata.metadata?.firebaseStorageDownloadTokens)throw deny(503,'Private file storage requires qualification');
        response(replayed?200:201,{id,variant,size,sha256,replayed});return;
      }
      const [metadata]=await file.getMetadata();
      if(metadata.metadata?.firebaseStorageDownloadTokens||!(variant==='document'?DOCUMENTS:ALLOWED).has(metadata.contentType)||
        Number(metadata.size)>MAX||metadata.metadata?.attachment_id!==id||metadata.metadata?.role!==variant)
        throw deny(503,'Private file storage requires qualification');
      res.writeHead(200,{...headers,'Content-Type':metadata.contentType,'Content-Length':metadata.size});
      for await(const chunk of file.createReadStream())if(!res.write(chunk))await new Promise(resolve=>res.once('drain',resolve));res.end();
    }catch(e){
      if(res.headersSent){res.destroy();return;}
      const status=e.status||(e.code===412?409:e.code===404?404:503);
      response(status,{error:status===409?'This file is already saved':status===503?'Private file service unavailable':e.message});
    }
  };
}
