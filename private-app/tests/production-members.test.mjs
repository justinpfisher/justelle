import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,chmod,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {validateProductionMemberConfig,provisionProductionMembers,readOwnerConfig,
  inspectProductionMemberState,diagnoseProductionMemberSetup,productionMemberDiagnostic} from
  '../tools/provision-production-members.mjs';

const config=()=>({
  mode:'production',projectId:'justelle-production',otherProjectId:'justelle-qualification',
  site:'justelle-production',origin:'https://app.justelle.life',roomId:'justelle-primary',
  apiKey:'public-synthetic-key',
  gatewayServiceAccount:'gateway@justelle-production.iam.gserviceaccount.com',
  backupServiceAccount:'backup@justelle-production.iam.gserviceaccount.com',
  members:[
    {email:'a@example.invalid',password:'synthetic-strong-password-a',label:'Person A'},
    {email:'b@example.invalid',password:'synthetic-strong-password-b',label:'Person B'}
  ]
});

function scenario({existingRoom=null,existingEmails=[],failLookupAt=0,failRoomRead=false,
  failCreationAt=0,failCreationCode='permission-denied',failClaimAt=0,failClaimCode='unavailable',
  failRoomCreation=false,failRoomCode='already-exists',roomCreateCommits=false,failCleanup=false}={}){
  let room=existingRoom;
  const events=[],users=[];
  let createdCount=0,claimCount=0,lookupCount=0;
  for(const e of existingEmails){
    users.push({uid:e.uid,email:e.email,disabled:false,customClaims:e.claims||{}});
  }
  const auth={
    async getUserByEmail(email){
      events.push(['get-email']);
      if(++lookupCount===failLookupAt)
        throw Object.assign(Error('Synthetic private token and password must not escape'),{code:'auth/invalid-credential'});
      const found=users.find(u=>u.email===email);
      if(!found)throw Object.assign(Error('Synthetic no user'),{code:'auth/user-not-found'});
      return found;
    },
    async createUser({email,password,displayName,emailVerified,disabled}){
      events.push(['create-user',email]);
      if(++createdCount===failCreationAt)
        throw Object.assign(Error('Synthetic private token and password must not escape'),{code:failCreationCode});
      assert.equal(typeof password,'string');
      assert.equal(emailVerified,false);
      assert.equal(disabled,false);
      assert.ok(displayName);
      const user={uid:'uid-'+createdCount,email,customClaims:{}};
      users.push(user);
      return user;
    },
    async setCustomUserClaims(uid,claims){
      events.push(['claims',uid]);
      if(++claimCount===failClaimAt)
        throw Object.assign(Error('Synthetic private token and password must not escape'),{code:failClaimCode});
      users.find(u=>u.uid===uid).customClaims=claims;
    },
    async deleteUser(uid){
      events.push(['delete',uid]);
      if(failCleanup)throw Error('Synthetic cleanup failure');
      const i=users.findIndex(u=>u.uid===uid);if(i>=0)users.splice(i,1);
    }
  };
  const db={doc(path){
    assert.equal(path,'rooms/justelle-primary');
    return {
      async get(){events.push(['read-room']);if(failRoomRead)throw Object.assign(Error('Synthetic private token'),{code:7});return {exists:room!==null,data:()=>room};},
      async create(value){
        events.push(['create-room']);
        if(room!==null)throw Error('Room already exists');
        if(roomCreateCommits)room=value;
        if(failRoomCreation)throw Object.assign(Error('Synthetic Firestore failure'),{code:failRoomCode});
        room=value;
      }
    };
  }};
  const ids=['person-synthetic-a','person-synthetic-b'];
  return {auth,db,events,users,get room(){return room;},newPersonId:()=>ids.shift()};
}

async function diagnosticOf(operation,defaultPhase='PROVISIONER'){
  try{await operation;}
  catch(error){return productionMemberDiagnostic(error,defaultPhase);}
  assert.fail('Expected a synthetic diagnostic failure');
}

