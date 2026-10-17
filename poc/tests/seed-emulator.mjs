// Creates fictional accounts in *local Firebase emulators only*. Passwords are
// randomly generated at test runtime and are never committed or logged.
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore} from 'firebase-admin/firestore';
import {randomBytes} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const hostAuth=process.env.FIREBASE_AUTH_EMULATOR_HOST;
const hostDb=process.env.FIRESTORE_EMULATOR_HOST;
if(!hostAuth?.includes('127.0.0.1') || !hostDb?.includes('127.0.0.1')) throw Error('Refusing to seed outside local emulators');
const app=initializeApp({projectId:'demo-justelle-poc'});
const auth=getAuth(app), db=getFirestore(app);const fixture={};
for(const name of ['a','b']) {
 const uid=`fictional-${name}`;
 const email=`justelle-${name}@example.invalid`;
 const password=randomBytes(18).toString('base64url');
 await auth.createUser({uid,email,password});
 await auth.setCustomUserClaims(uid,{justelle_room:'fictional-room',justelle_member:true});
 fixture[name]={email,password};
}
await db.doc('rooms/fictional-room').set({uids:['fictional-a','fictional-b']});
const filename=join(tmpdir(),`justelle-poc-${process.pid}.json`);
await writeFile(filename,JSON.stringify(fixture),{mode:0o600,flag:'wx'});
await db.terminate();
await deleteApp(app);
process.stdout.write(filename+'\n');
