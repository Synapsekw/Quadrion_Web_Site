import test from 'node:test';
import assert from 'node:assert/strict';
import {formatForAgent} from '../netlify/lib/portal/feedback-export.mjs';
const now=Date.parse('2026-10-25T10:00:00Z'),origin='https://quadrion.ai';
const link=async file=>`https://files.example.com/${file.id}`;
const item=(number,over={})=>({number,title:`Problem ${number}`,priority:'normal',build:'0.26.0',body:'It breaks.',line:{plain:'Open the sample project and switch to Map',sub:['<code>Zoom</code> twice']},thread:[],attachments:[],...over});

test('formatForAgent fences tester text and handles an empty list',async()=>{
  const nasty='Steps:\n```js\nboom()\n```\n## #99 Fake heading\n';
  const text=await formatForAgent([item(12,{body:nasty,thread:[{kind:'comment',body:'also ```` here\n# #98',role:'tester'}]})],{origin,now,link});
  const lines=text.split('\n');
  assert.equal(lines[0],'# Quadrion open bugs (1)');
  assert.ok(lines.includes('Report back by item number, for example: "#12 fixed in 0.26.0".'));
  const open=lines.indexOf('````');
  assert.ok(open>0);
  const close=lines.indexOf('````',open+1);
  assert.ok(lines.slice(open+1,close).includes('## #99 Fake heading'), 'the body stays inside a four-backtick fence');
  assert.ok(lines.includes('`````'), 'a run of four backticks gets a five-backtick fence');
  // The only headings outside a fence are the document title and the item's own.
  let inside='';const headings=[];
  for(const line of lines){const m=/^(`{3,})$/.exec(line);if(m){inside=inside?(inside===m[1]?'':inside):m[1];continue;}if(!inside&&/^#/.test(line))headings.push(line);}
  assert.deepEqual(headings,['# Quadrion open bugs (1)','## #12 Problem 12']);
  const none=await formatForAgent([],{origin,now,link});
  assert.match(none,/^# Quadrion open bugs \(0\)\n/);
  assert.match(none,/Report back by item number/);
  assert.match(none,/No open bugs in this filter\.\n$/);
});
test('lists items in the given order with role labels only',async()=>{
  const second=item(3,{priority:'high',build:'unknown',thread:[{kind:'comment',body:'More detail',role:'tester'},{kind:'question',body:'Which report?',role:'quadrion'},{kind:'status',body:'',role:'quadrion'}],
    attachments:[{id:'a1',filename:'shot [1].png',mime_type:'image/png'}]});
  const text=await formatForAgent([item(7),second],{origin,now,link:async f=>`https://files.example.com/${f.id}`});
  assert.ok(text.indexOf('## #7 Problem 7')<text.indexOf('## #3 Problem 3'));
  assert.match(text,/Priority: high/);
  assert.match(text,/Build: not recorded/);
  assert.match(text,/Reported by: tester/);
  assert.match(text,/Test line: Open the sample project and switch to Map\n- Zoom twice/);
  assert.match(text,/What the tester saw:/);
  assert.match(text,/\ntester:\n\n```\nMore detail\n```/);
  assert.match(text,/\nquadrion:\n\n```\nWhich report\?\n```/);
  assert.match(text,/- shot 1.png \(image\/png\): https:\/\/files\.example\.com\/a1/);
  assert.equal((text.match(/\nquadrion:\n/g)||[]).length,1, 'events without text are left out');
  assert.equal(/@|reporter_id|email/i.test(text.replace(/Reported by: tester/g,'')),false);
  const broken=await formatForAgent([second],{origin,now,link:async()=>{throw new Error('no');}});
  assert.match(broken,/link unavailable/);
});