test('real member setup is pinned to Justelle production and two unique private credentials',()=>{
  const good=validateProductionMemberConfig(config());
  assert.equal(good.roomId,'justelle-primary');
  assert.equal(good.members.length,2);
  for(const bad of [
    {...config(),mode:'hosted-fictional'},
    {...config(),projectId:'justelle-qualification'},
    {...config(),otherProjectId:'unrelated-project'},
    {...config(),origin:'https://justelle.life'},
    {...config(),site:'justelle-qualification'},
    {...config(),roomId:'fictional-room'},
    {...config(),members:[config().members[0]]},
    {...config(),members:[config().members[0],{...config().members[1],email:'A@example.invalid'}]},
    {...config(),members:[config().members[0],{...config().members[1],password:config().members[0].password}]},
    {...config(),members:[config().members[0],{...config().members[1],password:'short'}]}
  ])assert.throws(()=>validateProductionMemberConfig(bad));
});

test('member password length accepts 8 through 128 characters and rejects outside that range',()=>{
  for(const length of [8,128]){
    const candidate=config();
    candidate.members[0].password='a'.repeat(length);
    candidate.members[1].password='b'.repeat(length);
    assert.equal(validateProductionMemberConfig(candidate).members.length,2);
  }
  for(const length of [7,129]){
    const candidate=config();
    candidate.members[0].password='a'.repeat(length);
    candidate.members[1].password='b'.repeat(length);
    assert.throws(()=>validateProductionMemberConfig(candidate));
  }
  const duplicate=config();
  duplicate.members[0].password='same-password';
  duplicate.members[1].password='same-password';
  assert.throws(()=>validateProductionMemberConfig(duplicate),/independent/);
});

test('creates exactly two separate Auth accounts with matching claims and private immutable room IDs',async()=>{
  const s=scenario();
  const result=await provisionProductionMembers({config:config(),auth:s.auth,db:s.db,
    newPersonId:s.newPersonId});
  assert.deepEqual(result,{created:true,count:2,roomCreated:true});
  assert.deepEqual(s.room.uids,['uid-1','uid-2']);
  assert.deepEqual(s.room.people,{'uid-1':'person-synthetic-a','uid-2':'person-synthetic-b'});
  assert.deepEqual(s.room.labels,{'uid-1':'Person A','uid-2':'Person B'});
  assert.deepEqual(s.room.revoked_auth_before,{});
  assert.deepEqual(s.users.map(u=>u.customClaims),[
    {justelle_member:true,justelle_room:'justelle-primary'},
    {justelle_member:true,justelle_room:'justelle-primary'}
  ]);
  assert.equal(s.events.filter(x=>x[0]==='create-room').length,1);
});

test('a matching existing member room is read-only and preserves historical mappings',async()=>{
  const prior={
    uids:['uid-first','uid-second'],
    people:{'uid-first':'person-older-1','uid-second':'person-older-2'},
    labels:{'uid-first':'Person A','uid-second':'Person B'},
    revoked_auth_before:{'uid-first':42}
  };
  const s=scenario({existingRoom:prior,existingEmails:[
    {uid:'uid-first',email:'a@example.invalid',claims:{justelle_member:true,justelle_room:'justelle-primary'}},
    {uid:'uid-second',email:'b@example.invalid',claims:{justelle_member:true,justelle_room:'justelle-primary'}}
  ]});
  const result=await provisionProductionMembers({config:config(),auth:s.auth,db:s.db,
    newPersonId:s.newPersonId});
  assert.deepEqual(result,{created:false,existingVerified:true});
  assert.deepEqual(s.room,prior);
  assert.ok(s.events.every(e=>!['create-user','create-room','claims','delete'].includes(e[0])));
});

