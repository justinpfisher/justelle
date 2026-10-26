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
       m.password.length<8||m.password.length>128||
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
    throw safeFailure('AUTH_USER_LOOKUP',providerCode(error,'AUTH_LOOKUP_FAILED'));
  }
}
const PROVIDER_CODES=new Map([
  ['auth/invalid-credential','AUTH_INVALID_CREDENTIAL'],
  ['auth/insufficient-permission','PERMISSION_DENIED'],
  ['auth/email-already-exists','AUTH_EMAIL_ALREADY_EXISTS'],
  ['auth/claims-too-large','AUTH_CLAIMS_TOO_LARGE'],
  ['auth/invalid-claims','AUTH_CLAIMS_INVALID'],
  ['auth/reserved-claims','AUTH_CLAIMS_RESERVED'],
  ['auth/invalid-email','AUTH_INVALID_EMAIL'],
  ['auth/invalid-display-name','AUTH_INVALID_DISPLAY_NAME'],
  ['auth/invalid-disabled-field','AUTH_INVALID_DISABLED_FIELD'],
  ['auth/invalid-email-verified','AUTH_INVALID_EMAIL_VERIFIED'],
  ['auth/project-not-found','AUTH_PROJECT_NOT_FOUND'],
  ['auth/internal-error','AUTH_INTERNAL_ERROR'],
  ['auth/weak-password','AUTH_PASSWORD_POLICY_REJECTED'],
  ['auth/invalid-password','AUTH_PASSWORD_REJECTED'],
  ['auth/operation-not-allowed','AUTH_OPERATION_NOT_ALLOWED'],
  ['auth/too-many-requests','AUTH_RATE_LIMITED'],
  ['permission-denied','PERMISSION_DENIED'],['7','PERMISSION_DENIED'],
  ['unauthenticated','UNAUTHENTICATED'],['16','UNAUTHENTICATED'],
  ['unavailable','SERVICE_UNAVAILABLE'],['14','SERVICE_UNAVAILABLE'],
  ['deadline-exceeded','DEADLINE_EXCEEDED'],['4','DEADLINE_EXCEEDED'],
  ['resource-exhausted','RESOURCE_EXHAUSTED'],['8','RESOURCE_EXHAUSTED'],
  ['already-exists','ALREADY_EXISTS'],['6','ALREADY_EXISTS'],
  ['failed-precondition','FAILED_PRECONDITION'],['9','FAILED_PRECONDITION'],
  ['invalid-argument','INVALID_ARGUMENT'],['3','INVALID_ARGUMENT'],
  ['not-found','NOT_FOUND'],['5','NOT_FOUND'],
  ['internal','INTERNAL'],['13','INTERNAL'],['unknown','UNKNOWN'],['2','UNKNOWN']
]);
const DIAGNOSTIC_PHASES=new Set([
  'LOCAL_CONFIG_PATH','LOCAL_CONFIG_READ','LOCAL_CONFIG_PARSE','LOCAL_CONFIG_VALIDATION',
  'LOCAL_TERMINAL','LOCAL_ARGUMENTS','ADC_CREDENTIAL_RESOLUTION','ADC_AUTHENTICATION',
  'FIREBASE_ADMIN_INITIALIZATION','FIREBASE_READ_ONLY_CHECK','FIRESTORE_ROOM_READ',
  'AUTH_USER_LOOKUP','ROOM_VALIDATION','AUTH_USER_CREATE','AUTH_CLAIMS_WRITE',
  'FIRESTORE_ROOM_WRITE','ROLLBACK','PROVISIONER'
]);
const DIAGNOSTIC_CODES=new Set([
  ...PROVIDER_CODES.values(),'AUTH_LOOKUP_FAILED','ROOM_READ_FAILED','ROOM_REFERENCE_FAILED',
  'CONFIG_PATH_INVALID_OR_UNAVAILABLE','CONFIG_READ_FAILED','CONFIG_JSON_INVALID',
  'CONFIG_VALIDATION_FAILED','OWNER_TERMINAL_REQUIRED','INVALID_COMMAND_ARGUMENTS',
  'ADC_CREDENTIAL_UNAVAILABLE','ADC_TOKEN_ACQUISITION_FAILED',
  'FIREBASE_ADMIN_INITIALIZATION_FAILED','ADMIN_CLIENT_UNAVAILABLE','UNEXPECTED_FAILURE',
  'EXISTING_ROOM_REQUIRES_REVIEW','EXISTING_USERS_REQUIRE_REVIEW','AUTH_CREATE_FAILED',
  'AUTH_CREATE_INVALID_RESULT','ROOM_PERSON_ID_INVALID','ROOM_PERSON_ID_GENERATION_FAILED',
  'AUTH_CLAIMS_FAILED','ROOM_WRITE_FAILED','ROOM_STATE_INVALID','AUTH_ACCOUNT_CLEANUP_FAILED',
  'FIREBASE_ADMIN_MODULE_UNAVAILABLE'
]);
function providerCode(error,fallback){
  const value=error&&['string','number'].includes(typeof error.code)?String(error.code).toLowerCase():'';
  return PROVIDER_CODES.get(value)||fallback;
}
function safeFailure(phase,code,previous=null){
  const message=code==='EXISTING_ROOM_REQUIRES_REVIEW'?
    'An existing private room or member mapping requires manual owner review':
    code==='EXISTING_USERS_REQUIRE_REVIEW'?
      'Existing accounts without a room require private owner review':
      phase==='ROLLBACK'?
        'Member setup failed; account cleanup is incomplete; inspect production privately':
        'Member setup stopped safely; inspect production account/room state before retrying';
  const error=new Error(message);
  error.name='ProductionMemberSetupError';
  error.phase=phase;
  error.code=code;
  if(previous)error.previous=previous;
  return error;
}
export function productionMemberDiagnostic(error,defaultPhase='PROVISIONER'){
  const phase=DIAGNOSTIC_PHASES.has(error?.phase)?error.phase:
    DIAGNOSTIC_PHASES.has(defaultPhase)?defaultPhase:'PROVISIONER';
  const defaults={LOCAL_CONFIG_PATH:'CONFIG_PATH_INVALID_OR_UNAVAILABLE',
    LOCAL_CONFIG_READ:'CONFIG_READ_FAILED',LOCAL_CONFIG_PARSE:'CONFIG_JSON_INVALID',
    LOCAL_CONFIG_VALIDATION:'CONFIG_VALIDATION_FAILED',LOCAL_TERMINAL:'OWNER_TERMINAL_REQUIRED',
    LOCAL_ARGUMENTS:'INVALID_COMMAND_ARGUMENTS',ADC_CREDENTIAL_RESOLUTION:'ADC_CREDENTIAL_UNAVAILABLE',
    FIREBASE_ADMIN_INITIALIZATION:'FIREBASE_ADMIN_INITIALIZATION_FAILED'};
  const code=DIAGNOSTIC_CODES.has(error?.code)?error.code:
    defaults[phase]||'UNEXPECTED_FAILURE';
  const result={success:false,phase,code};
  if(error?.previous&&DIAGNOSTIC_PHASES.has(error.previous.phase)&&
      DIAGNOSTIC_CODES.has(error.previous.code))
    result.previousFailure={phase:error.previous.phase,code:error.previous.code};
  return result;
}
async function readExistingState({roomRef,auth,members}){
  let roomPromise;
  try{roomPromise=roomRef.get();}
  catch(error){throw safeFailure('FIRESTORE_ROOM_READ',providerCode(error,'ROOM_READ_FAILED'));}
  roomPromise=Promise.resolve(roomPromise).catch(error=>{
    throw safeFailure('FIRESTORE_ROOM_READ',providerCode(error,'ROOM_READ_FAILED'));
  });
  const reads=members.map(member=>existingUser(auth,member.email));
  let results;
  try{results=await Promise.all([roomPromise,...reads]);}
  catch(error){throw error?.phase?error:safeFailure('AUTH_USER_LOOKUP','AUTH_LOOKUP_FAILED');}
  const [roomSnapshot,...existing]=results;
  return {roomSnapshot,existing};
}
function matchingRoom(roomSnapshot,existing,members,roomId){
  if(!roomSnapshot.exists)return false;
  const prior=roomSnapshot.data();
  return existing.every((user,i)=>user&&!user.disabled&&
    user.customClaims?.justelle_member===true&&user.customClaims.justelle_room===roomId&&
    prior?.uids?.[i]===user.uid&&prior?.people?.[user.uid]&&
    prior?.labels?.[user.uid]===members[i].label)&&
    prior?.uids?.length===2&&new Set(prior.uids).size===2;
}
export async function inspectProductionMemberState({config,auth,db}){
  let validated;
  try{validated=validateProductionMemberConfig(config);}
  catch{throw safeFailure('LOCAL_CONFIG_VALIDATION','CONFIG_VALIDATION_FAILED');}
  if(!auth||!db)throw safeFailure('FIREBASE_ADMIN_INITIALIZATION','ADMIN_CLIENT_UNAVAILABLE');
  let roomRef;
  try{roomRef=db.doc('rooms/'+validated.roomId);}
  catch(error){throw safeFailure('FIRESTORE_ROOM_READ',providerCode(error,'ROOM_REFERENCE_FAILED'));}
  let roomSnapshot,existing;
  try{({roomSnapshot,existing}=await readExistingState({roomRef,auth,members:validated.members}));}
  catch(error){throw error?.phase?error:safeFailure('FIRESTORE_ROOM_READ','ROOM_READ_FAILED');}
  let existingVerified;
  try{existingVerified=matchingRoom(roomSnapshot,existing,validated.members,validated.roomId);}
  catch(error){throw safeFailure('ROOM_VALIDATION',providerCode(error,'ROOM_STATE_INVALID'));}
  if(roomSnapshot.exists&&!existingVerified)
    throw safeFailure('ROOM_VALIDATION','EXISTING_ROOM_REQUIRES_REVIEW');
  if(!roomSnapshot.exists&&existing.some(Boolean))
    throw safeFailure('AUTH_USER_LOOKUP','EXISTING_USERS_REQUIRE_REVIEW');
  return {state:existingVerified?'existing_setup_verified':'ready_for_provisioning',
    existingVerified,roomExists:!!roomSnapshot.exists,existingUsers:existing.filter(Boolean).length};
}
export async function provisionProductionMembers({config,auth,db,newPersonId=()=> 'person-'+randomUUID()}){
  let validated;
  try{validated=validateProductionMemberConfig(config);}
  catch{throw safeFailure('LOCAL_CONFIG_VALIDATION','CONFIG_VALIDATION_FAILED');}
  const {roomId,members}=validated;
  if(!auth||!db||typeof newPersonId!=='function')throw safeFailure('FIREBASE_ADMIN_INITIALIZATION','ADMIN_CLIENT_UNAVAILABLE');
  let roomRef;
  try{roomRef=db.doc('rooms/'+roomId);}
  catch(error){throw safeFailure('FIRESTORE_ROOM_READ',providerCode(error,'ROOM_REFERENCE_FAILED'));}
  let roomSnapshot,existing;
  try{({roomSnapshot,existing}=await readExistingState({roomRef,auth,members}));}
  catch(error){throw error?.phase?error:safeFailure('FIRESTORE_ROOM_READ','ROOM_READ_FAILED');}
  if(roomSnapshot.exists){
    let verified;
    try{verified=matchingRoom(roomSnapshot,existing,members,roomId);}
    catch(error){throw safeFailure('ROOM_VALIDATION',providerCode(error,'ROOM_STATE_INVALID'));}
    if(!verified)
      throw safeFailure('ROOM_VALIDATION','EXISTING_ROOM_REQUIRES_REVIEW');
    return {created:false,existingVerified:true};
  }
  // Preexisting accounts without an established room could have been created by
  // somebody else. Never silently promote them to members, even by matching email.
  if(existing.some(Boolean))throw safeFailure('AUTH_USER_LOOKUP','EXISTING_USERS_REQUIRE_REVIEW');
  const created=[];
  let roomCreationAttempted=false;
  try{
    for(const member of members){
      let user;
      try{user=await auth.createUser({email:member.email,password:member.password,
        displayName:member.label,emailVerified:false,disabled:false});}
      catch(error){throw safeFailure('AUTH_USER_CREATE',providerCode(error,'AUTH_CREATE_FAILED'));}
      if(typeof user?.uid!=='string'||!user.uid||created.includes(user.uid))
        throw safeFailure('AUTH_USER_CREATE','AUTH_CREATE_INVALID_RESULT');
      created.push(user.uid);
    }
    const people={};const labels={};
    for(let i=0;i<created.length;i++){
      let personId;
      try{personId=newPersonId();}
      catch{throw safeFailure('ROOM_VALIDATION','ROOM_PERSON_ID_GENERATION_FAILED');}
      if(typeof personId!=='string'||!/^person-[a-zA-Z0-9-]{6,100}$/.test(personId)||
         Object.values(people).includes(personId))throw safeFailure('ROOM_VALIDATION','ROOM_PERSON_ID_INVALID');
      people[created[i]]=personId;labels[created[i]]=members[i].label;
      try{await auth.setCustomUserClaims(created[i],{
        justelle_member:true,justelle_room:roomId
      });}catch(error){throw safeFailure('AUTH_CLAIMS_WRITE',providerCode(error,'AUTH_CLAIMS_FAILED'));}
    }
    roomCreationAttempted=true;
    try{await roomRef.create({uids:created,people,labels,revoked_auth_before:{}});}
    catch(error){throw safeFailure('FIRESTORE_ROOM_WRITE',providerCode(error,'ROOM_WRITE_FAILED'));}
    return {created:true,count:2,roomCreated:true};
  }catch(error){
    // Cleanup applies only to newly-created, not-yet-authorised identities.
    // After a possibly committed room write, never delete an account blindly.
    const previous=error?.phase?{phase:error.phase,code:error.code}:
      {phase:'PROVISIONER',code:'UNEXPECTED_FAILURE'};
    let cleanupFailed=false;
    if(!roomCreationAttempted){
      for(const uid of created.reverse()){
        try{await auth.deleteUser(uid);}catch{cleanupFailed=true;}
      }
    }
    if(cleanupFailed)throw safeFailure('ROLLBACK','AUTH_ACCOUNT_CLEANUP_FAILED',previous);
    throw error?.phase?error:safeFailure('PROVISIONER','UNEXPECTED_FAILURE');
  }
}

