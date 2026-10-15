import { createQuori } from './avatar.js';
import { mountQuoriWidget } from './widget.js';
import { createQuoriClient } from './client.js';
import { STATES,GESTURES,GESTURE_DURATIONS } from './motion.mjs';
const $=s=>document.querySelector(s);
const labels={idle:'At ease',listening:'Listening',thinking:'Thinking',speaking:'Speaking',curious:'Curious',focused:'Focused',happy:'Happy',concerned:'Concerned',surprised:'Surprised',sleepy:'Sleepy',sleeping:'Asleep',hello:'Hello',wink:'Wink',nod:'Yes',shake:'Not quite',laugh:'Laugh',celebrate:'Celebrate',hop:'Hop',spin:'Full turn',unfold:'Unfold',wake:'Wake up',shy:'Shy',scan:'Look around'};
const descriptions={idle:'A gentle float, a curious glance, and the occasional blink.',listening:'Leans in, opens his eyes, and gives you his attention.',thinking:'A thoughtful tilt, an upward glance, and a restless little square.',speaking:'A soft cadence of mouth shapes and small conversational nods.',curious:'One raised brow. There’s something worth a closer look.',focused:'Quiet eyes and a steady gaze when the details matter.',happy:'A bright smile that reaches his eyes.',concerned:'A softer expression for moments that need a little care.',surprised:'Wide eyes and a quick opening of the shell.',sleepy:'Heavy eyelids and a slower, gentler presence.',sleeping:'A little breathing room. Ready whenever you are.',hello:'A friendly bob and a wave from his mint square.',wink:'A quick wink, with just a hint of mischief.',nod:'Two small nods to let you know he’s with you.',shake:'A gentle shake. Let’s take another look.',laugh:'Eyes closed, a warm laugh, and a few little bounces.',celebrate:'A little joy for a job well done.',hop:'A buoyant hop, then a soft return.',spin:'A full turn to see his sculpted shape from every side.',unfold:'Three pearl pieces open, pause, and come home.',wake:'A stretch, a brightening gaze, and back to the moment.',shy:'A sideways glance and a small, bashful tilt.',scan:'Curious eyes take in the space around him.'};
let state='idle',motionEnabled=true,showing=false,showTimer=null,actionTimer=null;
const media=matchMedia('(prefers-reduced-motion: reduce)');
const avatar=createQuori($('#stage'),{onError:error=>{console.error('Quori renderer:',error);$('#render-note').hidden=false;}});
const widget=mountQuoriWidget({transport:createQuoriClient()});
function caption(name){$('#current-name').textContent=labels[name];$('#current-description').textContent=descriptions[name];}
function highlight(){document.querySelectorAll('[data-state]').forEach(b=>{if(b.tagName==='BUTTON')b.setAttribute('aria-pressed',String(b.dataset.state===state));});}
function clearGestureButtons(){document.querySelectorAll('[data-action]').forEach(b=>b.setAttribute('aria-pressed','false'));}
function setState(name){clearTimeout(actionTimer);clearGestureButtons();state=name;avatar.setState(name);widget.setCharacterState(name);highlight();caption(name);}
function play(name){
  if(!motionEnabled||media.matches)return;
  clearTimeout(actionTimer);clearGestureButtons();avatar.play(name);widget.play(name);caption(name);
  document.querySelector(`[data-action="${name}"]`)?.setAttribute('aria-pressed','true');
  actionTimer=setTimeout(()=>{clearGestureButtons();caption(state);},(GESTURE_DURATIONS[name]+.25)*1000);
}
function stopShowcase(){showing=false;clearTimeout(showTimer);$('#showcase span:nth-child(2)').textContent='Play the showcase';$('#showcase .play-icon').textContent='▷';$('#showcase-note').textContent='A tour of every expression and move.';}
function stopChatSequence(){}
function interrupt(){stopShowcase();stopChatSequence();}
for(const name of STATES){const b=document.createElement('button');b.className='pose-button';b.dataset.state=name;b.textContent=labels[name];b.setAttribute('aria-pressed',String(name===state));b.addEventListener('click',()=>{interrupt();setState(name);});$('#states').append(b);}
for(const name of GESTURES){const b=document.createElement('button');b.className='pose-button';b.dataset.action=name;b.textContent=labels[name];b.setAttribute('aria-pressed','false');b.addEventListener('click',()=>{interrupt();play(name);});$('#gestures').append(b);}
const sequence=[...STATES.map(name=>({name,kind:'state',seconds:2.1})),...GESTURES.map(name=>({name,kind:'gesture',seconds:GESTURE_DURATIONS[name]+.35}))];
$('#showcase').addEventListener('click',()=>{
  if(showing){stopShowcase();setState('idle');return;}
  interrupt();showing=true;$('#showcase span:nth-child(2)').textContent='Stop the showcase';$('#showcase .play-icon').textContent='Ⅱ';
  let index=0;
  function next(){if(!showing)return;if(index>=sequence.length){stopShowcase();setState('idle');return;}const step=sequence[index++];if(step.kind==='state')setState(step.name);else{setState('idle');play(step.name);}$('#showcase-note').textContent=`${index} of ${sequence.length} · ${labels[step.name]}`;showTimer=setTimeout(next,step.seconds*1000);}
  next();
});
function syncMotion(){
  const active=motionEnabled&&!media.matches;avatar.setMotion(active);widget.setMotionAllowed(active);
  $('#motion').setAttribute('aria-pressed',String(!active));$('#motion-text').textContent=media.matches?'Reduced motion':active?'Pause motion':'Resume motion';
  $('#motion').setAttribute('aria-label',media.matches?'Reduced motion is enabled on your device':active?'Pause motion':'Resume motion');
  $('#motion').disabled=media.matches;$('#motion .pause-icon').textContent=active?'Ⅱ':'▷';
  $('#showcase').disabled=!active;document.querySelectorAll('[data-action]').forEach(b=>b.disabled=!active);
  if(!active){interrupt();clearTimeout(actionTimer);clearGestureButtons();caption(state);}
  $('#showcase-note').textContent=media.matches?'Your device’s reduced motion preference is respected.':!active?'Resume motion to play the animations.':'A tour of every expression and move.';
}
$('#motion').addEventListener('click',()=>{motionEnabled=!motionEnabled;syncMotion();});media.addEventListener('change',syncMotion);syncMotion();
$('#theme').addEventListener('click',()=>{const light=document.documentElement.dataset.theme!=='light';document.documentElement.dataset.theme=light?'light':'dark';$('#theme').setAttribute('aria-label',`Switch to ${light?'dark':'light'} background`);$('.brand img').src=`../assets/quadrion-symbol-on-${light?'light':'dark'}.svg`;});
const dialog=$('#reference');
$('#reference-open').addEventListener('click',()=>{interrupt();dialog.showModal();document.body.classList.add('modal-open');avatar.setVisible(false);widget.setVisible(false);});
$('#reference-close').addEventListener('click',()=>dialog.close());dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
dialog.addEventListener('close',()=>{document.body.classList.remove('modal-open');avatar.setVisible(true);widget.setVisible(true);});
$('#demo').addEventListener('click',()=>{interrupt();widget.open();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){interrupt();clearTimeout(actionTimer);clearGestureButtons();caption(state);}});
window.addEventListener('pagehide',event=>{if(event.persisted)return;interrupt();clearTimeout(actionTimer);avatar.destroy();widget.destroy();});
