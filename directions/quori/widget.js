import {arrowIcon,normalizeAnswer,safeLink,technicalSources,resolveQuoriMotion} from './reply.js';
import { createQuori } from './avatar.js';
import {createQuoriClient} from './client.js';
import {createContactFlow} from './contact.js';


let nextId = 0;

/** Reusable same-origin chat with a visitor-reviewed team handoff. */
export function mountQuoriWidget(options = {}) {
  const { container = document.body, routes = {}, resolveHref = href => href, transport = createQuoriClient(), respond = transport.respond, motion = true, requestTimeout = 35000 } = options;
  const host = document.createElement('div'); host.className = 'quori-widget-host';
  const shadow = host.attachShadow({mode:'open'}), style = document.createElement('link'); style.rel='stylesheet'; style.href=new URL('./widget.css',import.meta.url).href;
  const id = `quori-${++nextId}`, shell = document.createElement('div'); shell.className = 'quori-widget';
  // Only fixed authored markup is used here; messages, config values and replies use textContent.
  shell.innerHTML = `
    <button class="quori-launcher" type="button" aria-expanded="false" aria-controls="${id}-panel" aria-label="Open Quori, your Quadrion guide">
      <span class="quori-launcher__avatar"></span><span class="quori-launcher__label">Ask Quori<span>Your Quadrion guide</span></span>
    </button>
    <dialog class="quori-panel" id="${id}-panel" aria-labelledby="${id}-title">
      <header class="quori-panel__header">
        <span class="quori-panel__avatar"></span>
        <div><h2 id="${id}-title">Quori</h2><p>Your Quadrion guide</p></div>
        <button class="quori-icon-button quori-motion-toggle" type="button" aria-label="Pause Quori animation" aria-pressed="false" title="Pause animation">Ⅱ</button>
        <button class="quori-icon-button quori-close" type="button" aria-label="Close Quori" title="Close">×</button>
      </header>
      <div class="quori-scroll">
        <section class="quori-welcome">
          <span class="quori-eyebrow">A clearer view.</span>
          <h3>What would you<br>like to explore?</h3>
          <p>I’m Quori. Let’s bring your site, its evidence, and its story into view.</p>
          <div class="quori-prompts">
            <button type="button" data-prompt="How does Quadrion bring my site data into one 3D workspace?">Explore the 3D workspace <span>${arrowIcon()}</span></button>
            <button type="button" data-prompt="How can I compare surveys and inspection findings over time?">See what changed <span>${arrowIcon()}</span></button>
            <button type="button" data-prompt="How does Quadrion work offline, and what happens when I use AI?">Understand the offline workflow <span>${arrowIcon()}</span></button>
          </div>
          <a class="quori-contact" href="https://www.synapse-solutions.ai/#contact">Talk to the team <span>${arrowIcon()}</span></a>
        </section>
        <div class="quori-messages" role="log" aria-label="Conversation with Quori" aria-live="polite" aria-relevant="additions text"></div>
        <p class="quori-thinking" role="status" hidden>Quori is thinking<span aria-hidden="true">…</span></p>
        <div class="quori-notice" role="alert" hidden><p></p><button type="button">Try again</button></div>
      </div>
      <footer class="quori-panel__footer">
        <div class="quori-toolbar"><span class="quori-mode"></span><button class="quori-reset" type="button" hidden>New conversation</button></div>
        <form class="quori-form">
          <label class="quori-sr-only" for="${id}-input">Ask Quori</label>
          <textarea id="${id}-input" name="message" rows="1" maxlength="1200" placeholder="Ask Quori…" required></textarea>
          <button type="submit" aria-label="Send message" disabled>${arrowIcon('up')}</button>
        </form>
        <p class="quori-disclosure"></p>
      </footer>
    </dialog>`;
  shadow.append(style,shell); container.append(host);
  const $ = selector => shadow.querySelector(selector);
  const launcher = $('.quori-launcher'), panel = $('.quori-panel'), input = $('textarea'), form = $('form'), send = form.querySelector('button');
  const welcome = $('.quori-welcome'), messages = $('.quori-messages'), scroll = $('.quori-scroll'), thinking = $('.quori-thinking'), notice = $('.quori-notice'), reset = $('.quori-reset');
  const motionToggle = $('.quori-motion-toggle'), media = matchMedia('(max-width: 620px)'), reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let destroyed = false, opened = false, busy = false, motionEnabled = !!motion, motionAllowed = options.motionAllowed !== false, generation = 0, controller, timeout, headerAvatar, lastFocus, history = [], pending;
  let replyTimer,noticeAction='connect',locked = false, previousOverflow, previousPriority, connected = !transport, connecting = false, contactBusy = false, callbacks = false;
  const cleanup = [];
  const on = (target,event,fn) => { target.addEventListener(event,fn); cleanup.push(()=>target.removeEventListener(event,fn)); };
  const avatarOptions = {compact:true,interactive:false};
  const launcherAvatar = createQuori($('.quori-launcher__avatar'),{...avatarOptions,playful:true,interactive:false});
  let launcherHovered = false, launcherFocused = false;
  const holdLauncher = () => launcherAvatar.setState(launcherHovered || launcherFocused?'curious':'idle');
  on(launcher,'pointerenter',event=>{if(event.pointerType !== 'touch'){launcherHovered=true;holdLauncher();}});
  on(launcher,'pointerleave',()=>{launcherHovered=false;holdLauncher();});
  on(launcher,'focus',()=>{launcherFocused=true;holdLauncher();});
  on(launcher,'blur',()=>{launcherFocused=false;holdLauncher();});
  const live = typeof respond === 'function';
  $('.quori-mode').textContent = live ? 'AI assistant' : 'Local service guide';
  $('.quori-disclosure').textContent = live
    ? (options.disclosure || 'AI can make mistakes. Messages are sent to the configured service.')
    : 'Prepared guidance. Messages stay in this page and are not sent.';
  const mapped = href => { try { return safeLink(resolveHref(href)); } catch { return null; } };
  $('.quori-contact').href = mapped(safeLink(routes.contact) || 'https://www.synapse-solutions.ai/#contact') || 'https://www.synapse-solutions.ai/#contact';
  const contact=transport?createContactFlow({scroller:scroll,request:transport.request,setBusy(value){contactBusy=value;syncControls();},onChange(){syncControls();}}):null;
  const contactButton=document.createElement('button');contactButton.type='button';contactButton.className='quori-reset';contactButton.textContent='Contact the team';contactButton.hidden=true;$('.quori-toolbar').append(contactButton);
  on(contactButton,'click',()=>{if(!busy)contact?.open();});
  on($('.quori-contact'),'click',e=>{if(callbacks&&connected){e.preventDefault();e.stopPropagation();contact.open();}});
  function connectionNotice(text,action='connect'){noticeAction=action;notice.querySelector('p').textContent=text;notice.querySelector('button').textContent=action==='connect'?'Reconnect':action==='reset'?'New conversation':'Try again';notice.hidden=false;}
  async function connect(){
    if(!transport||connecting||destroyed)return;
    connecting=true;connected=false;$('.quori-mode').textContent='Connecting…';syncControls();
    const turn=++generation;
    try{
      const status=await transport.connect();if(destroyed||turn!==generation)return;
      connected=status.mode==='live';callbacks=connected&&status.callbacks_enabled===true;contact.setReady(callbacks);
      $('.quori-mode').textContent=connected?'AI assistant':'Not connected';
      $('.quori-disclosure').textContent=connected?'Messages are processed by OpenAI. AI can make mistakes. Contact details are shared only after you review and send.':'AI chat is not connected yet. Contact the team through the website.';
      if(status.test_mode){$('.quori-mode').textContent='Local test';$('.quori-disclosure').textContent='Simulated replies and receipts. No messages are sent to OpenAI or Grokbot.';}
      if(connected){
        const previousPending=pending;
        history=[];messages.replaceChildren();pending=null;notice.hidden=true;
        for(const item of (status.history||[]).slice(-24))if(['user','assistant'].includes(item.role)&&typeof item.content==='string'){
          const answer=normalizeAnswer({reply:item.content,links:item.links});const article=append(item.role,answer.reply,answer.links);decorate(article,item);history.push({role:item.role,content:item.content});
        }
        if(previousPending&&status.last_request_id!==previousPending.requestId){
          pending=previousPending;append('user',pending.message);history.push({role:'user',content:pending.message});
          connectionNotice('Your last message is ready to retry.','retry');
        }
        welcome.hidden=history.length>0;contact.restore(status.callback_receipt);
      }else connectionNotice('Quori’s AI connection is being prepared. You can still reach Quadrion through the contact page.');
    }catch{if(!destroyed){$('.quori-mode').textContent='Unavailable';connectionNotice('Quori could not connect. Try reconnecting or contact the team directly.');}}
    finally{connecting=false;if(!destroyed)syncControls();}
  }
  function decorate(article,answer){
    if(!transport)return;
    for(const id of [...new Set(Array.isArray(answer.source_ids)?answer.source_ids:[])].slice(0,3)){
      const source=technicalSources[id];if(!source||[...article.querySelectorAll('a')].some(a=>a.getAttribute('href')===source[1]))continue;const a=document.createElement('a');a.textContent=source[0]+' ';a.insertAdjacentHTML('beforeend',arrowIcon());a.href=source[1];a.target='_blank';a.rel='noopener noreferrer';a.className='quori-source';article.append(a);
    }
    if(callbacks)contact.offer(answer.contact_request,article);
  }

  function syncMotion() {
    const {active,locked,reason} = resolveQuoriMotion({enabled:motionEnabled,allowed:motionAllowed,reduced:reduced.matches});
    const paused = !active;
    launcherAvatar.setMotion(active); headerAvatar?.setMotion(active);
    motionToggle.textContent = paused ? '▷' : 'Ⅱ';
    motionToggle.setAttribute('aria-pressed',String(paused));
    motionToggle.setAttribute('aria-label',reason === 'device' ? 'Animation paused by reduced-motion preference' : reason === 'page' ? 'Animation paused by page motion setting' : paused ? 'Play Quori animation' : 'Pause Quori animation');
    motionToggle.title = reason === 'device' ? 'Your device prefers reduced motion' : reason === 'page' ? 'Resume motion using the page motion control' : paused ? 'Play animation' : 'Pause animation';
    motionToggle.disabled = locked;
  }
  function lockBody(value) {
    if (value && !locked) {
      previousOverflow = document.body.style.getPropertyValue('overflow'); previousPriority = document.body.style.getPropertyPriority('overflow');
      document.body.style.setProperty('overflow','hidden'); locked = true;
    } else if (!value && locked) {
      if (document.body.style.getPropertyValue('overflow') === 'hidden') {
        if (previousOverflow) document.body.style.setProperty('overflow',previousOverflow,previousPriority); else document.body.style.removeProperty('overflow');
      }
      locked = false;
    }
  }
  function showDialog() { if (media.matches) panel.showModal(); else panel.show(); lockBody(media.matches); }
  function open() {
    if (destroyed || opened) return;
    lastFocus = shadow.activeElement || document.activeElement; opened = true;
    showDialog(); launcher.hidden = true; launcher.setAttribute('aria-expanded','true'); launcherAvatar.setVisible(false);
    headerAvatar ||= createQuori($('.quori-panel__avatar'),avatarOptions);
    syncMotion(); headerAvatar.setVisible(true); headerAvatar.setState(busy?'thinking':'curious'); headerAvatar.play('hello');
    $('.quori-close').focus({preventScroll:true});
    if(transport&&!connected)connect();
  }
  function close() {
    if (!opened) return;
    opened = false; panel.close(); lockBody(false); launcher.hidden = false; launcher.setAttribute('aria-expanded','false');
    launcherAvatar.setVisible(true); headerAvatar?.setVisible(false);
    const focus = lastFocus?.isConnected && lastFocus !== host ? lastFocus : launcher; focus.focus?.({preventScroll:true});
  }
  function syncControls() {
    const contactOpen=!!contact?.visible;messages.hidden=contactOpen;welcome.hidden=contactOpen||history.length>0;form.hidden=contactOpen;
    // Chat, reset and contact all share the same session. Any expired request
    // must expose recovery, not leave the widget apparently connected.
    if(transport&&connected&&!transport.ready){
      connected=false;callbacks=false;contact.setReady(false);
      $('.quori-mode').textContent='Session expired';
      connectionNotice('Your session expired. Reconnect to continue. If an enquiry’s delivery was uncertain, contact the team before submitting it again.');
    }
    const blocked=busy||connecting||contactBusy||!connected;
    send.disabled = blocked || !input.value.trim(); input.readOnly = blocked;
    shadow.querySelectorAll('[data-prompt]').forEach(b=>{ b.disabled = blocked; });
    reset.hidden = history.length === 0;reset.disabled=!!transport&&blocked;thinking.hidden = !busy;
    contactButton.hidden=!callbacks;contactButton.disabled=blocked;
    panel.setAttribute('aria-busy',String(busy||connecting||contactBusy));
  }
  function append(role, text, links = []) {
    const article = document.createElement('article'); article.className = 'quori-message'+(role === 'user' ? ' is-user' : ''); article.setAttribute('aria-label',role === 'user' ? 'You' : 'Quori'); article.dir = 'auto';
    const p = document.createElement('p'); p.textContent = text; article.append(p);
    for (const link of links) {
      const href = mapped(link.href); if (!href) continue;
      const a = document.createElement('a'); a.href = href; a.textContent = link.label+' ';a.insertAdjacentHTML('beforeend',arrowIcon());
      if(href.startsWith('https:')){a.target='_blank';a.rel='noopener noreferrer';}article.append(a);
    }
    messages.append(article);
    while (messages.children.length > 80) messages.firstElementChild.remove();
    scroll.scrollTop = scroll.scrollHeight;
    return article;
  }
  function cancelPending() { generation++; clearTimeout(timeout); controller?.abort(); controller = null; busy = false; }
  async function resetConversation() {
    if (destroyed) return;
    if(transport){
      if(busy||connecting||contactBusy)return;
      busy=true;syncControls();
      try{await transport.reset();}catch(error){connectionNotice(error.message,transport.ready?'reset':'connect');return;}finally{busy=false;syncControls();}
      if(destroyed)return;contact.reset();
    }
    cancelPending(); history = []; pending = null; messages.replaceChildren(); notice.hidden = true; welcome.hidden = false; input.value = ''; syncControls(); headerAvatar?.setState('idle');
    if (opened) input.focus({preventScroll:true});
  }
  async function submit(value, retry = false) {
    const message = [...String(value).trim()].slice(0,1200).join('');
    if (destroyed || busy || connecting || contactBusy || !connected || !message) return;
    if (!retry || !pending || pending.message !== message) {
      pending = {message,requestId:crypto.randomUUID()};
      append('user',message); history.push({role:'user',content:message}); history = history.slice(-24);
    }
    const request = pending, token = ++generation; controller = new AbortController(); const {signal} = controller;
    busy = true; notice.hidden = true; welcome.hidden = true; input.value = ''; syncControls(); headerAvatar?.setState('thinking'); scroll.scrollTop = scroll.scrollHeight;
    // Keep keyboard focus at submission time; never take it back on async completion.
    if (opened && panel.contains(shadow.activeElement)) input.focus({preventScroll:true});
    try {
      const answer = await Promise.race([
        Promise.resolve().then(()=>live ? respond(message,{history:history.slice(0,-1).map(x=>({...x})),signal,requestId:request.requestId}) : Promise.reject(new Error('Quori is not connected yet.'))),
        new Promise((_,reject)=>{
          signal.addEventListener('abort',()=>reject(new DOMException('Cancelled','AbortError')),{once:true});
          timeout = setTimeout(()=>{ reject(new Error('timeout')); controller?.abort(); },Math.max(1000,Math.min(60000,Number(requestTimeout)||25000)));
        }),
      ]);
      if (destroyed || token !== generation) return;
      const normalized = normalizeAnswer(answer);
      const article=append('assistant',normalized.reply,normalized.links);decorate(article,answer); history.push({role:'assistant',content:normalized.reply}); history = history.slice(-24); pending = null;
      headerAvatar?.setState('speaking');clearTimeout(replyTimer);replyTimer=setTimeout(()=>headerAvatar?.setState('happy'),1800);
    } catch (error) {
      if (destroyed || token !== generation) return;
      notice.querySelector('p').textContent = error.message === 'timeout' ? 'That reply took too long. You can try again or contact the team.' : transport ? error.message : 'Quori couldn’t get a reply. Please try again or contact the team.';
      if(transport&&!transport.ready){connected=false;callbacks=false;contact.setReady(false);}
      noticeAction=!connected?'connect':error.status===409?'reset':'retry';
      notice.querySelector('button').textContent=noticeAction==='connect'?'Reconnect':noticeAction==='reset'?'New conversation':'Try again';
      notice.hidden = false; headerAvatar?.setState('concerned');
    } finally {
      if (token === generation && !destroyed) { clearTimeout(timeout); controller = null; busy = false; syncControls(); scroll.scrollTop = scroll.scrollHeight; }
    }
  }
  on(launcher,'click',open); on($('.quori-close'),'click',close);
  on(panel,'cancel',e=>{e.preventDefault();close();});
  on(document,'keydown',e=>{if(opened && e.key==='Escape'){e.preventDefault();close();}});
  on(media,'change',()=>{if(opened){const focused=shadow.activeElement;panel.close();showDialog();focused?.focus({preventScroll:true});}});
  on(motionToggle,'click',()=>{motionEnabled=!motionEnabled;syncMotion();});
  on(reduced,'change',syncMotion);
  on(form,'submit',e=>{e.preventDefault();submit(input.value);});
  on(input,'keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();submit(input.value);}});
  on(input,'input',syncControls);
  on(input,'focus',()=>{if(!busy)headerAvatar?.setState('listening');});
  on(input,'blur',()=>{if(!busy)headerAvatar?.setState('idle');});
  on(reset,'click',resetConversation);
  on(notice.querySelector('button'),'click',()=>{if(noticeAction==='reset')resetConversation();else if(noticeAction==='retry'&&pending)submit(pending.message,true);else connect();});
  on(shell,'click',e=>{
    const button=e.target.closest('[data-prompt]'); if(button)submit(button.dataset.prompt);
    if(e.target.closest('a'))close();
  });
  syncMotion(); syncControls();
  return {
    element:host, open, close, reset:resetConversation,
    setMotion(value){if(destroyed)return;motionEnabled=!!value;syncMotion();},
    setMotionAllowed(value){if(destroyed)return;motionAllowed=!!value;syncMotion();},
    setCharacterState(value){launcherAvatar.setState(value);if(!busy)headerAvatar?.setState(value);},
    play(value){launcherAvatar.play(value);if(!busy)headerAvatar?.play(value);},
    setVisible(value){host.hidden=!value;launcherAvatar.setVisible(value&&!opened);headerAvatar?.setVisible(value&&opened);},
    getStatus(){return {open:opened,busy,mode:live?'assistant':'guide',messages:history.length,destroyed};},
    destroy(){if(destroyed)return;close();cancelPending();destroyed=true;clearTimeout(replyTimer);cleanup.forEach(fn=>fn());launcherAvatar.destroy();headerAvatar?.destroy();host.remove();history=[];pending=null;},
  };
}
