// Confirmed contact requests. Visitor input is rendered as text, never HTML.
export function createContactFlow({scroller,request,setBusy,onChange}){
  const section=document.createElement('section');section.className='quori-contact';section.hidden=true;
  section.setAttribute('aria-label','Contact request');scroller.append(section);
  let ready=false,working=false,unresolved=false,requestId='',reviewed=null,receipt=null;
  const fields=[['name','Your name',100,'name'],['phone','Phone with country code',40,'tel'],['email','Email',254,'email'],['reason','What would you like to discuss?',1000,'off'],['company','Company',120,'organization'],['preferred_time','Preferred time',160,'off'],['timezone','Time zone',80,'off']];
  function el(tag,text,className){const node=document.createElement(tag);if(text)node.textContent=text;if(className)node.className=className;return node;}
  function button(text,action,className='quori-contact-secondary'){const b=el('button',text,className);b.type='button';b.addEventListener('click',action);return b;}
  function heading(title,description){section.replaceChildren();section.hidden=false;const h=el('h3',title);h.tabIndex=-1;section.append(h);if(description)section.append(el('p',description,'quori-contact-intro'));return h;}
  function reveal(focus){onChange();section.scrollIntoView({block:'start',behavior:'instant'});focus?.focus({preventScroll:true});}
  function hide(){if(working)return;section.hidden=true;onChange();}
  function open(draft={}){
    if(!ready||working)return;
    if(receipt?.delivery==='unknown'){showReceipt(receipt);return;}
    // A lost response may have followed successful delivery. Keep the original
    // reviewed details and ID until its receipt has been checked.
    if(unresolved){section.hidden=false;reveal(section.querySelector('h3'));return;}
    requestId='';reviewed=null;receipt=null;
    heading('Let’s connect.','Add your details, then review everything before it is sent.');
    const form=el('form');form.className='quori-contact-form';
    const optional=el('details');optional.append(el('summary','Company & preferred time (optional)'));
    for(const [key,label,max,autocomplete] of fields){
      const wrap=el('div',null,'quori-contact-field'),lab=el('label',label);const id='quori-contact-'+key;lab.htmlFor=id;
      const field=el(key==='reason'?'textarea':'input');field.id=id;field.name=key;field.maxLength=max;field.autocomplete=autocomplete;field.dir='auto';
      if(key==='reason')field.rows=3;
      else field.type=key==='email'?'email':key==='phone'?'tel':'text';
      field.value=typeof draft?.[key]==='string'?draft[key].slice(0,max):'';
      if(['name','reason'].includes(key))field.required=true;
      if(key==='phone')field.placeholder='+965 …';
      if(key==='preferred_time')field.placeholder='For example, weekday afternoons';
      if(key==='timezone')field.placeholder='For example, Kuwait (UTC+3)';
      wrap.append(lab,field);(['company','preferred_time','timezone'].includes(key)?optional:form).append(wrap);
      if(key==='email')form.append(el('p','Add a phone number, email, or both.','quori-contact-note'));
    }
    form.append(optional);
    const error=el('p',null,'quori-contact-error');error.setAttribute('role','alert');error.hidden=true;form.append(error);
    const actions=el('div',null,'quori-contact-actions'),review=el('button','Review request','quori-contact-primary');review.type='submit';actions.append(review,button('Back to chat',hide));form.append(actions);section.append(form);
    form.addEventListener('submit',e=>{
      e.preventDefault();const data=Object.fromEntries(new FormData(form));for(const key of Object.keys(data))data[key]=data[key].trim();
      if(!data.phone&&!data.email){error.textContent='Add a phone number or email so we can reach you.';error.hidden=false;form.elements.phone.focus();return;}
      if(data.phone&&!/^\+[1-9][0-9]{6,14}$/.test(data.phone.replace(/[\s().-]/g,''))){error.textContent='Include your country code, for example +965 5555 0100.';error.hidden=false;form.elements.phone.focus();return;}
      if(!data.name||!data.reason){error.textContent='Add your name and what you would like to discuss.';error.hidden=false;return;}
      reviewed=data;requestId=crypto.randomUUID();showReview();
    });
    reveal(form.elements.name);
  }
  function showReview(){
    const h=heading('Everything look right?','Only the details below will be shared with the Quadrion team through its private assistant.');
    const list=el('dl',null,'quori-contact-review');
    for(const [key,label] of fields)if(reviewed[key]){list.append(el('dt',label),el('dd',reviewed[key]));}section.append(list);
    const consent=el('label',null,'quori-contact-consent'),check=el('input');check.type='checkbox';consent.append(check,el('span','Send these details to Quadrion so the team can contact me.'));section.append(consent);
    section.append(el('p','Your preferred time is a request, not a confirmed booking.','quori-contact-note'));
    const feedback=el('p',null,'quori-contact-error');feedback.setAttribute('role','alert');feedback.hidden=true;section.append(feedback);
    const actions=el('div',null,'quori-contact-actions'),send=button('Confirm & send',async()=>{
      if(!check.checked||working||!ready)return;
      working=true;unresolved=true;setBusy(true);send.disabled=true;edit.disabled=true;check.disabled=true;send.textContent='Sending…';feedback.hidden=true;let canEdit=true;
      try{
        const result=await request('callback',{request_id:requestId,confirmed:true,lead:reviewed,page:location.pathname+location.hash});
        if(!['accepted','failed','unknown'].includes(result.delivery))throw new Error('Could not confirm delivery. Try again to check this same request.');
        receipt=result;unresolved=false;
        if(result.delivery==='failed'){feedback.textContent=result.reply;feedback.hidden=false;send.textContent='Retry sending';}
        else showReceipt(result);
      }catch(error){canEdit=false;feedback.textContent=error.message;feedback.hidden=false;send.textContent='Check / retry request';}
      finally{working=false;setBusy(false);check.disabled=false;send.disabled=!check.checked||!ready;edit.disabled=!canEdit;}
    },'quori-contact-primary'),edit=button('Edit details',()=>open(reviewed));
    send.disabled=true;check.addEventListener('change',()=>send.disabled=!check.checked||!ready||working);actions.append(send,edit);section.append(actions);reveal(h);
  }
  function showReceipt(result){
    receipt=result;const h=heading(result.delivery==='accepted'?'Request submitted.':'Delivery not confirmed.',result.reply);
    section.append(el('p','Reference: '+result.reference,'quori-contact-reference'),button('Back to chat',hide));reveal(h);
  }
  return {
    open,
    offer(draft,article){if(!draft)return;article.append(button('Review contact details',()=>open(draft)));},
    setReady(value){ready=value;},
    restore(result){unresolved=false;requestId='';reviewed=null;receipt=result;section.hidden=true;section.replaceChildren();if(result&&['accepted','unknown'].includes(result.delivery))showReceipt(result);else onChange();},
    reset(){receipt=null;unresolved=false;requestId='';reviewed=null;section.hidden=true;section.replaceChildren();onChange();},
    get visible(){return !section.hidden;}
  };
}