test('preexisting unapproved user or conflicting room is refused without any mutation',async()=>{
  for(const options of [
    {existingEmails:[{uid:'uid-unknown',email:'a@example.invalid'}]},
    {existingRoom:{uids:['other'],people:{}},existingEmails:[]}
  ]){
    const s=scenario(options);
    await assert.rejects(provisionProductionMembers({config:config(),auth:s.auth,db:s.db,
      newPersonId:s.newPersonId}),/review/);
    assert.ok(s.events.every(e=>!['create-user','create-room','claims','delete'].includes(e[0])));
  }
});

test('failure while creating users or claims rolls back only newly created accounts',async()=>{
  for(const options of [{failCreationAt:2},{failClaimAt:1}]){
    const s=scenario(options);
    await assert.rejects(provisionProductionMembers({config:config(),auth:s.auth,db:s.db,
      newPersonId:s.newPersonId}),/stopped safely/);
    assert.equal(s.users.length,0);
    assert.equal(s.room,null);
    assert.ok(s.events.some(e=>e[0]==='delete'));
  }
});

test('uncertain Firestore room creation never deletes potentially authorized users',async()=>{
  const s=scenario({failRoomCreation:true,roomCreateCommits:true});
  await assert.rejects(provisionProductionMembers({config:config(),auth:s.auth,db:s.db,
    newPersonId:s.newPersonId}),/inspect production/);
  assert.equal(s.users.length,2);
  assert.equal(s.room.uids.length,2);
  assert.ok(s.events.every(e=>e[0]!=='delete'));
});

test('failed account cleanup is reported without printing account identifiers',async()=>{
  const s=scenario({failClaimAt:1,failCleanup:true});
  await assert.rejects(provisionProductionMembers({config:config(),auth:s.auth,db:s.db,
    newPersonId:s.newPersonId}),e=>{
      assert.match(e.message,/cleanup is incomplete/);
      assert.equal(e.message.includes('a@example.invalid'),false);
      assert.equal(e.message.includes('uid-1'),false);
      return true;
    });
});

test('read-only diagnostic checks ADC, Auth and room state without calling any mutation API',async()=>{
  const s=scenario();
  const result=await diagnoseProductionMemberSetup({config:config(),
    credential:{async getAccessToken(){return {token:'synthetic-token-not-output'};}},
    auth:s.auth,db:s.db});
  assert.deepEqual(result,{success:true,readOnly:true,state:'ready_for_provisioning',
    existingVerified:false,roomExists:false,existingUsers:0});
  assert.ok(s.events.some(event=>event[0]==='read-room'));
  assert.equal(s.events.filter(event=>event[0]==='get-email').length,2);
  assert.ok(s.events.every(event=>!['create-user','claims','create-room','delete'].includes(event[0])));
  assert.equal(JSON.stringify(result).includes('synthetic-token'),false);
});

test('ADC errors are categorized and serialized without provider messages or token text',async()=>{
  const result=await diagnosticOf(diagnoseProductionMemberSetup({config:config(),
    credential:{async getAccessToken(){throw Object.assign(
      Error('private token abc and member password xyz'),{code:'auth/invalid-credential'});}},
    auth:{},db:{}}));
  assert.deepEqual(result,{success:false,phase:'ADC_AUTHENTICATION',code:'AUTH_INVALID_CREDENTIAL'});
  assert.equal(JSON.stringify(result).includes('private token'),false);
  assert.equal(JSON.stringify(result).includes('member password'),false);
});

test('diagnostic serialization rejects unrecognized provider codes and messages',()=>{
  const hostile=Object.assign(Error('private password and bearer token'),{
    phase:'AUTH_USER_CREATE',code:'PRIVATE_BEARER_TOKEN_123'
  });
  const result=productionMemberDiagnostic(hostile);
  assert.deepEqual(result,{success:false,phase:'AUTH_USER_CREATE',code:'UNEXPECTED_FAILURE'});
  assert.equal(JSON.stringify(result).includes('PRIVATE_BEARER_TOKEN'),false);
  assert.equal(JSON.stringify(result).includes('private password'),false);
});

