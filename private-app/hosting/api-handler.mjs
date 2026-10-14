// Handles Firebase's parsed JSON/rawBody, as well as unparsed local HTTP requests.
export function createApiHandler({media,respond,origin,version='unversioned'}){
  return async(req,res)=>{
    const path=(req.originalUrl||req.url||'').split('?')[0];
    const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
    const send=(status,body)=>{res.writeHead(status,{...headers,'Content-Type':'application/json'});res.end(JSON.stringify(body));};
    if(req.headers.origin&&req.headers.origin!==origin)return send(403,{error:'Origin denied'});
    if(path==='/api/healthz'&&req.method==='GET')return send(200,{status:'ok',version});
    if(path.startsWith('/api/media/'))return media(req,res);
    if(path!=='/api/respond')return send(404,{error:'Not found'});
    if(req.method!=='POST')return send(405,{error:'Use POST'});
    try{
      const token=/^Bearer (.+)$/.exec(req.headers.authorization||'')?.[1];
      if(!token)return send(401,{error:'Sign-in required'});
      if((req.headers['content-type']||'').split(';')[0]!=='application/json')return send(415,{error:'Use JSON'});
      let raw=req.rawBody;
      if(!raw){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>4096)return send(413,{error:'Request too large'});chunks.push(chunk);}raw=Buffer.concat(chunks);}
      if(raw.length>4096)return send(413,{error:'Request too large'});
      let input;try{input=JSON.parse(raw.toString('utf8'));}catch{return send(400,{error:'Invalid JSON'});}
      if(!input||Array.isArray(input)||Object.keys(input).join(',')!=='source_message_id')return send(400,{error:'Invalid request'});
      return send(200,await respond(token,input.source_message_id));
    }catch(e){
      const status=[400,401,403,404,409,429,503].includes(e.status)?e.status:503;
      return send(status,{error:status===401?'Sign-in required':status===403?'Member access required':status===429?'Please wait before asking again':status===503?'Justelle AI is unavailable. Your message is saved; no automatic paid retry was made.':'Request failed'});
    }
  };
}
