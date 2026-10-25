// Builds the "Copy for AI" text. Every piece of tester text sits inside a fenced block whose fence is
// longer than any backtick run in it, so the text can never close the fence or start a heading.
const fence=text=>{const longest=Math.max(0,...(String(text).match(/`+/g)||[]).map(run=>run.length));const mark='`'.repeat(Math.max(3,longest+1));return mark+'\n'+String(text).replace(/\s+$/,'')+'\n'+mark;};
const oneLine=value=>String(value??'').replace(/[\u0000-\u001f\u007f\s]+/g,' ').trim();
const stripHtml=value=>oneLine(String(value).replace(/<[^>]*>/g,' ').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&'));
const label=value=>oneLine(value).replace(/[`\[\]()<>]/g,'')||'file';
export async function formatForAgent(items,{origin='',now=Date.now(),link}={}){
  const list=Array.isArray(items)?items:[];
  const out=[`# Quadrion open bugs (${list.length})`,'',`Exported ${new Date(now).toISOString().slice(0,10)}. Inbox: ${origin}/admin/feedback/`,'','Report back by item number, for example: "#12 fixed in 0.26.0".'];
  if(!list.length)return out.concat(['','No open bugs in this filter.']).join('\n')+'\n';
  for(const item of list){
    const lineInfo=item.line&&typeof item.line==='object'?item.line:item;
    const build=oneLine(item.build??item.buildSeen??item.build_seen);
    out.push('',`## #${item.number} ${oneLine(item.title)||'(no title)'}`,'',`Priority: ${oneLine(item.priority)||'normal'}`,`Build: ${!build||build==='unknown'?'not recorded':build}`,'Reported by: tester');
    const plain=oneLine(lineInfo.plain);
    if(plain){
      out.push('',`Test line: ${plain}`);
      const sub=Array.isArray(lineInfo.subPlain)?lineInfo.subPlain:Array.isArray(lineInfo.sub)?lineInfo.sub.map(stripHtml):[];
      for(const step of sub.map(oneLine).filter(Boolean))out.push(`- ${step}`);
    }
    if(item.body)out.push('','What the tester saw:','',fence(item.body));
    const thread=(Array.isArray(item.thread)?item.thread:[]).filter(event=>event&&typeof event.body==='string'&&event.body.trim());
    if(thread.length){
      out.push('','Thread:');
      for(const event of thread)out.push('',`${event.role==='quadrion'?'quadrion':'tester'}:`,'',fence(event.body));
    }
    const files=Array.isArray(item.attachments)?item.attachments:[];
    if(files.length){
      out.push('','Attachments:');
      for(const file of files){
        let url;try{url=await link(file);}catch{url=null;}
        out.push(`- ${label(file.filename)}${file.mime_type?` (${label(file.mime_type)})`:''}: ${url||'link unavailable'}`);
      }
    }
  }
  return out.join('\n')+'\n';
}
