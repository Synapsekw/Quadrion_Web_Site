const validUntil = (value, now) => value === null || (typeof value === 'string' && Number.isFinite(Date.parse(value)) && Date.parse(value) > now);
export function activeMember(member, now) {
  return !!member && Number.isFinite(now) && typeof member.userId === 'string' && !!member.userId
    && member.status === 'active' && validUntil(member.expiresAt, now)
    && (member.role === 'member' ? Number.isInteger(member.tier) && member.tier >= 1 && member.tier <= 3
      : ['admin','owner'].includes(member.role) && member.tier === null);
}
export function canAdminister({ member, aal, now }) {
  return activeMember(member,now) && ['admin','owner'].includes(member.role) && aal === 'aal2';
}
export function canReadSoftware({ member, aal, status, verified, now }) {
  return status === 'published' && verified === true && activeMember(member,now)
    && (member.role === 'member' || canAdminister({member,aal,now}));
}
export function canReadProject({ member, project, assignment, aal, now }) {
  if (!activeMember(member,now) || !project || project.status !== 'published' || !project.currentVersionId
      || !['basic','oil_gas','restricted'].includes(project.category)
      || ![2,3].includes(project.minimumTier) || (project.category !== 'basic' && project.minimumTier !== 3)
      || !['tier','assigned'].includes(project.audience)) return false;
  if (canAdminister({member,aal,now})) return true;
  if (member.role !== 'member' || member.tier < project.minimumTier) return false;
  return project.audience === 'tier' || !!assignment && assignment.userId === member.userId
    && assignment.projectId === project.id && validUntil(assignment.expiresAt,now);
}
