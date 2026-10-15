import {createSHA256} from 'hash-wasm';
// Hash state is version-pinned with hash-wasm and saved after each complete range.
// Neither a request nor a retry ever buffers a whole project.
export async function verifySlice({job,readRange,checkpoint,clock=Date.now,budgetMs=8*60*1000,chunkBytes=16*1024*1024}){
  const started=clock(),hash=await createSHA256();hash.init();
  let offset=Number(job.verified_bytes),etag=job.object_etag||null;
  if(offset>0){if(!job.hash_state)throw new Error('invalid_checkpoint');hash.load(Buffer.from(job.hash_state,'base64'));}
  while(offset<Number(job.bytes)){
    if(clock()-started>=budgetMs)return {done:false};
    const end=Math.min(offset+chunkBytes,Number(job.bytes))-1,response=await readRange(offset,end,etag);
    if(response.status!==206||response.headers.get('content-range')!==`bytes ${offset}-${end}/${job.bytes}`)throw new Error('invalid_range');
    const current=response.headers.get('etag');if(!current||(etag&&etag!==current))throw new Error('object_changed');etag=current;
    let received=0;for await(const chunk of response.body){received+=chunk.byteLength;if(received>end-offset+1)throw new Error('size_mismatch');hash.update(chunk);}
    if(received!==end-offset+1)throw new Error('size_mismatch');offset=end+1;
    // Save even the final pre-digest state so a crash during completion is resumable.
    await checkpoint({offset,etag,hashState:Buffer.from(hash.save()).toString('base64')});
  }
  const digest=hash.digest('hex');if(digest!==job.sha256)throw new Error('checksum_mismatch');return {done:true,sha256:digest,offset,etag};
}
