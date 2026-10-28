import {createRequire} from 'node:module';

export const pinnedFirebaseToolsVersion='15.34.0';
const requestDiagnosticPrefix='JUSTELLE_SAFE_REQUEST_DIAG:';
const maxDiagnosticEvents=8;
const maxDiagnosticStderrBytes=64*1024;

const serviceByHostname=new Map([
  ['firebaseextensions.googleapis.com','FIREBASE_EXTENSIONS'],
  ['firebasestorage.googleapis.com','FIREBASE_STORAGE'],
  ['firestore.googleapis.com','FIRESTORE'],
  ['serviceusage.googleapis.com','SERVICE_USAGE'],
  ['cloudfunctions.googleapis.com','CLOUD_FUNCTIONS'],
  ['run.googleapis.com','CLOUD_RUN'],
  ['cloudscheduler.googleapis.com','CLOUD_SCHEDULER'],
  ['cloudbuild.googleapis.com','CLOUD_BUILD'],
  ['eventarc.googleapis.com','EVENTARC'],
  ['pubsub.googleapis.com','PUBSUB'],
  ['artifactregistry.googleapis.com','ARTIFACT_REGISTRY'],
  ['iam.googleapis.com','IDENTITY'],
  ['iamcredentials.googleapis.com','IDENTITY'],
  ['storage.googleapis.com','STORAGE'],
  ['firebasehosting.googleapis.com','FIREBASE_HOSTING']
]);
const serviceCategories=new Set([...serviceByHostname.values(),'UNKNOWN']);
const methodCategories=new Set(['GET','POST','PATCH','PUT','DELETE','OPTIONS','HEAD','OTHER']);
const operationCategories=new Set([
  'SET_IAM_POLICY','GET_IAM_POLICY','GET_DEFAULT_BUCKET','LIST_RESOURCES',
  'GET_RESOURCE','CREATE_RESOURCE','UPDATE_RESOURCE','DELETE_RESOURCE',
  'READ_REQUEST','WRITE_REQUEST','OTHER'
]);

function safeServiceCategory(urlPrefix){
  try{return serviceByHostname.get(new URL(urlPrefix).hostname.toLowerCase())??'UNKNOWN';}
  catch{return 'UNKNOWN';}
}

function safeMethodCategory(method){
  const value=typeof method==='string'?method.toUpperCase():'';
  return methodCategories.has(value)?value:'OTHER';
}

function safeOperationCategory(method,path){
  const normalizedPath=typeof path==='string'?path.split('?')[0].toLowerCase():'';
  const segments=normalizedPath.split('/').filter(Boolean);
  const leaf=segments.at(-1)??'';
  const methodName=leaf.startsWith(':')?leaf.slice(1):'';
  if(methodName==='setiampolicy'||leaf.endsWith(':setiampolicy'))return 'SET_IAM_POLICY';
  if(methodName==='getiampolicy'||leaf.endsWith(':getiampolicy'))return 'GET_IAM_POLICY';
  const verb=safeMethodCategory(method);
  if(leaf==='defaultbucket'&&verb==='GET')return 'GET_DEFAULT_BUCKET';
  const collections=new Set([
    'functions','services','jobs','sites','instances','rulesets','releases',
    'databases','projects','buckets','objects','builds','locations'
  ]);
  if(collections.has(leaf)){
    if(verb==='GET')return 'LIST_RESOURCES';
    if(verb==='POST')return 'CREATE_RESOURCE';
  }
  if(segments.length>1&&collections.has(segments.at(-2))){
    if(verb==='GET')return 'GET_RESOURCE';
    if(verb==='PATCH'||verb==='PUT')return 'UPDATE_RESOURCE';
    if(verb==='DELETE')return 'DELETE_RESOURCE';
  }
  if(verb==='GET')return 'READ_REQUEST';
  if(verb==='POST')return 'WRITE_REQUEST';
  if(verb==='PATCH'||verb==='PUT')return 'UPDATE_RESOURCE';
  if(verb==='DELETE')return 'DELETE_RESOURCE';
  return 'OTHER';
}

function safeStatus(error){
  const candidate=error?.status??error?.context?.response?.statusCode;
  return Number.isInteger(candidate)&&candidate>=400&&candidate<=599?candidate:null;
}

