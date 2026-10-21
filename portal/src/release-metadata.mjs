import semver from 'semver';

// Selection assistance only; the server and database independently enforce the
// same publication rules. Never infer automatic eligibility from old releases.
export function compatibleBaselines(releases,appVersion){
  if(typeof appVersion!=='string'||!/^\d+\.\d+\.\d+$/.test(appVersion)||semver.valid(appVersion)!==appVersion)return [];
  return releases.filter(r=>r.kind==='pipeline'&&r.status==='published'&&r.auto_update_enabled===true
    &&r.platform==='windows'&&r.architecture==='x64'&&r.package_format==='tar.gz'&&semver.valid(r.version)
    &&typeof r.app_range==='string'&&/^>=\S+ <\S+$/.test(r.app_range)&&semver.validRange(r.app_range)&&semver.satisfies(appVersion,r.app_range)
    &&r.files?.some(f=>f.state==='verified'&&/^[A-Za-z0-9][A-Za-z0-9._-]*\.tar\.gz$/i.test(f.filename)))
    .sort((a,b)=>semver.rcompare(a.version,b.version));
}
