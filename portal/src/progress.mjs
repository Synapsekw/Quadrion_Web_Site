// A thin bar along the top of the page while any request is in flight for longer than `delay` ms.
// track() is called when a request starts and returns its done(); quick requests never show the bar.
export function createProgress({show,hide,delay=150,schedule=setTimeout,cancel=clearTimeout}){
  let pending=0,timer=null,shown=false;
  function settle(){if(pending>0)return;if(timer!==null){cancel(timer);timer=null;}if(shown){shown=false;hide();}}
  function track(){
    pending++;
    if(!shown&&timer===null)timer=schedule(()=>{timer=null;if(pending>0&&!shown){shown=true;show();}},delay);
    let finished=false;
    return ()=>{if(finished)return;finished=true;pending--;settle();};
  }
  return {track,get pending(){return pending;},get shown(){return shown;}};
}
// The bar itself: CSS draws it (portal.css .top-progress); the class names are its only state, so the CSP needs no inline styles.
export function progressBar(doc=document){
  const bar=doc.createElement('div');bar.className='top-progress';bar.setAttribute('aria-hidden','true');
  doc.body.prepend(bar);
  return createProgress({
    // Dropping both classes and reading layout restarts the growth animation from zero.
    show(){bar.classList.remove('done','on');void bar.offsetWidth;bar.classList.add('on');},
    hide(){bar.classList.remove('on');bar.classList.add('done');},
  });
}
