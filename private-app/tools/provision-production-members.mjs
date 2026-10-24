// Initial real-member setup. Use only from an uncaptured, owner-controlled terminal
// with a separately protected production release configuration. No identifiers,
// passwords, user data or provider errors may be printed by this command.
import {randomUUID} from 'node:crypto';
import {readFile,lstat,realpath} from 'node:fs/promises';
import {isAbsolute,relative,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {buildEnvironment} from '../hosting/deployment-config.mjs';

const project='justelle-production';
const other='justelle-qualification';
const safeEmail=value=>typeof value==='string'&&value===value.trim()&&
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)&&value.length<=254;
function within(parent,child){
  const part=relative(parent,child);
  return part===''||part!=='..'&&!part.startsWith('..'+sep)&&!isAbsolute(part);
}
export function validateProductionMemberConfig(config){
  if(!config||typeof config!=='object'||config.mode!=='production'||
     config.projectId!==project||config.otherProjectId!==other||
     config.site!=='justelle-production'||config.origin!=='https://app.justelle.life')
    throw Error('Owner production member setup requires only the approved Justelle projects and site');
  buildEnvironment(config);
  if(!Array.isArray(config.members)||config.members.length!==2||
     config.members.some((m,i)=>!safeEmail(m?.email)||typeof m.password!=='string'||
       m.password.length<12||m.password.length>128||
       (m.label!==undefined&&(typeof m.label!=='string'||!m.label.trim()||
         m.label.length>40||m.label!==m.label.trim())))||
     new Set(config.members.map(m=>m.email.toLowerCase())).size!==2)
    throw Error('Two unique private member emails and independent passwords are required');
  if(config.members[0].password===config.members[1].password)
    throw Error('Member passwords must be independent');
  return {roomId:config.roomId,members:config.members.map((m,i)=>({
    email:m.email,password:m.password,label:m.label||'Member '+(i+1)
  }))};
}
async function existingUser(auth,email){
  try{return await auth.getUserByEmail(email);}
  catch(error){
    if(error?.code==='auth/user-not-found')return null;
    throw error;
  }
}
export async function provisionProductionMembers({config,auth,db,newPersonId=()=> 'person-'+randomUUID()}){
  const {roomId,members}=validateProductionMemberConfig(config);
  if(!auth||!db||typeof newPersonId!=='function')throw Error('Owner administration is unavailable');
  const roomRef=db.doc('rooms/'+roomId);
  const [roomSnapshot,...existing]=await Promise.all([
    roomRef.get(),...members.map(member=>existingUser(auth,member.email))
  ]);
  if(roomSnapshot.exists){
    const prior=roomSnapshot.data();
    const valid=existing.every((u,i)=>u&&!u.disabled&&
      u.customClaims?.justelle_member===true&&u.customClaims.justelle_room===roomId&&
      prior?.uids?.[i]===u.uid&&prior?.people?.[u.uid]&&
      prior?.labels?.[u.uid]===members[i].label)&&
      prior?.uids?.length===2&&new Set(prior.uids).size===2;
    if(!valid)throw Error('An existing private room or member mapping requires manual owner review');
    return {created:false,existingVerified:true};
  }
  // Preexisting accounts without an established room could have been created by
  // somebody else. Never silently promote them to members, even by matching email.
  if(existing.some(Boolean))throw Error('Existing accounts without a room require private owner review');
  const created=[];
  let roomCreationAttempted=false;
  try{
    for(const member of members){
      const user=await auth.createUser({email:member.email,password:member.password,
        displayName:member.label,emailVerified:false,disabled:false});
      if(typeof user?.uid!=='string'||!user.uid||created.includes(user.uid))
        throw Error('Firebase did not create a distinct member UID');
      created.push(user.uid);
    }
    const people={};const labels={};
    for(let i=0;i<created.length;i++){
      const personId=newPersonId();
      if(typeof personId!=='string'||!/^person-[a-zA-Z0-9-]{6,100}$/.test(personId)||
         Object.values(people).includes(personId))throw Error('Stable person IDs must be unique');
      people[created[i]]=personId;labels[created[i]]=members[i].label;
      await auth.setCustomUserClaims(created[i],{
        justelle_member:true,justelle_room:roomId
      });
    }
    roomCreationAttempted=true;
    await roomRef.create({uids:created,people,labels,revoked_auth_before:{}});
    return {created:true,count:2,roomCreated:true};
  }catch{
    // Cleanup applies only to newly-created, not-yet-authorised identities.
    // After a possibly committed room write, never delete an account blindly.
    let cleanupFailed=false;
    if(!roomCreationAttempted){
      for(const uid of created.reverse()){
        try{await auth.deleteUser(uid);}catch{cleanupFailed=true;}
      }
    }
    throw Error(cleanupFailed?'Member setup failed; account cleanup is incomplete; inspect production privately':
      'Member setup stopped safely; inspect production account/room state before retrying');
  }
}

export async function readOwnerConfig(file){
  if(typeof file!=='string'||!isAbsolute(file))throw Error('Private absolute config path is required');
  const info=await lstat(file);
  if(!info.isFile()||info.isSymbolicLink()||info.size<16||info.size>32768)
    throw Error('The private production config must be a regular small file');
  const current=await realpath(file),repo=await realpath(fileURLToPath(new URL('../../',import.meta.url)));
  if(within(repo,current)||/(^|[\\/])onedrive(?:[ \t]*[-–][^\\/]+|[ \t]*\([^\\/]+\))?([\\/]|$)/i.test(current))
    throw Error('Private production credentials must be outside GitHub and OneDrive');
  if(process.platform!=='win32'&&(info.mode&0o077)!==0)
    throw Error('The private production config must not be readable by other local users');
  const config=JSON.parse(await readFile(current,'utf8'));
  validateProductionMemberConfig(config);
  return config;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  let app;
  try{
    if(process.env.CI||process.env.GITHUB_ACTIONS||!process.stdin.isTTY||!process.stdout.isTTY)
      throw Error('Owner-controlled private terminal required');
    const config=await readOwnerConfig(process.argv[2]);
    const {initializeApp,applicationDefault,deleteApp}=await import('firebase-admin/app');
    const {getAuth}=await import('firebase-admin/auth');
    const {getFirestore}=await import('firebase-admin/firestore');
    app=initializeApp({credential:applicationDefault(),projectId:project},'justelle-member-onboarding');
    const result=await provisionProductionMembers({config,auth:getAuth(app),db:getFirestore(app)});
    console.log(JSON.stringify({production_members:result.created?'created':'verified',
      count:2,room:result.created?'created':'verified'}));
    await deleteApp(app);app=null;
  }catch{
    // Account/project identifiers or private filesystem paths in provider errors
    // must never be emitted into public agent logs.
    console.error('Production member setup did not complete; inspect private Firebase state and credentials.');
    process.exitCode=1;
  }finally{
    if(app){
      const {deleteApp}=await import('firebase-admin/app');
      await deleteApp(app).catch(()=>{});
    }
  }
}
