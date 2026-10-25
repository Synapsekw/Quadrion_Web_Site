// The resumable upload library is only needed once someone uploads; it is a separate chunk loaded on first use.
let pending=null;
export function loadUpload(){pending??=import('tus-js-client').then(m=>m.Upload,error=>{pending=null;throw new Error('The upload tool could not load. Check your connection, then try again.',{cause:error});});return pending;}
