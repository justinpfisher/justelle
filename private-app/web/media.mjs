// Original iPhone HEIC/HEIF remains intact; only the in-app preview is converted.
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
export function imageMime(file) {
  const mime=(file.type||'').toLowerCase();
  if (['image/png','image/jpeg','image/heic','image/heif'].includes(mime)) return mime;
  const ext=(file.name||'').split('.').pop()?.toLowerCase();
  return ({png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',heic:'image/heic',heif:'image/heif'})[ext]||null;
}
export async function sha256(bytes) {
  const data=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
  const digest=await crypto.subtle.digest('SHA-256',data);
  return Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
}
export async function prepareImage(file) {
  const mime=imageMime(file);
  if (!mime) throw Error('Choose a PNG, JPEG, HEIC or HEIF image.');
  if (!file.size || file.size>MAX_IMAGE_BYTES) throw Error('Images must be between 1 byte and 12 MB. Try a smaller export or screenshot.');
  let previewBlob=null;
  if (mime==='image/heic'||mime==='image/heif') {
    try {
      const {default:convert}=await import('heic2any');
      const result=await convert({blob:file,toType:'image/jpeg',quality:0.92});
      previewBlob=Array.isArray(result)?result[0]:result;
      if (!previewBlob || previewBlob.size>MAX_IMAGE_BYTES) throw Error('Unable to make a usable JPEG preview.');
    } catch {
      throw Error('This device could not convert the HEIC image. Please share a JPEG or screenshot instead; nothing has been uploaded.');
    }
  }
  const show=previewBlob||file;
  return {file,mime,previewBlob,url:URL.createObjectURL(show)};
}
export function revokePrepared(item) {if(item?.url) URL.revokeObjectURL(item.url);}
