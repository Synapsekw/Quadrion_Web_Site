// The resumable upload library is only needed once someone uploads; it is a separate chunk loaded on first use.
let pending=null;
// After a deploy the old chunk name is gone (hashed files), so a tab opened earlier cannot fetch it: the message says so
// and the error carries reload:true so the page can offer a reload button.
export const STALE_PAGE_MESSAGE='The upload tool could not load. The site may have been updated since this page was opened: reload the page, then upload again.';
export function loadUpload(load=()=>import('tus-js-client')){
  pending??=Promise.resolve().then(load).then(m=>m.Upload,error=>{pending=null;const failure=new Error(STALE_PAGE_MESSAGE,{cause:error});failure.reload=true;throw failure;});
  return pending;
}
export function forgetUpload(){pending=null;}
