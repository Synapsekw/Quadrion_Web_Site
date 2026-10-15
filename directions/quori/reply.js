const external=new Set(['https://www.synapse-solutions.ai/#contact','https://www.synapse-solutions.ai/projects/quadrion-ai/','https://www.synapse-solutions.ai/']);
export function safeLink(value){
  if(typeof value!=='string'||/[\\\u0000-\u0020]/.test(value)||/%(?:5c|0[ad])/i.test(value))return null;
  if(external.has(value))return value;
  if(!value.startsWith('/')&&!value.startsWith('#')||value.startsWith('//'))return null;
  try{const url=new URL(value,'https://quori.invalid');return url.origin==='https://quori.invalid'?value:null;}catch{return null;}
}
export function normalizeAnswer(value){
  if(typeof value?.reply!=='string'||!value.reply.trim())throw new Error('Quori could not read that reply. Please try again.');
  const links=(Array.isArray(value.links)?value.links:[]).slice(0,5).flatMap(item=>{const href=safeLink(item?.href);return href&&typeof item.label==='string'?[{href,label:item.label.slice(0,100)}]:[];});
  return {reply:value.reply.trim().slice(0,12000),links};
}
export const technicalSources={S1:['About Quadrion','https://www.synapse-solutions.ai/projects/quadrion-ai/'],S2:['Offline workflow','/d3-quarter/#trust'],S3:['Synapse Solutions','https://www.synapse-solutions.ai/']};
export function resolveQuoriMotion({enabled,allowed,reduced}){return {active:enabled&&allowed&&!reduced,locked:!allowed||reduced,reason:reduced?'device':!allowed?'page':null};}
export function arrowIcon(direction){return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${direction==='up'?'M12 20V4m-7 7 7-7 7 7':'M5 19 19 5M5 5h14v14'}"/></svg>`;}
