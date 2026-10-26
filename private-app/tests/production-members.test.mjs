import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,chmod,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateProductionMemberConfig,provisionProductionMembers,readOwnerConfig} from
  '../tools/provision-production-members.mjs';

const config=()=>({
  mode:'production',projectId:'justelle-production',otherProjectId:'justelle-qualification',
  site:'justelle-production',origin:'https://app.justelle.life',roomId:'shared-life',
  apiKey:'public-synthetic-key',
  gatewayServiceAccount:'gateway@justelle-production.iam.gserviceaccount.com',
  backupServiceAccount:'backup@justelle-production.iam.gserviceaccount.com',
  members:[
    {email:'a@example.invalid',password:'synthetic-strong-password-a',label:'Person A'},
    {email:'b@example.invalid',password:'synthetic-strong-password-b',label:'Person B'}
  ]
});

function scenario({existingRoom=null,existingEmails=[],failCreationAt=0,failClaimAt=0,
  failRoomCreation=false,roomCreateCommits=false,failCleanup=false}={}){
  let room=existingRoom;
  const events=[],users=[];
  let createdCount=0,claimCount=0;
  for(const e of existingEmails){
    users.push({uid:e.uid,email:e.email,disabled:false,customClaims:e.claims||{}});
  }
  const auth={
    async getUserByEmail(email){
      events.push(['get-email']);
      const found=users.find(u=>u.email===email);
      if(!found)throw Object.assign(Error('Synthetic no user'),{code:'auth/user-not-found'});
      return found;
    },
    async createUser({email,password,displayName,emailVerified,disabled}){
      events.push(['create-user',email]);
      if(++createdCount===failCreationAt)throw Error('Synthetic create failure');
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
      if(++claimCount===failClaimAt)throw Error('Synthetic claims failure');
      users.find(u=>u.uid===uid).customClaims=claims;
    },
    async deleteUser(uid){
      events.push(['delete',uid]);
      if(failCleanup)throw Error('Synthetic cleanup failure');
      const i=users.findIndex(u=>u.uid===uid);if(i>=0)users.splice(i,1);
    }
  };
  const db={doc(path){
    assert.equal(path,'rooms/shared-life');
    return {
      async get(){events.push(['read-room']);return {exists:room!==null,data:()=>room};},
      async create(value){
        events.push(['create-room']);
        if(room!==null)throw Error('Room already exists');
        if(roomCreateCommits)room=value;
        if(failRoomCreation)throw Error('Synthetic Firestore failure');
        room=value;
      }
    };
  }};
  const ids=['person-synthetic-a','person-synthetic-b'];
  return {auth,db,events,users,get room(){return room;},newPersonId:()=>ids.shift()};
}

test('real member setup is pinned to Justelle production and two unique private credentials',()=>{
  const good=validateProductionMemberConfig(config());
  assert.equal(good.roomId,'shared-life');
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
    {justelle_member:true,justelle_room:'shared-life'},
    {justelle_member:true,justelle_room:'shared-life'}
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
    {uid:'uid-first',email:'a@example.invalid',claims:{justelle_member:true,justelle_room:'shared-life'}},
    {uid:'uid-second',email:'b@example.invalid',claims:{justelle_member:true,justelle_room:'shared-life'}}
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
