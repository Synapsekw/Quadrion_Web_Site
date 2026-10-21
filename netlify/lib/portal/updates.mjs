import semver from 'semver';
import {fail,keys,uuid} from './http.mjs';
const stable=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export const stableVersion=value=>typeof value==='string'&&value.length<=48&&stable.test(value)&&semver.valid(value)===value;
export function boundedAppRange(value){
  if(typeof value!=='string'||value.length>100)return false;
  const match=/^>=(\S+) <(\S+)$/.exec(value);
  return !!match&&stableVersion(match[1])&&stableVersion(match[2])&&semver.lt(match[1],match[2]);
}
export function validateReleaseMetadata(data){
  if(data.autoUpdateEnabled!==undefined&&typeof data.autoUpdateEnabled!=='boolean')fail('invalid');
  if(data.architecture!=null&&data.architecture!=='x64')fail('invalid');
  if(data.packageFormat!=null&&data.packageFormat!==(data.kind==='app'?'nsis':'tar.gz'))fail('invalid');
  if(data.appRange!=null&&(data.kind!=='pipeline'||!boundedAppRange(data.appRange)))fail('invalid');
  if(data.pipelineReleaseId!=null){if(data.kind!=='app')fail('invalid');uuid(data.pipelineReleaseId);}
  if(data.autoUpdateEnabled&&(!stableVersion(data.version)||data.platform!=='windows'||data.architecture!=='x64'||data.packageFormat!==(data.kind==='app'?'nsis':'tar.gz')||(data.kind==='app'?!data.pipelineReleaseId:!boundedAppRange(data.appRange))))fail('invalid');
}
export function updateQuery(params){
  keys(Object.fromEntries(params),['action','platform','appVersion','pipelineVersion']);
  for(const key of params.keys())if(params.getAll(key).length!==1)fail('invalid');
  const appVersion=params.get('appVersion'),pipelineVersion=params.get('pipelineVersion');
  if(params.get('platform')!=='win-x64'||!stableVersion(appVersion)||(pipelineVersion!==null&&!stableVersion(pipelineVersion)))fail('invalid');
  return {appVersion,pipelineVersion};
}
const dto=c=>({releaseId:c.releaseId,artifactId:c.artifactId,version:c.version,platform:'win-x64',filename:c.filename,bytes:Number(c.bytes),sha256:c.sha256,notes:c.notes,...(c.kind==='pipeline'?{appRange:c.appRange}:{})});
function validCandidate(c){
  if(!c||!['app','pipeline'].includes(c.kind)||c.platform!=='win-x64'||!stableVersion(c.version)
    ||typeof c.filename!=='string'||c.filename.length>200||!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(c.filename)
    ||!(c.kind==='app'?/\.exe$/i:/\.tar\.gz$/i).test(c.filename)
    ||!Number.isSafeInteger(c.bytes)||c.bytes<=0||typeof c.sha256!=='string'||!/^[a-f0-9]{64}$/.test(c.sha256)
    ||typeof c.notes!=='string'||c.notes.length>16000||(c.kind==='pipeline'&&!boundedAppRange(c.appRange)))return false;
  try{uuid(c.releaseId);uuid(c.artifactId);if(c.kind==='app')uuid(c.pipelineReleaseId);return true;}catch{return false;}
}
export function selectUpdates(candidates,{appVersion,pipelineVersion}){
  if(!Array.isArray(candidates))fail('unavailable');
  candidates=candidates.filter(validCandidate);
  const kits=candidates.filter(c=>c.kind==='pipeline').sort((a,b)=>semver.rcompare(a.version,b.version));
  const apps=candidates.filter(c=>c.kind==='app'&&semver.gt(c.version,appVersion)).sort((a,b)=>semver.rcompare(a.version,b.version));
  let selectedApp=null,selectedKit=null;
  for(const app of apps){
    const baseline=kits.find(k=>k.releaseId===app.pipelineReleaseId&&semver.satisfies(app.version,k.appRange));
    if(!baseline)continue;
    const kit=kits.find(k=>semver.gte(k.version,baseline.version)&&semver.satisfies(app.version,k.appRange));
    if(kit){selectedApp=app;selectedKit=kit;break;}
  }
  if(!selectedApp)selectedKit=kits.find(k=>semver.satisfies(appVersion,k.appRange)&&(!pipelineVersion||semver.gt(k.version,pipelineVersion)))||null;
  return {schema:'quadrion.updates/1',targetAppVersion:selectedApp?.version||appVersion,app:selectedApp?dto(selectedApp):null,pipeline:selectedKit&&selectedKit.version!==pipelineVersion?dto(selectedKit):null};
}
