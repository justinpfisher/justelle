import test from 'node:test';
import assert from 'node:assert/strict';
import {ReadableStream} from 'node:stream/web';
import {readDefaultBucket} from '../hosting/firebase-storage-default-bucket-probe.mjs';

const token='synthetic-access-token-never-output';
const endpoint='https://firebasestorage.googleapis.com/v1alpha/projects/justelle-qualification/defaultBucket';

test('successful probe uses the exact fixed read-only endpoint and emits no response body or headers',async()=>{
  let request;
  const response=new Response(JSON.stringify({bucket:'private-bucket-id'}),{status:200});
  const result=await readDefaultBucket({accessToken:token,fetchImpl:async(url,options)=>{
    request={url,options};return response;
  }});
  assert.equal(request.url,endpoint);
  assert.equal(request.options.method,'GET');
  assert.equal(request.options.redirect,'error');
  assert.equal(request.options.headers.Authorization,'Bearer '+token);
  assert.deepEqual(result,{operation:'FIREBASE_STORAGE_DEFAULT_BUCKET_GET',httpStatus:200,permissionCategory:'NONE'});
  assert.equal(response.bodyUsed,false);
  assert.equal(JSON.stringify(result).includes(token),false);
  assert.equal(JSON.stringify(result).includes('private-bucket-id'),false);
});

test('explicit Firebase permission status is reduced to a fixed category with no body disclosure',async()=>{
  const privateMessage='fixture-password=synthetic-secret email=member@example.invalid project=private-project';
  const response=new Response(JSON.stringify({error:{code:403,status:'PERMISSION_DENIED',message:privateMessage}}),{status:403});
  const result=await readDefaultBucket({accessToken:token,fetchImpl:async()=>response});
  assert.deepEqual(result,{operation:'FIREBASE_STORAGE_DEFAULT_BUCKET_GET',httpStatus:403,permissionCategory:'PERMISSION_DENIED'});
  const serialized=JSON.stringify(result);
  for(const secret of [privateMessage,'synthetic-secret','member@example.invalid','private-project',token])assert.equal(serialized.includes(secret),false);
});

test('only explicit allowlisted API status is classified; arbitrary text stays unknown',async()=>{
  const response=new Response(JSON.stringify({error:{message:'PERMISSION_DENIED details should not be inferred'}}),{status:403});
  assert.deepEqual(await readDefaultBucket({accessToken:token,fetchImpl:async()=>response}),{
    operation:'FIREBASE_STORAGE_DEFAULT_BUCKET_GET',httpStatus:403,permissionCategory:'UNKNOWN'
  });
});

test('oversized provider error body is cancelled and never classified from partial text',async()=>{
  let cancelled=false;
  const body=new ReadableStream({
    start(controller){controller.enqueue(new TextEncoder().encode(JSON.stringify({error:{status:'PERMISSION_DENIED'}})+'x'.repeat(70*1024)));},
    cancel(){cancelled=true;}
  });
  const response=new Response(body,{status:403});
  const result=await readDefaultBucket({accessToken:token,fetchImpl:async()=>response});
  assert.equal(result.permissionCategory,'UNKNOWN');
  assert.equal(result.httpStatus,403);
  assert.equal(cancelled,true);
});

test('invalid auth material is rejected before any request and is not returned',async()=>{
  let called=false;
  await assert.rejects(readDefaultBucket({accessToken:'bad token',fetchImpl:async()=>{called=true;}}),/AUTH_CONTEXT_UNAVAILABLE/);
  assert.equal(called,false);
});
