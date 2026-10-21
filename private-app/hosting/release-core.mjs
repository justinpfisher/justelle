// A first release has no known-good app to roll back to. Attempt both
// independent public-facing shutdowns even if one provider command fails.
// Neither an absent Run policy binding nor a broken CLI may skip Hosting.
export async function disableInitialService({removePublicInvoker,disableHosting}){
  let failures=0;
  for(const close of [removePublicInvoker,disableHosting]){
    try{await close();}catch{failures++;}
  }
  if(failures)throw Error('Initial service shutdown is incomplete; operator recovery required');
}

// A failed release must leave the last verified source as the recovery target.
export async function release({sha,qualified,readLastGood,deploy,check,recordGood,rollback,failClosed,report}){
  if(!qualified||!/^[a-f0-9]{40}$/.test(sha))throw Error('Release has not qualified');
  const previous=await readLastGood();
  if(previous&&!/^[a-f0-9]{40}$/.test(previous.sha))throw Error('Invalid recovery source');
  try{
    await deploy(sha);
    await check(sha);
    await recordGood({sha});
    await report({status:'verified',sha}).catch(()=>{});
    return {status:'verified',sha};
  }catch{
    let recovered=false;
    try{
      if(previous){await rollback(previous.sha);await check(previous.sha);await recordGood(previous);}else await failClosed();
      recovered=true;
    }catch{}
    await report({status:recovered?(previous?'rolled-back':'disabled'):'recovery-failed',sha}).catch(()=>{});
    throw Error(recovered?'Release failed; previous service restored or initial service disabled':'Release and recovery failed; immediate operator attention required');
  }
}
