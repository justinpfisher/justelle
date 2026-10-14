// HTTP handler core for a separately qualified HTTPS deployment.
// Dependencies grant verified identity, membership reads and one private bucket.
import {createHash} from 'node:crypto';
const MAX=12*1024*1024;
const ALLOWED=new Set(['image/png','image/jpeg','image/heic','image/heif']);
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
      const match=/^\/api\/media\/([a-f0-9-]{36})\/(original|preview)$/.exec(req.url||'');
      if(!match||!['GET','PUT'].includes(req.method))throw deny(404,'Image not found');
      const [,id,variant]=match,path='rooms/'+member.roomId+'/media/'+id+(variant==='preview'?'-preview':'');
      const file=dependencies.bucket.file(path);
      if(req.method==='PUT'){
        const mime=req.headers['content-type'];
        if(!ALLOWED.has(mime)||(variant==='preview'&&mime!=='image/jpeg'))throw deny(400,'Unsupported image');
        const chunks=[];let size=0;
        const body=req.rawBody?[req.rawBody]:req;
        for await(const input of body){size+=input.length;if(size>MAX)throw deny(413,'Image too large');chunks.push(input);}
        if(size===0)throw deny(400,'Choose an image');const bytes=Buffer.concat(chunks);
        // GCS API, not Firebase upload endpoints. No signed URL or download token.
        await file.save(bytes,{resumable:false,preconditionOpts:{ifGenerationMatch:0},metadata:{
          contentType:mime,cacheControl:'private, no-store',metadata:{author_uid:member.uid,attachment_id:id,role:variant}
        }});
        const [metadata]=await file.getMetadata();
        if(metadata.metadata?.firebaseStorageDownloadTokens)throw deny(503,'Image storage requires qualification');
        response(201,{id,variant,size,sha256:createHash('sha256').update(bytes).digest('hex')});return;
      }
      const [metadata]=await file.getMetadata();
      if(metadata.metadata?.firebaseStorageDownloadTokens||!ALLOWED.has(metadata.contentType)||
        Number(metadata.size)>MAX||metadata.metadata?.attachment_id!==id||metadata.metadata?.role!==variant)
        throw deny(503,'Image storage requires qualification');
      res.writeHead(200,{...headers,'Content-Type':metadata.contentType,'Content-Length':metadata.size});
      for await(const chunk of file.createReadStream())if(!res.write(chunk))await new Promise(resolve=>res.once('drain',resolve));res.end();
    }catch(e){
      if(res.headersSent){res.destroy();return;}
      const status=e.status||(e.code===412?409:e.code===404?404:503);
      response(status,{error:status===409?'This image is already saved':status===503?'Image service unavailable':e.message});
    }
  };
}
