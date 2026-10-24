// One source for the approved B2 bucket and prefix boundary.
// Used by the uncaptured owner-only bootstrap and the scheduled cloud worker.
export function selectBootstrapTarget(environment='qualification',bucketName){
  if(environment==='qualification'){
    const selectedBucket=bucketName??'justelle-qualification-backups';
    if(typeof selectedBucket!=='string'||!/^justelle-qualification-backups(?:-[a-z0-9]{3,12})?$/.test(selectedBucket))
      throw Error('Fictional B2 bootstrap requires an approved qualification bucket');
    return {project:'justelle-qualification',bucket:selectedBucket,
      prefix:'qualification/',keyName:'justelle-qualification-backup'};
  }
  if(environment==='production'){
    if(typeof bucketName!=='string'||!/^justelle-production-backups(?:-[a-z0-9]{3,12})?$/.test(bucketName))
      throw Error('Production requires a separate approved Justelle production backup bucket');
    return {project:'justelle-production',bucket:bucketName,
      prefix:'production/',keyName:'justelle-production-backup'};
  }
  throw Error('Unsupported B2 bootstrap environment');
}

// Reject a mismatched secret BEFORE reading private Firebase data or uploading.
// Bucket naming is only an isolation preflight, never proof of IAM or retention.
export function requireScheduledBackupTarget(config,productionApproved=false){
  if(typeof productionApproved!=='boolean'||typeof config?.bucket!=='string')
    throw Error('B2 backup destination is missing or its environment is invalid');
  const target=selectBootstrapTarget(productionApproved?'production':'qualification',config.bucket);
  if(config.prefix!==target.prefix.slice(0,-1))
    throw Error('B2 backup destination prefix does not match its environment');
  return true;
}
