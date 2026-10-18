import {S3Client,PutObjectCommand,GetObjectCommand,GetObjectLockConfigurationCommand} from '@aws-sdk/client-s3';
import {createReadStream} from 'node:fs';
export function createB2Store(config){
  const endpoint=new URL(config.endpoint);
  if(endpoint.protocol!=='https:'||!/^s3\.[a-z0-9-]+\.backblazeb2\.com$/.test(endpoint.hostname)||
    endpoint.pathname!=='/'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||
    !/^[a-zA-Z0-9-]{3,63}$/.test(config.bucket||'')||!config.keyId||!config.applicationKey)
    throw Error('Private B2 destination is invalid');
  const client=new S3Client({endpoint:endpoint.origin,region:endpoint.hostname.split('.')[1],forcePathStyle:true,
    credentials:{accessKeyId:config.keyId,secretAccessKey:config.applicationKey},maxAttempts:1,
    requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'});
  return {
    async verifyRetention(){
      const result=await client.send(new GetObjectLockConfigurationCommand({Bucket:config.bucket}));
      if(result.ObjectLockConfiguration?.ObjectLockEnabled!=='Enabled'||
        !result.ObjectLockConfiguration?.Rule?.DefaultRetention)throw Error('B2 retention is not configured');
    },
    async put(name,path,size){
      await client.send(new PutObjectCommand({Bucket:config.bucket,Key:name,Body:createReadStream(path),ContentLength:size,
        ContentType:'application/octet-stream',CacheControl:'private, no-store'}));
    },
    async get(name){return (await client.send(new GetObjectCommand({Bucket:config.bucket,Key:name}))).Body;},
    close(){client.destroy();}
  };
}
