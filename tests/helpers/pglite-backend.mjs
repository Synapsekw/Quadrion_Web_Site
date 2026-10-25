// The portal backend over PGlite: the real SQL, with Auth and Storage faked at the edge.
// Mirrors netlify/lib/portal/supabase.mjs: RPC errors surface as `portal:<code>` or `portal:unavailable`.
const json=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)?JSON.stringify(value):value;
export function pgliteBackend(db,{tokens={}}={}){
  async function rpc(name,args={}){
    if(!/^[a-z_]+$/.test(name))throw new Error('portal:unavailable');
    const names=Object.keys(args);
    if(names.some(key=>!/^p_[a-z_]+$/.test(key)))throw new Error('portal:unavailable');
    try{
      const {rows}=await db.query(`select public.${name}(${names.map((key,i)=>`${key} => $${i+1}`).join(',')}) as result`,names.map(key=>json(args[key])));
      return rows[0].result;
    }catch(error){const code=/portal:[a-z_]+/.exec(error?.message||'')?.[0];throw new Error(code||'portal:unavailable');}
  }
  // Storage: an in-memory bucket. `put` stands in for the tus upload the browser makes.
  const objects=new Map(),uploads=[],signed=[];
  const storage={
    put:(bucket,path,size)=>objects.set(bucket+'/'+path,{size}),
    from:bucket=>({
      async createSignedUploadUrl(path,options){uploads.push({bucket,path,options});return {data:{token:'upload-token-'+uploads.length},error:null};},
      async info(path){const found=objects.get(bucket+'/'+path);return found?{data:{size:found.size},error:null}:{data:null,error:{message:'Object not found'}};},
    }),
  };
  return {
    rpc,signed,uploads,service:{storage},
    async verifyUser(token){
      const userId=tokens[token];if(!userId)throw new Error('portal:unauthorized');
      const email=(await db.query('select email from auth.users where id=$1',[userId])).rows[0]?.email||'';
      return {userId,email,emailConfirmed:true,aal:'aal1'};
    },
    async confirmSession(token,user){if(!tokens[token]||tokens[token]!==user?.userId)throw new Error('portal:unauthorized');},
    account:userId=>rpc('portal_account',{p_actor:userId}),
    async signDownload(file,ttl,download=true){
      signed.push({id:file.id,ttl,download});
      return `https://oxjrkodcmflxejdwsuac.supabase.co/storage/v1/object/sign/${file.object_path}?ttl=${ttl}`;
    },
  };
}
