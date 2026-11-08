import {S3Client,PutObjectCommand,GetObjectCommand,GetObjectLockConfigurationCommand,GetObjectRetentionCommand} from '@aws-sdk/client-s3';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';

const retentionDiagnostic=Symbol('b2-object-retention-diagnostic');
const retentionRequestCodes=Object.freeze({
  AccessDenied:'ACCESS_DENIED',
  InvalidAccessKeyId:'INVALID_ACCESS_KEY',
  SignatureDoesNotMatch:'SIGNATURE_MISMATCH',
  NoSuchBucket:'BUCKET_NOT_FOUND',
  NoSuchKey:'OBJECT_NOT_FOUND',
  NoSuchVersion:'VERSION_NOT_FOUND',
  InvalidRequest:'INVALID_REQUEST',
  MethodNotAllowed:'METHOD_NOT_ALLOWED',
  NotImplemented:'NOT_IMPLEMENTED',
  InternalError:'INTERNAL_ERROR',
  ServiceUnavailable:'SERVICE_UNAVAILABLE',
  RequestTimeout:'REQUEST_TIMEOUT',
  RequestTimeTooSkewed:'REQUEST_TIME_SKEW'
});
const retentionRequestStatuses=new Set([400,401,403,404,405,408,409,429,500,502,503,504]);
const retentionValidationReasons=new Set([
  'MODE_NOT_GOVERNANCE',
  'RETAIN_UNTIL_DATE_MISSING',
  'RETAIN_UNTIL_DATE_NOT_DATE',
  'RETAIN_UNTIL_DATE_INVALID',
  'RETENTION_NOT_FUTURE'
]);

function taggedRetentionError(name,message,diagnostic){
  const error=new Error(message);
  error.name=name;
  Object.defineProperty(error,retentionDiagnostic,{value:Object.freeze(diagnostic)});
  return error;
}

function objectRetentionRequestError(providerError){
  let status='UNKNOWN',code='UNKNOWN';
  try{
    const value=providerError?.$metadata?.httpStatusCode;
    if(Number.isInteger(value)&&retentionRequestStatuses.has(value))status='HTTP_'+value;
    for(const candidate of [providerError?.Code,providerError?.code,providerError?.name])
      if(typeof candidate==='string'&&Object.hasOwn(retentionRequestCodes,candidate)){
        code=retentionRequestCodes[candidate];break;
      }
  }catch{}
  return taggedRetentionError('B2ObjectRetentionRequestError','B2 object retention request failed',{
    kind:'REQUEST',status,code
  });
}

function objectRetentionValidationError(reason){
  return taggedRetentionError('B2ObjectRetentionValidationError',
    'B2 uploaded object has no effective future governance retention',{
      kind:'RESPONSE_VALIDATION',reason
    });
}

// Return only fixed, allowlisted diagnostics; never retain provider text or IDs.
export function getB2ObjectRetentionDiagnostic(error){
  const detail=error?.[retentionDiagnostic];
  if(detail?.kind==='REQUEST'){
    const status=detail.status==='UNKNOWN'||
      (typeof detail.status==='string'&&/^HTTP_(400|401|403|404|405|408|409|429|500|502|503|504)$/.test(detail.status))
      ?detail.status:'UNKNOWN';
    const code=['UNKNOWN',...Object.values(retentionRequestCodes)].includes(detail.code)?detail.code:'UNKNOWN';
    return Object.freeze({kind:'REQUEST',status,code});
  }
  if(detail?.kind==='RESPONSE_VALIDATION'&&retentionValidationReasons.has(detail.reason))
    return Object.freeze({kind:'RESPONSE_VALIDATION',reason:detail.reason});
  return null;
}

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
  if(retention?.Mode!=='GOVERNANCE')throw objectRetentionValidationError('MODE_NOT_GOVERNANCE');
  if(until===undefined||until===null)throw objectRetentionValidationError('RETAIN_UNTIL_DATE_MISSING');
  if(!(until instanceof Date))throw objectRetentionValidationError('RETAIN_UNTIL_DATE_NOT_DATE');
  if(!Number.isFinite(until.getTime()))throw objectRetentionValidationError('RETAIN_UNTIL_DATE_INVALID');
  if(until.getTime()<=now)throw objectRetentionValidationError('RETENTION_NOT_FUTURE');
  return true;
}

export async function requestAndValidateB2ObjectRetention(client,{bucket,key,versionId}){
  let result;
  try{
    result=await client.send(new GetObjectRetentionCommand({
      Bucket:bucket,Key:key,...(versionId?{VersionId:versionId}:{})
    }));
  }catch(error){
    // Discard the original SDK error: it can contain object IDs and raw provider text.
    throw objectRetentionRequestError(error);
  }
  validateB2ObjectRetention(result);
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
      await requestAndValidateB2ObjectRetention(client,{bucket:config.bucket,key:name,versionId});
    },
    async get(name){return (await client.send(new GetObjectCommand({Bucket:config.bucket,Key:name}))).Body;},
    close(){client.destroy();}
  };
}
