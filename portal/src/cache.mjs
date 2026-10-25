// One value per session, fetched once and refreshed in the background (stale while revalidate).
// get() answers from memory when it can and only waits on the very first load; a value older than maxAge
// still answers at once and starts one quiet refresh. onChange runs after every successful load.
// seed: an optional {read(),write(value)} store (sessionStorage) so a reload can draw before the first answer.
// ownerOf (optional) names whose value it is; ownedBy(id) drops a value that belongs to another user.
export function createCache(load,{maxAge=60000,now=Date.now,onChange=()=>{},seed=null,ownerOf=null}={}){
  let value,at=0,inflight=null,version=0;
  try{const stored=seed?.read();if(stored&&now()-stored.at<maxAge*10){value=stored.value;at=0;}}catch{}
  function refresh(){
    const mine=++version;
    let started;try{started=Promise.resolve(load());}catch(error){started=Promise.reject(error);}
    const run=started.then(result=>{
      if(mine!==version)return result;
      value=result;at=now();inflight=null;
      try{seed?.write({value:result,at});}catch{}
      onChange(result);return result;
    },error=>{if(mine===version)inflight=null;throw error;});
    inflight=run;return run;
  }
  return {
    get(){
      if(value===undefined)return inflight||refresh();
      if(now()-at>maxAge&&!inflight)refresh().catch(()=>{});
      return Promise.resolve(value);
    },
    peek:()=>value,
    // A tab can switch users (an invite or recovery link opened in it): another user's remembered value is dropped.
    ownedBy(id){if(value===undefined||!ownerOf)return;let owner;try{owner=ownerOf(value);}catch{owner=undefined;}if(!id||owner!==id)this.clear();},
    // Starts a refresh unless one is already running; never throws.
    revalidate(){return (inflight||refresh()).catch(()=>{});},
    refresh,
    // A value the page already knows (the answer to a save), kept without asking the server again.
    set(next){version++;inflight=null;value=next;at=now();try{seed?.write({value:next,at});}catch{}},
    clear(){value=undefined;at=0;inflight=null;version++;try{seed?.write(null);}catch{}},
  };
}
// A sessionStorage slot for createCache's seed; every access is guarded (private windows, blocked storage).
export function sessionSeed(key,storage=globalThis.sessionStorage){
  return {
    read(){try{const raw=storage?.getItem(key);return raw?JSON.parse(raw):null;}catch{return null;}},
    write(entry){try{storage?.setItem(key,JSON.stringify(entry));}catch{}},
  };
}
