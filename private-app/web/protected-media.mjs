// Hosted originals travel through an authenticated server endpoint, never signed URLs.
export function protectedMediaTransport({baseUrl,getToken,fetchImpl=fetch}){
  async function request(path,options={}){
    const res=await fetchImpl(baseUrl+path,{...options,cache:'no-store',redirect:'error',
      headers:{...options.headers,Authorization:'Bearer '+await getToken()}});
    if(!res.ok){const error=Error('The image could not be saved or opened. Please try again.');if([401,403].includes(res.status))error.code='storage/unauthorized';throw error;}
    return res;
  }
  return {
    async upload(path,bytes,metadata){
      const id=metadata.customMetadata.attachment_id,variant=metadata.customMetadata.role;
      return request('/'+encodeURIComponent(id)+'/'+variant,{method:'PUT',headers:{'Content-Type':metadata.contentType},body:bytes});
    },
    async uploadDocument(id,bytes,mime){
      if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid document reference');
      return request('/documents/'+id,{method:'PUT',headers:{'Content-Type':mime},body:bytes});
    },
    async readDocument(id,maxBytes){
      if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid document reference');
      return consume(await request('/documents/'+id),maxBytes);
    },
    async read(path,maxBytes){
      const match=/\/media\/([a-f0-9-]{36})(-preview)?$/.exec(path);
      if(!match)throw Error('Invalid image reference');
      return consume(await request('/'+match[1]+'/'+(match[2]?'preview':'original')),maxBytes);
    }
  };
  async function consume(res,maxBytes){
      const reader=res.body.getReader();let count=0;const chunks=[];
      try{while(true){const {done,value}=await reader.read();if(done)break;count+=value.length;if(count>maxBytes)throw Error('Image exceeds the supported size');chunks.push(value);}}
      finally{await reader.cancel();}
      const output=new Uint8Array(count);let offset=0;for(const chunk of chunks){output.set(chunk,offset);offset+=chunk.length;}return output;
  }
}
