import {Upload} from 'tus-js-client';
import {el,button,notice,bytes} from './ui.mjs';
const prefix='quadrion-upload:';
const urlStorage={
  async findAllUploads(){return Object.keys(sessionStorage).filter(k=>k.startsWith(prefix+'tus:')).flatMap(k=>{try{return [{...JSON.parse(sessionStorage.getItem(k)),urlStorageKey:k}];}catch{return [];}});},
  async findUploadsByFingerprint(f){return (await this.findAllUploads()).filter(u=>u.fingerprint===f);},
  async addUpload(f,upload){const key=prefix+'tus:'+crypto.randomUUID();sessionStorage.setItem(key,JSON.stringify({...upload,fingerprint:f}));return key;},
  async removeUpload(key){sessionStorage.removeItem(key);},
};
export function uploadControl({api,releaseId=null,projectVersionId=null,kind='binary',limit,onVerified=()=>{}}){
  let current,worker,cancelled=false,sessionId=null,timer;
  const key=prefix+'session:'+(releaseId||projectVersionId)+':'+kind;
  const fileInput=el('input',{type:'file',accept:kind==='preview'?'.png,.jpg,.jpeg,.webp':projectVersionId?'.aio':'.exe,.msi,.zip,.dmg,.pkg,.deb,.AppImage','aria-label':kind==='preview'?'Preview image':'Select upload file'}),progress=el('progress',{value:0,max:100,'aria-label':'File progress'}),status=el('p',{class:'muted'},limit>0?'Maximum '+bytes(limit)+'. Files stay private until verified and published.':'Project uploads are not configured yet.'),feedback=el('div',{'aria-live':'polite'});
  async function cancel(){cancelled=true;worker?.terminate();await current?.abort();clearTimeout(timer);status.textContent='Paused. Select the same file and resume to continue.';start.disabled=false;}
  async function poll(){
    if(cancelled||!sessionId)return;
    try{const result=await api.post('uploadStatus',{id:sessionId});progress.value=result.bytes?result.verifiedBytes/result.bytes*100:0;
      status.textContent='Verifying stored file · '+Math.round(progress.value)+'%';
      if(result.state==='verified'){status.textContent='Verified. Ready for publication.';progress.value=100;feedback.replaceChildren(notice('Size and SHA-256 match the source file.'));sessionStorage.removeItem(key);await onVerified();return;}
      if(result.state==='failed'){status.textContent='Verification needs attention: '+(result.error||'interrupted');feedback.replaceChildren(button('Retry verification',async()=>{await api.post('retryVerification',{id:sessionId});poll();},true));return;}
      timer=setTimeout(poll,5000);
    }catch(error){feedback.replaceChildren(notice(error.message,'error'),button('Check verification again',poll,true));}
  }
  async function begin(){
    const file=fileInput.files?.[0];if(!file){feedback.replaceChildren(notice('Select a file first.','error'));return;}
    if(!limit||file.size>limit){feedback.replaceChildren(notice('The file exceeds the configured upload limit.','error'));return;}
    cancelled=false;start.disabled=true;feedback.replaceChildren();status.textContent='Calculating the source checksum…';
    try{
      const sha256=await new Promise((resolve,reject)=>{worker=new Worker('/assets/portal/hash-worker.js',{type:'module'});worker.onmessage=({data})=>{if(data.progress!==undefined)progress.value=data.progress*100;if(data.sha256){worker.terminate();resolve(data.sha256);}if(data.error){worker.terminate();reject(new Error(data.error));}};worker.onerror=()=>reject(new Error('The checksum worker could not start.'));worker.postMessage({file});});
      if(cancelled)return;
      const prior=sessionStorage.getItem(key),input={releaseId,projectVersionId,kind,filename:file.name,bytes:file.size,sha256};
      const session=prior?await api.post('resumeUpload',{id:prior,filename:file.name,bytes:file.size,sha256}):await api.post('upload',input);
      sessionId=session.id;sessionStorage.setItem(key,sessionId);status.textContent='Uploading to the private library…';progress.value=0;
      await new Promise(async(resolve,reject)=>{
        current=new Upload(file,{endpoint:session.endpoint,headers:{'x-signature':session.token,'x-upsert':'false'},chunkSize:6*1024*1024,uploadDataDuringCreation:true,removeFingerprintOnSuccess:true,urlStorage,fingerprint:async()=>session.objectPath+':'+sha256,retryDelays:[0,3000,5000,10000,20000],metadata:{bucketName:session.bucket,objectName:session.objectPath,contentType:session.contentType,cacheControl:'0'},onProgress:(done,total)=>{progress.value=done/total*100;status.textContent='Uploading · '+bytes(done)+' of '+bytes(total);},onError:()=>reject(new Error('Upload paused. Select the same file and resume.')),onSuccess:resolve});
        try{const previous=await current.findPreviousUploads();if(previous.length)current.resumeFromPreviousUpload(previous[0]);current.start();}catch(error){reject(error);}
      });
      if(cancelled)return;await api.post('finalize',{id:sessionId});poll();
    }catch(error){if(!cancelled)feedback.replaceChildren(notice(error.message,'error'));start.disabled=false;}
  }
  const start=button('Upload / resume',begin),pause=button('Pause',cancel,true);
  if(!limit)start.disabled=true;
  window.addEventListener('quadrion:signout',cancel,{once:true});
  const saved=sessionStorage.getItem(key);
  const resumeCheck=saved?button('Check previous upload',async()=>{sessionId=saved;const s=await api.post('uploadStatus',{id:saved});if(s.state==='pending'){await api.post('finalize',{id:saved});}cancelled=false;poll();},true):null;
  return el('section',{class:'upload-box'},fileInput,status,progress,el('div',{class:'actions'},start,pause,resumeCheck),feedback);
}