test('Auth lookup and Firestore room read failures have allowlisted phase and code',async()=>{
  const lookupScenario=scenario({failLookupAt:1});
  const lookup=await diagnosticOf(provisionProductionMembers({config:config(),
    auth:lookupScenario.auth,db:lookupScenario.db,newPersonId:lookupScenario.newPersonId}));
  assert.deepEqual(lookup,{success:false,phase:'AUTH_USER_LOOKUP',code:'AUTH_INVALID_CREDENTIAL'});
  const roomScenario=scenario({failRoomRead:true});
  const room=await diagnosticOf(provisionProductionMembers({config:config(),
    auth:roomScenario.auth,db:roomScenario.db,newPersonId:roomScenario.newPersonId}));
  assert.deepEqual(room,{success:false,phase:'FIRESTORE_ROOM_READ',code:'PERMISSION_DENIED'});
});

test('Auth create and claims failures report safe provider codes and preserve rollback',async()=>{
  const createScenario=scenario({failCreationAt:2,failCreationCode:'auth/email-already-exists'});
  const create=await diagnosticOf(provisionProductionMembers({config:config(),
    auth:createScenario.auth,db:createScenario.db,newPersonId:createScenario.newPersonId}));
  assert.deepEqual(create,{success:false,phase:'AUTH_USER_CREATE',code:'AUTH_EMAIL_ALREADY_EXISTS'});
  assert.equal(createScenario.users.length,0);
  assert.ok(createScenario.events.some(event=>event[0]==='delete'));

  const claimsScenario=scenario({failClaimAt:1,failClaimCode:'auth/claims-too-large'});
  const claims=await diagnosticOf(provisionProductionMembers({config:config(),
    auth:claimsScenario.auth,db:claimsScenario.db,newPersonId:claimsScenario.newPersonId}));
  assert.deepEqual(claims,{success:false,phase:'AUTH_CLAIMS_WRITE',code:'AUTH_CLAIMS_TOO_LARGE'});
  assert.equal(claimsScenario.users.length,0);
  assert.ok(claimsScenario.events.some(event=>event[0]==='delete'));
});

test('room validation and write failures are separated and room-write uncertainty never rolls back',async()=>{
  const invalidId=scenario();
  const validation=await diagnosticOf(provisionProductionMembers({config:config(),auth:invalidId.auth,
    db:invalidId.db,newPersonId:()=> 'bad-id'}));
  assert.deepEqual(validation,{success:false,phase:'ROOM_VALIDATION',code:'ROOM_PERSON_ID_INVALID'});
  assert.equal(invalidId.users.length,0);
  assert.ok(invalidId.events.some(event=>event[0]==='delete'));

  const uncertain=scenario({failRoomCreation:true,failRoomCode:9});
  const write=await diagnosticOf(provisionProductionMembers({config:config(),auth:uncertain.auth,
    db:uncertain.db,newPersonId:uncertain.newPersonId}));
  assert.deepEqual(write,{success:false,phase:'FIRESTORE_ROOM_WRITE',code:'FAILED_PRECONDITION'});
  assert.equal(uncertain.users.length,2);
  assert.ok(uncertain.events.every(event=>event[0]!=='delete'));
});

test('rollback failure reports rollback stage and prior safe failure without private error text',async()=>{
  const s=scenario({failClaimAt:1,failClaimCode:'permission-denied',failCleanup:true});
  const result=await diagnosticOf(provisionProductionMembers({config:config(),auth:s.auth,
    db:s.db,newPersonId:s.newPersonId}));
  assert.deepEqual(result,{success:false,phase:'ROLLBACK',code:'AUTH_ACCOUNT_CLEANUP_FAILED',
    previousFailure:{phase:'AUTH_CLAIMS_WRITE',code:'PERMISSION_DENIED'}});
  assert.equal(JSON.stringify(result).includes('synthetic'),false);
  assert.equal(JSON.stringify(result).includes('a@example.invalid'),false);
});