export function createSafeFirebaseRequestEvent({urlPrefix,method,path,status}){
  const httpStatus=Number.isInteger(status)&&status>=400&&status<=599?status:null;
  if(httpStatus===null)return null;
  return {
    serviceCategory:safeServiceCategory(urlPrefix),
    methodCategory:safeMethodCategory(method),
    operationCategory:safeOperationCategory(method,path),
    httpStatus
  };
}

export function installFirebaseCliRequestDiagnostics({Client,nonce,writeDiagnostic=line=>process.stderr.write(line)}){
  if(!/^[a-f0-9]{32}$/.test(nonce??''))throw new Error('Invalid Justelle diagnostic nonce');
  if(!Client?.prototype||typeof Client.prototype.doRequest!=='function'){
    throw new Error('Pinned Firebase CLI request hook is unavailable');
  }
  const prototype=Client.prototype;
  const installed=Symbol.for('justelle.firebaseCliSafeRequestDiagnostics');
  if(prototype[installed])return false;
  const original=prototype.doRequest;
  let emitted=0,overflowWritten=false;
  const wrapped=async function(options){
    try{return await original.call(this,options);}
    catch(error){
      const event=createSafeFirebaseRequestEvent({
        urlPrefix:this?.opts?.urlPrefix,
        method:options?.method,
        path:options?.path,
        status:safeStatus(error)
      });
      if(event){
        try{
          if(emitted<maxDiagnosticEvents){
            writeDiagnostic(requestDiagnosticPrefix+nonce+':'+JSON.stringify(event)+'\n');
            emitted++;
          }else if(!overflowWritten){
            writeDiagnostic(requestDiagnosticPrefix+nonce+':'+JSON.stringify({overflow:true})+'\n');
            overflowWritten=true;
          }
        }catch{}
      }
      throw error;
    }
  };
  Object.defineProperty(wrapped,installed,{value:true});
  prototype.doRequest=wrapped;
  return true;
}

export function parseFirebaseCliRequestDiagnostics(stderr,nonce){
  const result={events:[],truncated:false};
  if(!/^[a-f0-9]{32}$/.test(nonce??'')||!(typeof stderr==='string'||Buffer.isBuffer(stderr)))return result;
  const bounded=(Buffer.isBuffer(stderr)?stderr.toString('utf8'):stderr).slice(-maxDiagnosticStderrBytes);
  const marker=requestDiagnosticPrefix+nonce+':';
  for(const line of bounded.split(/\r?\n/)){
    if(!line.startsWith(marker))continue;
    let value;
    try{value=JSON.parse(line.slice(marker.length));}catch{return {events:[],truncated:false};}
    if(value&&typeof value==='object'&&!Array.isArray(value)&&
      Object.keys(value).length===1&&value.overflow===true){
      result.truncated=true;
      continue;
    }
    if(!value||typeof value!=='object'||Array.isArray(value)||
      Object.keys(value).sort().join(',')!=='httpStatus,methodCategory,operationCategory,serviceCategory'||
      !serviceCategories.has(value.serviceCategory)||
      !methodCategories.has(value.methodCategory)||
      !operationCategories.has(value.operationCategory)||
      !Number.isInteger(value.httpStatus)||value.httpStatus<400||value.httpStatus>599){
      return {events:[],truncated:false};
    }
    if(result.events.length>=maxDiagnosticEvents)return {events:[],truncated:false};
    result.events.push({
      serviceCategory:value.serviceCategory,
      methodCategory:value.methodCategory,
      operationCategory:value.operationCategory,
      httpStatus:value.httpStatus
    });
  }
  return result;
}

// This module is also loaded with Node's --import for the pinned Firebase CLI child.
// The per-process nonce gates the hook so ordinary app/test imports have no effect.
const nonce=process.env.JUSTELLE_FIREBASE_SAFE_DIAG_NONCE;
if(nonce!==undefined){
  if(!/^[a-f0-9]{32}$/.test(nonce))throw new Error('Invalid Justelle diagnostic setup');
  const localRequire=createRequire(import.meta.url);
  const packageMetadata=localRequire('../node_modules/firebase-tools/package.json');
  if(packageMetadata.version!==pinnedFirebaseToolsVersion){
    throw new Error('Unsupported Firebase CLI version for Justelle request diagnostics');
  }
  const {Client}=localRequire('../node_modules/firebase-tools/lib/apiv2.js');
  installFirebaseCliRequestDiagnostics({Client,nonce});
}
