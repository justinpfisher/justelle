import {initializeApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore} from 'firebase-admin/firestore';
import {getStorage} from 'firebase-admin/storage';
import {onRequest} from 'firebase-functions/v2/https';
import {createMediaHandler} from '../media-handler.mjs';

initializeApp();

const roomId=process.env.JUSTELLE_ROOM_ID;
const serviceAccount=process.env.JUSTELLE_GATEWAY_SERVICE_ACCOUNT;
if(!roomId||!serviceAccount)throw new Error('Gateway runtime configuration is incomplete');

const db=getFirestore();
const bucket=getStorage().bucket();
const media=createMediaHandler({
  roomId,
  bucket,
  verifyIdentity:(token,options)=>getAuth().verifyIdToken(token,options.checkRevoked),
  readMembership:async(id)=>{
    const snapshot=await db.doc('rooms/'+id).get();
    return snapshot.exists?snapshot.data():null;
  }
});

export const privateApi=onRequest({
  region:'northamerica-northeast1',
  memory:'512MiB',
  timeoutSeconds:30,
  minInstances:0,
  maxInstances:3,
  concurrency:20,
  invoker:'public',
  serviceAccount
},async(req,res)=>{
  if(req.path==='/healthz'){
    if(req.method!=='GET'){res.set('Allow','GET').status(405).end();return;}
    res.set('Cache-Control','no-store').status(204).end();
    return;
  }
  await media(req,res);
});
