// Offline, provider-neutral first slice of member-marked adventure sealing.
// The input is a private restored full snapshot, NOT a public/portable media URL.
// An archive is append-only by generation; source deletion remains prohibited.
import {createReadStream} from 'node:fs';
import {readFile,realpath,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {verifyRecords} from '../web/archive-core.mjs';
import {writeEncryptedBackup} from './encrypted-backup.mjs';

export const SEALED_TRIP_FORMAT='justelle-sealed-trip-v1';
export function selectSealedAdventure(records,adventureId){
  verifyRecords(records);
  if(typeof adventureId!=='string'||!adventureId||
     !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(adventureId))
    throw Error('Choose a valid archived adventure');
  const plan=(records.adventure_plans||[]).find(p=>p.id===adventureId);
  if(!plan||plan.state?.status!=='archived')
    throw Error('Only an adventure explicitly moved to the archive can be sealed');
  // An older linked conversation requires a proper correlated export, not
  // silently abandoning correspondence, approvals or message attachments.
  if(records.adventures.some(a=>a.id===adventureId)||
     records.messages.some(m=>m.adventure_id===adventureId)||
     records.decisions.some(d=>d.adventure_id===adventureId))
    throw Error('Linked historical discussion must be included before sealing');
  const selected={
    persons:records.persons,
    conversations:[],messages:[],decisions:[],adventures:[],attachments:[],
    adventure_events:[],
    adventure_plans:[plan],
    plan_events:(records.plan_events||[]).filter(e=>e.adventure_id===adventureId),
    plan_sources:(records.plan_sources||[]).filter(s=>s.adventure_id===adventureId),
    plan_documents:(records.plan_documents||[]).filter(d=>d.adventure_id===adventureId),
    sealed_adventure:{format:SEALED_TRIP_FORMAT,adventure_id:adventureId,
      revision:plan.state.revision,last_event_id:plan.state.last_event_id}
  };
  const independent=structuredClone(selected);
  verifyRecords(independent);
  return independent;
}
export async function sealArchivedAdventureFromRestore({restoredDirectory,adventureId,key,destination}){
  // Restored directories are owner-managed and contain only private files.
  const directory=await realpath(restoredDirectory);
  const records=JSON.parse(await readFile(join(directory,'records.json'),'utf8'));
  const selected=selectSealedAdventure(records,adventureId);
  async function* originals(){
    for(const doc of selected.plan_documents){
      const id='doc-'+doc.id,source=join(directory,'media',id);
      const details=await lstat(source);
      if(!details.isFile()||details.isSymbolicLink())
        throw Error('Sealing requires a private regular original file');
      yield {id,mime:doc.mime,stream:createReadStream(source)};
    }
  }
  // The existing writer checks every SHA-256/size, authenticates each frame
  // and refuses to overwrite a previous sealed generation.
  const result=await writeEncryptedBackup({records:selected,media:originals(),key},destination);
  return {...result,adventure_id:adventureId,revision:selected.sealed_adventure.revision,
    last_event_id:selected.sealed_adventure.last_event_id,
    cloud_copy_verified:false,safe_to_delete_source:false};
}
