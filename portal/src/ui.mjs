export function el(tag,attrs={},...children){
  const node=document.createElement(tag);
  for(const [key,value] of Object.entries(attrs)){
    if(key==='class')node.className=value;
    else if(key.startsWith('on'))node.addEventListener(key.slice(2).toLowerCase(),value);
    else if(key==='text')node.textContent=value;
    else if(value===true)node.setAttribute(key,'');
    else if(value!==false&&value!=null)node.setAttribute(key,String(value));
  }
  for(const child of children.flat(Infinity))if(child!=null)node.append(child instanceof Node?child:document.createTextNode(String(child)));
  return node;
}
export const button=(label,handler,secondary=false)=>el('button',{type:'button',class:secondary?'secondary':'primary',onclick:handler},label);
export const link=(label,href,cls='')=>el('a',{href,class:cls},label);
export function field(label,name,{type='text',value='',required=false,maxLength,autocomplete,help}={}){
  const input=el('input',{id:name,name,type,value,required,maxlength:maxLength,autocomplete});
  return {input,node:el('div',{class:'field'},el('label',{for:name},label),input,help?el('small',{},help):null)};
}
export function notice(text,kind='info'){return el('div',{class:'notice '+kind,role:kind==='error'?'alert':'status'},text);}
export function heading(eyebrow,title,description){return el('header',{class:'page-heading'},el('p',{class:'eyebrow'},eyebrow),el('h1',{tabindex:'-1'},title),description?el('p',{class:'lede'},description):null);}
export function empty(title,text,action){return el('section',{class:'empty'},el('span',{class:'empty-symbol','aria-hidden':'true'},'◇'),el('h2',{},title),el('p',{},text),action);}
export function bytes(value){const n=Number(value);if(!Number.isFinite(n))return '—';if(n>=1000**3)return (n/1000**3).toFixed(1)+' GB';return (n/1000**2).toFixed(1)+' MB';}
export function date(value){return value?new Intl.DateTimeFormat('en',{dateStyle:'medium'}).format(new Date(value)):'—';}
// Marks a button busy: disabled, aria-busy, and an optional label such as "Saving…". The returned function restores it.
export function busy(target,label){
  const kids=[...target.childNodes];target.disabled=true;target.setAttribute('aria-busy','true');if(label)target.textContent=label;
  let restored=false;
  return ()=>{if(restored)return;restored=true;target.disabled=false;target.removeAttribute('aria-busy');if(label)target.replaceChildren(...kids);};
}
export async function runButton(target,fn,label){const done=busy(target,label);try{await fn();}finally{done();}}
// A placeholder for the content area while its first data loads; screen readers hear one "Loading" status.
export function skeleton(rows=4){return el('div',{class:'skeleton',role:'status'},el('span',{class:'sr-only'},'Loading…'),el('span',{class:'sk sk-eyebrow','aria-hidden':'true'}),el('span',{class:'sk sk-title','aria-hidden':'true'}),Array.from({length:rows},()=>el('span',{class:'sk sk-line','aria-hidden':'true'})));}