export async function readOwnerConfig(file,onPhase=()=>{}){
  onPhase('LOCAL_CONFIG_PATH');
  if(typeof file!=='string'||!isAbsolute(file))throw Error('Private absolute config path is required');
  const info=await lstat(file);
  if(!info.isFile()||info.isSymbolicLink()||info.size<16||info.size>32768)
    throw Error('The private production config must be a regular small file');
  const current=await realpath(file),repo=await realpath(fileURLToPath(new URL('../../',import.meta.url)));
  if(within(repo,current)||/(^|[\\/])onedrive(?:[ \t]*[-–][^\\/]+|[ \t]*\([^\\/]+\))?([\\/]|$)/i.test(current))
    throw Error('Private production credentials must be outside GitHub and OneDrive');
  if(process.platform!=='win32'&&(info.mode&0o077)!==0)
    throw Error('The private production config must not be readable by other local users');
  onPhase('LOCAL_CONFIG_READ');
  const contents=await readFile(current,'utf8');
  onPhase('LOCAL_CONFIG_PARSE');
  let config;
  try{config=JSON.parse(contents);}
  catch{throw safeFailure('LOCAL_CONFIG_PARSE','CONFIG_JSON_INVALID');}
  onPhase('LOCAL_CONFIG_VALIDATION');
  try{validateProductionMemberConfig(config);}
  catch{throw safeFailure('LOCAL_CONFIG_VALIDATION','CONFIG_VALIDATION_FAILED');}
  return config;
}

