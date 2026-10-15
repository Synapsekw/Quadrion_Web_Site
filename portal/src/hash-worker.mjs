import {createSHA256} from 'hash-wasm';
self.onmessage=async({data})=>{
  try{const file=data.file,hash=await createSHA256();hash.init();const chunk=4*1024*1024;
    for(let offset=0;offset<file.size;offset+=chunk){hash.update(new Uint8Array(await file.slice(offset,offset+chunk).arrayBuffer()));self.postMessage({progress:Math.min(offset+chunk,file.size)/file.size});}
    self.postMessage({sha256:hash.digest('hex')});
  }catch{self.postMessage({error:'Could not read this file. Please select it again.'});}
};
