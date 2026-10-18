// Reuses the fictional two-member Auth emulator seeding model from PoC PR #2.
// No passwords or private identities are committed; seeds only loopback emulators.
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore} from 'firebase-admin/firestore';
import {randomBytes} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
if(process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099'||process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8081') throw Error('Refusing to seed non-local Firebase');
const app=initializeApp({projectId:'demo-justelle-pilot'});
const auth=getAuth(app),db=getFirestore(app),fixture={},people={},labels={};
for(const [name,label] of [['a','Fictional A'],['b','Fictional B']]) {
  const uid='fictional-'+name,email='pilot-'+name+'@example.invalid',password=randomBytes(18).toString('base64url');
  await auth.createUser({uid,email,password});
  await auth.setCustomUserClaims(uid,{justelle_member:true,justelle_room:'fictional-room'});
  fixture[name]={email,password};people[uid]='person-'+name;labels[uid]=label;
}
await db.doc('rooms/fictional-room').set({uids:['fictional-a','fictional-b'],people,labels});
const file=join(tmpdir(),'justelle-local-accounts-'+process.pid+'.json');
await writeFile(file,JSON.stringify(fixture),{mode:0o600,flag:'wx'});
await db.terminate();await deleteApp(app);
process.stdout.write(file+'\n');
