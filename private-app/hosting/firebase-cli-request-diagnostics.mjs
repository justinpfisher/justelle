import {createRequire} from 'node:module';
import {access,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {writeSync} from 'node:fs';

export const pinnedFirebaseToolsVersion='15.34.0';

export async function buildFirebaseCliInvocation({directory,allowLegacyRollback=false,nonce}={}){
  const cliPath=join(directory,'node_modules/firebase-tools/lib/bin/firebase.js');
  const hookPath=join(directory,'hosting/firebase-cli-request-diagnostics.mjs');
  const packageMetadata=JSON.parse(await readFile(join(directory,'node_modules/firebase-tools/package.json'),'utf8'));
  let hookAvailable=true;
  try{await access(hookPath);}catch(error){
    if(error?.code==='ENOENT')hookAvailable=false;
    else throw error;
  }
  if(packageMetadata.version===pinnedFirebaseToolsVersion&&hookAvailable){
    if(!/^[a-f0-9]{32}$/.test(nonce??''))throw new Error('Invalid Justelle diagnostic nonce');
    return {args:['--import',pathToFileURL(hookPath).href,cliPath],nonce,diagnosticsUnavailable:null};
  }
  if(allowLegacyRollback&&(!hookAvailable||packageMetadata.version!==pinnedFirebaseToolsVersion)){
    return {args:[cliPath],nonce:null,diagnosticsUnavailable:'LEGACY_ROLLBACK_COMPATIBILITY'};
  }
  throw new Error('Firebase CLI request diagnostics are required for forward deployment');
}
const requestDiagnosticPrefix='JUSTELLE_SAFE_REQUEST_DIAG:';
const terminalDiagnosticPrefix='JUSTELLE_SAFE_TERMINAL_DIAG:';
const maxDiagnosticEvents=8;
const maxDiagnosticStderrBytes=64*1024;

const serviceByHostname=new Map([
  ['firebase.googleapis.com','FIREBASE_API'],
  ['firebaserules.googleapis.com','FIREBASE_RULES'],
  ['cloudresourcemanager.googleapis.com','CLOUD_RESOURCE_MANAGER'],
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
  ['firebasehosting.googleapis.com','FIREBASE_HOSTING'],
  ['secretmanager.googleapis.com','SECRET_MANAGER'],
  ['runtimeconfig.googleapis.com','RUNTIME_CONFIG']
]);
const serviceCategories=new Set([...serviceByHostname.values(),'UNKNOWN']);
const methodCategories=new Set(['GET','POST','PATCH','PUT','DELETE','OPTIONS','HEAD','OTHER']);
const operationCategories=new Set([
  'SET_IAM_POLICY','GET_IAM_POLICY','GET_DEFAULT_BUCKET','LIST_RESOURCES',
  'GET_RESOURCE','CREATE_RESOURCE','UPDATE_RESOURCE','DELETE_RESOURCE',
  'READ_REQUEST','WRITE_REQUEST','OTHER'
]);
const permissionCategories=new Set([
  'UNKNOWN','AMBIGUOUS',
  'firebaseextensions.instances.list','firebasestorage.defaultbucket.get',
  'firestore.databases.get','cloudfunctions.functions.setiampolicy',
  'run.services.setiampolicy','cloudscheduler.jobs.get','cloudscheduler.jobs.create',
  'cloudscheduler.jobs.update','serviceusage.services.use','serviceusage.operations.get',
  'cloudbuild.builds.create','iam.serviceaccounts.actas','firebasehosting.sites.get',
  'firebaserules.rulesets.get','firebaserules.releases.get',
  'secretmanager.secrets.get','secretmanager.versions.get','secretmanager.secrets.getiampolicy'
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

const safePermissionNames=new Set([
  'firebaseextensions.instances.list','firebasestorage.defaultbucket.get',
  'firestore.databases.get','cloudfunctions.functions.setiampolicy',
  'run.services.setiampolicy','cloudscheduler.jobs.get','cloudscheduler.jobs.create',
  'cloudscheduler.jobs.update','serviceusage.services.use','serviceusage.operations.get',
  'cloudbuild.builds.create','iam.serviceaccounts.actas','firebasehosting.sites.get',
  'firebaserules.rulesets.get','firebaserules.releases.get',
  'secretmanager.secrets.get','secretmanager.versions.get','secretmanager.secrets.getiampolicy'
]);

function safePermissionCategory(error){
  const candidates=new Set();
  const unknown={value:false};
  let traversalTruncated=false;
  let visited=0;
  const visit=(value,depth=0,key='')=>{
    if(depth>10){traversalTruncated=true;return;}
    if(candidates.size>1)return;
    if(visited>=128){traversalTruncated=true;return;}
    visited++;
    if(Array.isArray(value)){
      if(value.length>16)traversalTruncated=true;
      for(const item of value.slice(0,16))visit(item,depth+1,key);
      return;
    }
    if(!value||typeof value!=='object'){
      if(typeof value==='string'&&['permission','permissionname','requiredpermission','deniedpermission'].includes(key.toLowerCase())){
        if(value.length>256){unknown.value=true;return;}
        const normalized=value.trim().toLowerCase();
        if(safePermissionNames.has(normalized))candidates.add(normalized);else if(normalized)unknown.value=true;
      }
      return;
    }
    const entries=[];
    for(const childKey in value){
      if(!Object.prototype.hasOwnProperty.call(value,childKey))continue;
      if(entries.length===32){traversalTruncated=true;break;}
      entries.push([childKey,value[childKey]]);
    }
    for(const [childKey,child] of entries){
      const normalized=childKey.toLowerCase();
      if(['permission','permissionname','requiredpermission','deniedpermission','details','error','cause','original','context','body','violations','metadata'].includes(normalized))visit(child,depth+1,normalized);
    }
  };
  visit(error);
  if(traversalTruncated)return 'AMBIGUOUS';
  if(candidates.size>1||(unknown.value&&candidates.size))return 'AMBIGUOUS';
  return candidates.size===1?[...candidates][0]:'UNKNOWN';
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

function terminalRequestContext(error,requestEvents){
  const matches=[];
  const seen=new Set();
  let traversalTruncated=false;
  const visit=(value,depth)=>{
    if(!value||typeof value!=='object'||seen.has(value))return;
    if(depth>6){traversalTruncated=true;return;}
    seen.add(value);
    const event=requestEvents.get(value);
    if(event)matches.push(event);
    for(const key of ['original','cause'])visit(value[key],depth+1);
  };
  visit(error,0);
  if(traversalTruncated)return {terminalRequestStatus:'AMBIGUOUS_REQUEST'};
  const unique=[...new Set(matches)];
  if(unique.length===1)return {terminalRequestStatus:'MATCHED',...unique[0]};
  return {terminalRequestStatus:unique.length?'AMBIGUOUS_REQUEST':'NO_REQUEST_CONTEXT'};
}

const safeTerminalErrorNames=new Map([
  ['Error','ERROR'],['FirebaseError','FIREBASE_ERROR'],['TypeError','TYPE_ERROR'],
  ['RangeError','RANGE_ERROR'],['ReferenceError','REFERENCE_ERROR'],
  ['SyntaxError','SYNTAX_ERROR'],['AbortError','ABORT_ERROR'],['FetchError','FETCH_ERROR']
]);
const safeTerminalErrorCodes=new Set([
  'EACCES','EAI_AGAIN','ECONNREFUSED','ECONNRESET','ENOENT','ENOTFOUND','ETIMEDOUT',
  'ERR_INVALID_ARG_TYPE','ERR_MODULE_NOT_FOUND','ERR_PACKAGE_PATH_NOT_EXPORTED','ERR_REQUIRE_ESM',
  'API_DISABLED','FAILED_PRECONDITION','INTERNAL','INVALID_ARGUMENT','NOT_FOUND',
  'PERMISSION_DENIED','RESOURCE_EXHAUSTED','UNAUTHENTICATED','UNAVAILABLE','MODULE_NOT_FOUND'
]);
const safeMessageTemplates=[
  ['CLI_UNEXPECTED_WRAPPER',/^An unexpected error has occurred\.?$/i],
  ['PERMISSION_DENIED',/permission denied|does not have permission|lacks permission|not authorized|forbidden/i],
  ['API_DISABLED',/service.?disabled|api.{0,80}(not enabled|disabled)|enable.{0,40}api/i],
  ['AUTHENTICATION_FAILED',/unauthenticated|invalid grant|no credentials|not logged in/i],
  ['QUOTA_EXCEEDED',/resource exhausted|quota.{0,40}exceeded|rate limit/i],
  ['MODULE_RESOLUTION',/cannot find (?:package|module)|module not found|package path not exported/i],
  ['FUNCTIONS_DISCOVERY_FAILURE',/failed to load function definition from source|user code failed to load\. cannot determine backend specification|discovery process failed/i],
  ['RESOURCE_NOT_FOUND',/not found|does not exist|no such file or directory/i],
  ['INVALID_ARGUMENT',/invalid argument|bad request|malformed/i],
  ['NETWORK_FAILURE',/getaddrinfo|network|socket|connection (?:refused|reset|timed out)|timed out/i],
  ['CONFIGURATION_FAILURE',/config(?:uration)? (?:is )?(?:invalid|missing|malformed)|failed to parse/i],
  ['BUILD_OR_PACKAGE_FAILURE',/build failed|package(?:ing)? failed|predeploy.*failed/i]
];
const safeMessageTemplateCategories=new Set([...safeMessageTemplates.map(([category])=>category),'NONE','OTHER']);

function readErrorProperty(error,key){
  try{return error?.[key];}catch{return undefined;}
}

function terminalErrorKind(error){
  if(typeof error==='string')return 'STRING';
  if(error instanceof Error)return 'ERROR';
  if(error&&typeof error==='object')return typeof readErrorProperty(error,'message')==='string'?'MESSAGE_OBJECT':'OBJECT';
  return 'OTHER';
}

function terminalErrorName(error){
  const name=readErrorProperty(error,'name');
  return typeof name==='string'?safeTerminalErrorNames.get(name)??'OTHER':'NONE';
}

function terminalErrorCode(error){
  const value=readErrorProperty(error,'code');
  if(typeof value!=='string')return 'NONE';
  const normalized=value.toUpperCase();
  return safeTerminalErrorCodes.has(normalized)?normalized:'OTHER';
}

function terminalMessageTemplate(error){
  const message=typeof error==='string'?error:readErrorProperty(error,'message');
  if(typeof message!=='string'||!message)return 'NONE';
  for(const [category,pattern] of safeMessageTemplates){
    if(pattern.test(message))return category;
  }
  return 'OTHER';
}

function safeTerminalErrorShape(error){
  const nodes=[];
  const seen=new Set();
  let truncated=false;
  const visit=(value,depth)=>{
    if(value===null||value===undefined)return;
    if(typeof value!=='object'&&typeof value!=='string')return;
    if(typeof value==='object'&&seen.has(value))return;
    if(depth>4||nodes.length>=5){truncated=true;return;}
    if(typeof value==='object')seen.add(value);
    const status=readErrorProperty(value,'status');
    const node={
      kind:terminalErrorKind(value),
      name:terminalErrorName(value),
      code:terminalErrorCode(value),
      messageTemplate:terminalMessageTemplate(value),
      ...(Number.isInteger(status)&&status>=400&&status<=599?{httpStatus:status}:{})
    };
    nodes.push(node);
    if(typeof value==='object'){
      visit(readErrorProperty(value,'original'),depth+1);
      visit(readErrorProperty(value,'cause'),depth+1);
    }
  };
  try{visit(error,0);}catch{return {nodes:[],truncated:true};}
  return {nodes,truncated};
}

export function createSafeTerminalErrorDiagnostic(error,requestEvents){
  return {
    ...terminalRequestContext(error,requestEvents),
    terminalError:safeTerminalErrorShape(error)
  };
}

export function parseFirebaseCliTerminalErrorDiagnostic(stderr,nonce){
  if(!/^[a-f0-9]{32}$/.test(nonce??'')||!(typeof stderr==='string'||Buffer.isBuffer(stderr)))return null;
  const bounded=(Buffer.isBuffer(stderr)?stderr.toString('utf8'):stderr).slice(-maxDiagnosticStderrBytes);
  const marker=terminalDiagnosticPrefix+nonce+':';
  const lines=bounded.split(/\r?\n/).filter(line=>line.startsWith(marker));
  if(lines.length!==1)return null;
  let value;
  try{value=JSON.parse(lines[0].slice(marker.length));}catch{return null;}
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const hasTerminalError=Object.hasOwn(value,'terminalError');
  if(hasTerminalError){
    if(!value.terminalError||typeof value.terminalError!=='object'||Array.isArray(value.terminalError)||
      Object.keys(value.terminalError).sort().join(',')!=='nodes,truncated'||
      !Array.isArray(value.terminalError.nodes)||value.terminalError.nodes.length>5||
      typeof value.terminalError.truncated!=='boolean')return null;
    for(const node of value.terminalError.nodes){
      if(!node||typeof node!=='object'||Array.isArray(node)||
        !['code','kind','messageTemplate','name'].every(key=>Object.hasOwn(node,key))||
        Object.keys(node).some(key=>!['code','kind','messageTemplate','name','httpStatus'].includes(key))||
        !['ERROR','MESSAGE_OBJECT','OBJECT','OTHER','STRING'].includes(node.kind)||
        !['NONE',...safeTerminalErrorNames.values(),'OTHER'].includes(node.name)||
        !['NONE','OTHER',...safeTerminalErrorCodes].includes(node.code)||
        !safeMessageTemplateCategories.has(node.messageTemplate)||
        (node.httpStatus!==undefined&&(!Number.isInteger(node.httpStatus)||node.httpStatus<400||node.httpStatus>599)))return null;
    }
  }
  const status=value.terminalRequestStatus;
  if(status==='NO_REQUEST_CONTEXT'||status==='AMBIGUOUS_REQUEST'){
    const expected=hasTerminalError?'terminalError,terminalRequestStatus':'terminalRequestStatus';
    return Object.keys(value).sort().join(',')===expected?value:null;
  }
  const keys=Object.keys(value).sort().join(',');
  const expected=hasTerminalError
    ?'httpStatus,methodCategory,operationCategory,permissionCategory,serviceCategory,terminalError,terminalRequestStatus'
    :'httpStatus,methodCategory,operationCategory,permissionCategory,serviceCategory,terminalRequestStatus';
  if(keys!==expected||
    status!=='MATCHED'||!serviceCategories.has(value.serviceCategory)||
    !methodCategories.has(value.methodCategory)||!operationCategories.has(value.operationCategory)||
    !permissionCategories.has(value.permissionCategory)||!Number.isInteger(value.httpStatus)||
    value.httpStatus<400||value.httpStatus>599)return null;
  return {...value};
}

export function installFirebaseCliRequestDiagnostics({Client,errorOutModule,nonce,writeDiagnostic}={}){
  if(!/^[a-f0-9]{32}$/.test(nonce??''))throw new Error('Invalid Justelle diagnostic nonce');
  if(!Client?.prototype||typeof Client.prototype.doRequest!=='function'){
    throw new Error('Pinned Firebase CLI request hook is unavailable');
  }
  if(!errorOutModule||typeof errorOutModule.errorOut!=='function')throw new Error('Pinned Firebase CLI terminal hook is unavailable');
  const prototype=Client.prototype;
  const installed=Symbol.for('justelle.firebaseCliSafeRequestDiagnostics');
  if(prototype[installed])return false;
  const original=prototype.doRequest;
  let emitted=0,overflowWritten=false;
  const requestEvents=new WeakMap();
  const pendingLines=[];
  let flushRegistered=false;
  const writeLine=typeof writeDiagnostic==='function'?writeDiagnostic:line=>{
    pendingLines.push(line);
    if(!flushRegistered){
      flushRegistered=true;
      process.once('exit',()=>{for(const item of pendingLines)writeSync(2,item);});
    }
  };
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
          requestEvents.set(error,{...event,permissionCategory:safePermissionCategory(error)});
          if(emitted<maxDiagnosticEvents){
            writeLine(requestDiagnosticPrefix+nonce+':'+JSON.stringify(event)+'\n');
            emitted++;
          }else if(!overflowWritten){
            writeLine(requestDiagnosticPrefix+nonce+':'+JSON.stringify({overflow:true})+'\n');
            overflowWritten=true;
          }
        }catch{}
      }
      throw error;
    }
  };
  prototype.doRequest=wrapped;
  const originalErrorOut=errorOutModule.errorOut;
  errorOutModule.errorOut=function(error,...args){
    try{
      const terminal=createSafeTerminalErrorDiagnostic(error,requestEvents);
      writeLine(terminalDiagnosticPrefix+nonce+':'+JSON.stringify(terminal)+'\n');
    }catch{}
    return originalErrorOut.call(this,error,...args);
  };
  Object.defineProperty(prototype,installed,{value:true});
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
  const errorOutModule=localRequire('../node_modules/firebase-tools/lib/errorOut.js');
  installFirebaseCliRequestDiagnostics({Client,errorOutModule,nonce});
}
