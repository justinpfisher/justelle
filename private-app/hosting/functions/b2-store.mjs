import {S3Client,PutObjectCommand,GetObjectCommand,GetObjectLockConfigurationCommand,GetObjectRetentionCommand} from '@aws-sdk/client-s3';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';

// Object Lock uploads require a request checksum. Bucket default retention is
// applied by B2 even when the PUT does not set per-object retention headers.
export async function calculateContentMd5(path){
  const hash=createHash('md5');
  for await(const chunk of createReadStream(path))hash.update(chunk);
  return hash.digest('base64');
}
// A configured Object Lock bucket can still use the wrong mode or an
// ineffective default period. New ciphertext generations require the
// owner-approved governance retention before any remote upload begins.
export function validateB2Retention(configuration){
  const lock=configuration?.ObjectLockConfiguration;
  const retention=lock?.Rule?.DefaultRetention;
  if(lock?.ObjectLockEnabled!=='Enabled'||retention?.Mode!=='GOVERNANCE')
    throw Error('B2 governance retention is not configured');
  const days=retention.Days,years=retention.Years;
  if((days!==undefined&&years!==undefined)||
     (days===undefined&&years===undefined)||
     (days!==undefined&&(!Number.isSafeInteger(days)||days<1||days>3000))||
     (years!==undefined&&(!Number.isSafeInteger(years)||years<1||years*365>3000)))
    throw Error('B2 default retention period must be a positive permitted duration');
  return true;
}

// The bucket policy alone does not prove a newly uploaded object is locked.
// Verify the exact object (and its version when supplied) independently.
export function validateB2ObjectRetention(retention,now=Date.now()){
  const until=retention?.RetainUntilDate;
  if(retention?.Mode!=='GOVERNANCE'||!(until instanceof Date)||
      !Number.isFinite(until.getTime())||until.getTime()<=now)
    throw Error('B2 uploaded object has no effective future governance retention');
  return true;
}

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
      validateB2Retention(result);
    },
    async put(name,path,size){
      const contentMD5=await calculateContentMd5(path);
      const result=await client.send(new PutObjectCommand({Bucket:config.bucket,Key:name,Body:createReadStream(path),ContentLength:size,
        ContentMD5:contentMD5,ContentType:'application/octet-stream',CacheControl:'private, no-store'}));
      return result.VersionId||null;
    },
    async verifyObjectRetention(name,versionId){
      const result=await client.send(new GetObjectRetentionCommand({
        Bucket:config.bucket,Key:name,...(versionId?{VersionId:versionId}:{})
      }));
      validateB2ObjectRetention(result);
    },
    async get(name){return (await client.send(new GetObjectCommand({Bucket:config.bucket,Key:name}))).Body;},
    close(){client.destroy();}
  };
}