async function verifyApplicationDefaultCredential(credential){
  if(!credential||typeof credential.getAccessToken!=='function')
    throw safeFailure('ADC_CREDENTIAL_RESOLUTION','ADC_CREDENTIAL_UNAVAILABLE');
  try{await credential.getAccessToken();}
  catch(error){throw safeFailure('ADC_AUTHENTICATION',providerCode(error,'ADC_TOKEN_ACQUISITION_FAILED'));}
}

export async function diagnoseProductionMemberSetup({config,credential,auth,db}){
  try{validateProductionMemberConfig(config);}
  catch{throw safeFailure('LOCAL_CONFIG_VALIDATION','CONFIG_VALIDATION_FAILED');}
  await verifyApplicationDefaultCredential(credential);
  const state=await inspectProductionMemberState({config,auth,db});
  return {success:true,readOnly:true,...state};
}

function failureForCurrentPhase(error,phase){
  if(error?.phase)return error;
  return safeFailure(phase,productionMemberDiagnostic(error,phase).code);
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  let app,phase='LOCAL_TERMINAL';
  try{
    if(process.env.CI||process.env.GITHUB_ACTIONS)
      throw safeFailure('LOCAL_TERMINAL','OWNER_TERMINAL_REQUIRED');
    const args=process.argv.slice(2);
    const readOnly=args[0]==='--diagnose-readonly';
    if(!readOnly&&(!process.stdin.isTTY||!process.stdout.isTTY))
      throw safeFailure('LOCAL_TERMINAL','OWNER_TERMINAL_REQUIRED');
    const configFile=readOnly&&args.length===2?args[1]:!readOnly&&args.length===1?args[0]:null;
    if(!configFile)throw safeFailure('LOCAL_ARGUMENTS','INVALID_COMMAND_ARGUMENTS');
    phase='LOCAL_CONFIG_PATH';
    const config=await readOwnerConfig(configFile,next=>{phase=next;});
    phase='FIREBASE_ADMIN_INITIALIZATION';
    let appModule,authModule,firestoreModule;
    try{
      [appModule,authModule,firestoreModule]=await Promise.all([
        import('firebase-admin/app'),import('firebase-admin/auth'),import('firebase-admin/firestore')
      ]);
    }catch(error){throw safeFailure('FIREBASE_ADMIN_INITIALIZATION',providerCode(error,'FIREBASE_ADMIN_MODULE_UNAVAILABLE'));}
    const {initializeApp,applicationDefault,deleteApp}=appModule;
    const {getAuth}=authModule;
    const {getFirestore}=firestoreModule;
    phase='ADC_CREDENTIAL_RESOLUTION';
    let credential;
    try{credential=applicationDefault();}
    catch(error){throw safeFailure('ADC_CREDENTIAL_RESOLUTION',providerCode(error,'ADC_CREDENTIAL_UNAVAILABLE'));}
    phase='ADC_AUTHENTICATION';
    await verifyApplicationDefaultCredential(credential);
    phase='FIREBASE_ADMIN_INITIALIZATION';
    try{app=initializeApp({credential,projectId:project},'justelle-member-onboarding');}
    catch(error){throw safeFailure('FIREBASE_ADMIN_INITIALIZATION',providerCode(error,'FIREBASE_ADMIN_INITIALIZATION_FAILED'));}
    const auth=getAuth(app),db=getFirestore(app);
    if(readOnly){
      phase='FIREBASE_READ_ONLY_CHECK';
      const result=await inspectProductionMemberState({config,auth,db});
      console.log(JSON.stringify({success:true,readOnly:true,state:result.state}));
    }else{
      phase='PROVISIONER';
      const result=await provisionProductionMembers({config,auth,db});
      console.log(JSON.stringify({production_members:result.created?'created':'verified',
        count:2,room:result.created?'created':'verified'}));
    }
    await deleteApp(app).catch(()=>{});app=null;
  }catch(error){
    console.error(JSON.stringify(productionMemberDiagnostic(failureForCurrentPhase(error,phase),phase)));
    process.exitCode=1;
  }finally{
    if(app){
      const {deleteApp}=await import('firebase-admin/app');
      await deleteApp(app).catch(()=>{});
    }
  }
}
