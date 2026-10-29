import {readFile,access,mkdtemp,rm,realpath} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname,join,resolve,relative,isAbsolute} from 'node:path';

const expectedCodebase='gateway';
const expectedSource='functions';
const expectedRuntime='nodejs22';
const expectedEndpoints=['encryptedBackup','privateApi'];
const expectedFirebaseTools='15.34.0';

function scopeError(code,message){
  return Object.assign(new Error(message),{scopeCode:code});
}

export function assertAuthorizedEndpointRoster(endpoints){
  const ids=endpoints.map(endpoint=>endpoint.id).sort();
  if(endpoints.length!==expectedEndpoints.length||new Set(ids).size!==ids.length||
    ids.some((id,index)=>id!==expectedEndpoints[index])){
    throw scopeError('ENDPOINT_ROSTER_MISMATCH','Discovered Functions endpoint roster does not match the authorized roster');
  }
  return {codebase:expectedCodebase,endpointCount:endpoints.length,endpointIds:ids};
}

export async function validateGeneratedFunctionsScope({configPath,projectId}){
  let config;
  try{config=JSON.parse(await readFile(configPath,'utf8'));}
  catch{throw scopeError('CONFIG_INVALID','Generated Functions scope config is invalid');}
  if(!['justelle-qualification','justelle-production'].includes(projectId))
    throw scopeError('PROJECT_NOT_ALLOWED','Generated Functions scope project is not authorized');
  if(!Array.isArray(config.functions)||config.functions.length!==1){
    throw scopeError('CODEBASE_COUNT_MISMATCH','Generated Functions scope must contain only the authorized codebase');
  }
  const [functionConfig]=config.functions;
  if(functionConfig?.codebase!==expectedCodebase||functionConfig?.source!==expectedSource||
    functionConfig?.runtime!==expectedRuntime){
    throw scopeError('CODEBASE_CONFIG_MISMATCH','Generated Functions scope does not match the authorized codebase');
  }
  const projectDirectory=dirname(configPath);
  const sourceDirectory=resolve(projectDirectory,functionConfig.source);
  let actualProjectDirectory,actualSourceDirectory;
  try{
    [actualProjectDirectory,actualSourceDirectory]=await Promise.all([realpath(projectDirectory),realpath(sourceDirectory)]);
  }catch{throw scopeError('SOURCE_OUTSIDE_DEPLOYMENT','Generated Functions source is outside its deployment directory');}
  const rel=relative(actualProjectDirectory,actualSourceDirectory);
  if(!rel||rel.startsWith('..')||isAbsolute(rel))
    throw scopeError('SOURCE_OUTSIDE_DEPLOYMENT','Generated Functions source is outside its deployment directory');
  let packageJson;
  try{packageJson=JSON.parse(await readFile(join(sourceDirectory,'package.json'),'utf8'));}
  catch{throw scopeError('PACKAGE_METADATA_MISSING','Generated Functions package metadata is missing');}
  if(packageJson.main!=='lib/index.mjs')throw scopeError('ENTRYPOINT_MISMATCH','Generated Functions entrypoint is not authorized');
  try{
    await access(join(sourceDirectory,packageJson.main));
    const actualBundle=await realpath(join(sourceDirectory,packageJson.main));
    const bundleRelative=relative(actualSourceDirectory,actualBundle);
    if(!bundleRelative||bundleRelative.startsWith('..')||isAbsolute(bundleRelative))
      throw new Error('bundle outside package');
  }
  catch{throw scopeError('BUNDLE_MISSING','Generated Functions bundle is missing');}

  const require=createRequire(import.meta.url);
  let cliPackagePath,cliRequire,runtimeFactory;
  try{
    cliPackagePath=require.resolve('firebase-tools/package.json');
    cliRequire=createRequire(cliPackagePath);
    const cliPackage=JSON.parse(await readFile(cliPackagePath,'utf8'));
    if(cliPackage.version!==expectedFirebaseTools)
      throw scopeError('CLI_VERSION_UNSUPPORTED','Firebase CLI version is not authorized');
    runtimeFactory=cliRequire('./lib/deploy/functions/runtimes/index.js').getRuntimeDelegate;
  }catch(error){
    if(error?.scopeCode==='CLI_VERSION_UNSUPPORTED')throw error;
    throw scopeError('CLI_DISCOVERY_UNAVAILABLE','Pinned Firebase Functions discovery is unavailable');
  }

  // The CLI's normal discovery subprocess may log its stdout/stderr. Keep this
  // local validation silent and pass a synthetic, credential-free environment.
  const discoveryDirectory=await mkdtemp(join(tmpdir(),'justelle-functions-scope-'));
  const previousDiscoveryPath=process.env.FIREBASE_FUNCTIONS_DISCOVERY_OUTPUT_PATH;
  const previousHome=process.env.HOME;
  const previousCloudSdkConfig=process.env.CLOUDSDK_CONFIG;
  const previousCredentials=process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const logger=cliRequire('./lib/logger.js').logger;
  const previousTransports=logger.transports.map(transport=>transport.silent);
  try{
    process.env.FIREBASE_FUNCTIONS_DISCOVERY_OUTPUT_PATH=discoveryDirectory;
    process.env.HOME=discoveryDirectory;
    process.env.CLOUDSDK_CONFIG=discoveryDirectory;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    for(const transport of logger.transports)transport.silent=true;
    const delegate=await runtimeFactory({
      projectId:'demo-justelle-qualification',
      projectDir:dirname(sourceDirectory),
      sourceDir:sourceDirectory,
      runtime:expectedRuntime
    });
    const discovered=await delegate.discoverBuild({
      firebase:{projectId:'demo-justelle-qualification'},
      env:{JUSTELLE_MODE:'hosted-fictional',JUSTELLE_ROOM_ID:'fictional-room',
        JUSTELLE_ORIGIN:'https://justelle-qualification.web.app',
        JUSTELLE_GATEWAY_SERVICE_ACCOUNT:'gateway@demo-justelle-qualification.iam.gserviceaccount.com',
        JUSTELLE_BACKUP_SERVICE_ACCOUNT:'backup@demo-justelle-qualification.iam.gserviceaccount.com'}
    },{
      FIREBASE_CONFIG:JSON.stringify({projectId:'demo-justelle-qualification',
        storageBucket:'demo-justelle-qualification.firebasestorage.app'}),
      JUSTELLE_MODE:'hosted-fictional',JUSTELLE_ROOM_ID:'fictional-room',
      JUSTELLE_ORIGIN:'https://justelle-qualification.web.app',
      JUSTELLE_GATEWAY_SERVICE_ACCOUNT:'gateway@demo-justelle-qualification.iam.gserviceaccount.com',
      JUSTELLE_BACKUP_SERVICE_ACCOUNT:'backup@demo-justelle-qualification.iam.gserviceaccount.com',
      FUNCTIONS_DISCOVERY_TIMEOUT:'30'
    });
    const endpoints=Object.entries(discovered?.endpoints??{}).map(([id,endpoint])=>({...endpoint,id}));
    return assertAuthorizedEndpointRoster(endpoints);
  }catch(error){
    if(error?.scopeCode)throw error;
    throw scopeError('DISCOVERY_FAILED','Generated Functions endpoint discovery failed');
  }finally{
    logger.transports.forEach((transport,index)=>{transport.silent=previousTransports[index];});
    if(previousDiscoveryPath===undefined)delete process.env.FIREBASE_FUNCTIONS_DISCOVERY_OUTPUT_PATH;
    else process.env.FIREBASE_FUNCTIONS_DISCOVERY_OUTPUT_PATH=previousDiscoveryPath;
    if(previousHome===undefined)delete process.env.HOME;else process.env.HOME=previousHome;
    if(previousCloudSdkConfig===undefined)delete process.env.CLOUDSDK_CONFIG;
    else process.env.CLOUDSDK_CONFIG=previousCloudSdkConfig;
    if(previousCredentials===undefined)delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    else process.env.GOOGLE_APPLICATION_CREDENTIALS=previousCredentials;
    await rm(discoveryDirectory,{recursive:true,force:true});
  }
}
