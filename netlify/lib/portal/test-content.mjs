import {fail} from './http.mjs';
const linePattern=/^[a-z][a-z0-9-]*(:[a-z0-9-]+)+:[0-9a-f]{10}(-[0-9]+)?$/;
const plainTag=/^<\/?(?:p|ul|ol|li|pre|b|i|code|h4|details|summary)>$/;
const linkOpen=/^<a href="https:\/\/[^"\s<>]+" target="_blank" rel="noreferrer">$/;
// Only the listed tags may appear; every other "<" (script, img, on* attributes, odd links) is refused.
function html(value){
  if(typeof value!=='string')fail('invalid');
  for(const tag of value.match(/<[^>]*>?/g)||[])if(!(plainTag.test(tag)||tag==='</a>'||linkOpen.test(tag)))fail('invalid');
  return value;
}
export function validateTestContent(model){
  if(!model||typeof model!=='object'||model.format!=='quadrion-test-content/1'||!Array.isArray(model.stages)||!model.stages.length)fail('invalid');
  const seen=new Set();
  for(const stage of model.stages){
    if(!stage||typeof stage!=='object'||!Array.isArray(stage.groups))fail('invalid');
    if(stage.intro!==undefined)html(stage.intro);
    for(const group of stage.groups){
      if(!group||typeof group!=='object'||!Array.isArray(group.items))fail('invalid');
      if(group.notes!==undefined)html(group.notes);
      for(const item of group.items){
        if(!item||typeof item!=='object'||typeof item.id!=='string'||item.id.length>200||!linePattern.test(item.id)||seen.has(item.id))fail('invalid');
        seen.add(item.id);html(item.html);
        if(item.sub!==undefined){if(!Array.isArray(item.sub))fail('invalid');item.sub.forEach(html);}
        if(item.plain!==undefined&&typeof item.plain!=='string')fail('invalid');
        if(item.subPlain!==undefined&&(!Array.isArray(item.subPlain)||item.subPlain.some(s=>typeof s!=='string')))fail('invalid');
      }
    }
  }
  if(model.guide!==undefined){if(!Array.isArray(model.guide))fail('invalid');for(const g of model.guide){if(!g||typeof g!=='object')fail('invalid');html(g.html);}}
  if(!seen.size)fail('invalid');
  return {lines:seen.size};
}
