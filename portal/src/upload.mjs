import {loadUpload} from './tus.mjs';
import {el,button,notice,bytes} from './ui.mjs';
const prefix='quadrion-upload:';
const urlStorage={
  async findAllUploads(){return Object.keys(sessionStorage).filter(k=>k.startsWith(prefix+'tus:')).flatMap(k=>{try{return [{...JSON.parse(sessionStorage.getItem(k)),urlStorageKey:k}];}catch{return [];}});},
  async findUploadsByFingerprint(f){return (await this.findAllUploads()).filter(u=>u.fingerprint===f);},
  async addUpload(f,upload){const key=prefix+'tus:'+crypto.randomUUID();sessionStorage.setItem(key,JSON.stringify({...upload,fingerprint:f}));return key;},
  async removeUpload(key){sessionStorage.removeItem(key);},
};
export function uploadControl({api,releaseId=null,projectVersionId=null,kind='binary',limit,existing=null,onVerified=()=>{}}){
  let current,worker,cancelled=false,timer,rejectPending,abandonReviewed=false,expectedFile=existing;
  const key=prefix+'session:'+(releaseId||projectVersionId)+':'+kind;
  let sessionId=existing?.upload_session_id||sessionStorage.getItem(key);
  const fileInput=el('input',{type:'file',accept:kind==='preview'?'.png,.jpg,.jpeg,.webp':projectVersionId?'.aio':'.exe,.msi,.zip,.dmg,.pkg,.deb,.AppImage','aria-label':kind==='preview'?'Preview image':'Select upload file'}),progress=el('progress',{value:0,max:100,'aria-label':'File progress'}),status=el('p',{class:'muted'},limit>0?'Maximum '+bytes(limit)+'. Files stay private until verified and published.':'Project uploads are not configured yet.'),feedback=el('div',{'aria-live':'polite'});
  const expectedLabel=el('p',{class:'muted'},existing?'Upload file: '+existing.filename+' · '+bytes(existing.bytes)+'. Select this same file to resume.':'');
  async function cancel(){cancelled=true;worker?.terminate();rejectPending?.(new Error('Paused'));rejectPending=null;await current?.abort();clearTimeout(timer);status.textContent='Paused. Select the same file and resume to continue.';start.disabled=false;}
  async function attempt(task){try{await task();}catch(error){feedback.replaceChildren(notice(error.message,'error'));}}
  async function poll(){
    if(cancelled||!sessionId)return;
    try{const result=await api.post('uploadStatus',{id:sessionId});progress.value=result.bytes?result.verifiedBytes/result.bytes*100:0;
      status.textContent='Verifying stored file · '+Math.round(progress.value)+'%';
      if(result.state==='verified'){status.textContent='Verified. Ready for publication.';progress.value=100;feedback.replaceChildren(notice('Size and SHA-256 match the source file.'));sessionStorage.removeItem(key);await onVerified('verified');return;}
      if(result.state==='pending'){status.textContent='Upload incomplete. Select the same file to resume, or check a completed upload.';return;}
      if(result.state==='cancelled'){status.textContent='This upload was abandoned. Reopen the project or release to select a replacement.';return;}
      if(result.state==='failed'){status.textContent='Verification needs attention: '+(result.error||'interrupted');feedback.replaceChildren(button('Retry verification',()=>attempt(async()=>{await api.post('retryVerification',{id:sessionId});await poll();}),true));return;}
      timer=setTimeout(poll,5000);
    }catch(error){feedback.replaceChildren(notice(error.message,'error'),button('Check verification again',poll,true));}
  }
  async function begin(){
    const file=fileInput.files?.[0];if(!file){feedback.replaceChildren(notice('Select a file first.','error'));return;}
    if(!limit||file.size>limit){feedback.replaceChildren(notice('The file exceeds the configured upload limit.','error'));return;}
    if(expectedFile&&(file.name!==expectedFile.filename||file.size!==Number(expectedFile.bytes))){status.textContent='Upload not started.';feedback.replaceChildren(notice('This upload expects '+expectedFile.filename+'. Select that file, or use Abandon and replace.','error'));return;}
    cancelled=false;start.disabled=true;feedback.replaceChildren();progress.value=0;status.textContent='Calculating the source checksum…';
    try{
      const sha256=await new Promise((resolve,reject)=>{rejectPending=reject;worker=new Worker('/assets/portal/hash-worker.js',{type:'module'});worker.onmessage=({data})=>{if(data.progress!==undefined)progress.value=data.progress*100;if(data.sha256){worker.terminate();resolve(data.sha256);}if(data.error){worker.terminate();reject(new Error(data.error));}};worker.onerror=()=>reject(new Error('The checksum worker could not start.'));worker.postMessage({file});});rejectPending=null;
      if(cancelled)return;
      status.textContent='Source checksum complete. Preparing upload…';
      const prior=sessionId,input={releaseId,projectVersionId,kind,filename:file.name,bytes:file.size,sha256};
      const session=prior?await api.post('resumeUpload',{id:prior,filename:file.name,bytes:file.size,sha256}):await api.post('upload',input);
      expectedFile={filename:file.name,bytes:file.size};expectedLabel.textContent='Upload file: '+file.name+' · '+bytes(file.size)+'. Select this same file to resume.';
      sessionId=session.id;sessionStorage.setItem(key,sessionId);status.textContent='Uploading to the private library…';progress.value=0;
      const Upload=await loadUpload();if(cancelled)return;
      await new Promise((resolve,reject)=>{
        rejectPending=reject;
        current=new Upload(file,{endpoint:session.endpoint,headers:{'x-signature':session.token,'x-upsert':'false'},chunkSize:6*1024*1024,uploadDataDuringCreation:true,removeFingerprintOnSuccess:true,urlStorage,fingerprint:async()=>session.objectPath+':'+sha256,retryDelays:[0,3000,5000,10000,20000],metadata:{bucketName:session.bucket,objectName:session.objectPath,contentType:session.contentType,cacheControl:'0'},onProgress:(done,total)=>{progress.value=done/total*100;status.textContent='Uploading · '+bytes(done)+' of '+bytes(total);},onError:()=>reject(new Error('Upload paused. Select the same file and resume.')),onSuccess:resolve});
        current.findPreviousUploads().then(previous=>{if(cancelled)return;if(previous.length)current.resumeFromPreviousUpload(previous[0]);current.start();}).catch(reject);
      });rejectPending=null;
      if(cancelled)return;await api.post('finalize',{id:sessionId});poll();
    }catch(error){if(!cancelled){status.textContent='Upload stopped. Review the message below.';feedback.replaceChildren(notice(error.message,'error'));}start.disabled=false;}
  }
  const start=button('Upload / resume',begin),pause=button('Pause',cancel,true);
  if(!limit)start.disabled=true;
  const stop=()=>{cancel();window.removeEventListener('quadrion:signout',stop);window.removeEventListener('quadrion:uploads-pause',stop);};
  window.addEventListener('quadrion:signout',stop,{once:true});window.addEventListener('quadrion:uploads-pause',stop,{once:true});
  const resumeCheck=button('Check completed upload',()=>attempt(async()=>{if(!sessionId)throw new Error('Upload a file first.');const s=await api.post('uploadStatus',{id:sessionId});if(s.state==='pending')await api.post('finalize',{id:sessionId});cancelled=false;await poll();}),true);
  const abandon=button('Abandon and replace',()=>attempt(async()=>{if(!abandonReviewed){feedback.replaceChildren(notice('This discards this unfinished upload. A replacement will use a new private destination.'));abandon.textContent='Confirm abandonment';abandonReviewed=true;return;}await cancel();await api.post('abandonUpload',{id:sessionId});sessionStorage.removeItem(key);await onVerified('abandoned');}),true);
  if(existing&&existing.state!=='pending'){fileInput.hidden=true;start.hidden=true;pause.hidden=true;status.textContent='Stored file: '+existing.state+'. Check its verification or abandon a failed upload.';}
  return el('section',{class:'upload-box'},expectedLabel,fileInput,status,progress,el('div',{class:'actions'},start,pause,resumeCheck,existing&&existing.state!=='verifying'?abandon:null),feedback);
}