test('local config parse and validation failures have safe categories',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'justelle-owner-config-diagnostic-'));
  try{
    const filename=join(folder,'production.json');
    await writeFile(filename,'{"password":"SYNTHETIC_DO_NOT_LEAK",',{mode:0o600});
    let phase='LOCAL_CONFIG_PATH';
    const parse=await diagnosticOf(readOwnerConfig(filename,next=>{phase=next;}),phase);
    assert.deepEqual(parse,{success:false,phase:'LOCAL_CONFIG_PARSE',code:'CONFIG_JSON_INVALID'});
    assert.equal(JSON.stringify(parse).includes('SYNTHETIC_DO_NOT_LEAK'),false);

    const invalid=config();invalid.projectId='wrong-synthetic-project';
    await writeFile(filename,JSON.stringify(invalid),{mode:0o600});
    phase='LOCAL_CONFIG_PATH';
    const validation=await diagnosticOf(readOwnerConfig(filename,next=>{phase=next;}),phase);
    assert.deepEqual(validation,{success:false,phase:'LOCAL_CONFIG_VALIDATION',code:'CONFIG_VALIDATION_FAILED'});
    assert.equal(JSON.stringify(validation).includes('synthetic-strong-password'),false);
  }finally{await rm(folder,{recursive:true,force:true});}
});

test('read-only CLI accepts a redirected synthetic diagnostic but performs no provider access',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'justelle-owner-cli-diagnostic-'));
  try{
    const filename=join(folder,'production.json');
    await writeFile(filename,JSON.stringify({...config(),projectId:'synthetic-wrong-project'}),{mode:0o600});
    const script=fileURLToPath(new URL('../tools/provision-production-members.mjs',import.meta.url));
    const childEnv={PATH:process.env.PATH,TEMP:tmpdir(),TMP:tmpdir(),CI:'',GITHUB_ACTIONS:''};
    for(const name of ['SystemRoot','WINDIR'])if(process.env[name])childEnv[name]=process.env[name];
    const result=spawnSync(process.execPath,[script,'--diagnose-readonly',filename],{
      encoding:'utf8',env:childEnv
    });
    assert.equal(result.status,1);
    const payload=JSON.parse(result.stderr.trim());
    assert.deepEqual(payload,{success:false,phase:'LOCAL_CONFIG_VALIDATION',code:'CONFIG_VALIDATION_FAILED'});
    assert.equal(result.stderr.includes('synthetic-strong-password'),false);
    assert.equal(result.stdout.includes('synthetic-strong-password'),false);
  }finally{await rm(folder,{recursive:true,force:true});}
});

test('private config must remain outside repository and OneDrive',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'justelle-owner-member-test-'));
  try{
    const filename=join(folder,'production.json');
    await writeFile(filename,JSON.stringify(config()),{mode:0o600});
    if(process.platform!=='win32')await chmod(filename,0o600);
    assert.equal((await readOwnerConfig(filename)).members.length,2);
    await assert.rejects(readOwnerConfig(fileURLToPath(new URL('../tools/provision-production-members.mjs',import.meta.url))),
      /outside GitHub and OneDrive/);
    const oneDrive=join(folder,'OneDrive');
    await mkdir(oneDrive);
    const synced=join(oneDrive,'production.json');
    await writeFile(synced,JSON.stringify(config()),{mode:0o600});
    await assert.rejects(readOwnerConfig(synced),/outside GitHub and OneDrive/);
    // Windows can label synced folders "OneDrive - Organisation" or "OneDrive (Personal)".
    for(const folderName of ['OneDrive - Example','OneDrive (Personal)']){
      const labelled=join(folder,folderName);
      await mkdir(labelled);
      const file=join(labelled,'production.json');
      await writeFile(file,JSON.stringify(config()),{mode:0o600});
      await assert.rejects(readOwnerConfig(file),/outside GitHub and OneDrive/);
    }
  }finally{await rm(folder,{recursive:true,force:true});}
});
