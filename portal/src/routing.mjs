export function loginDestination(role){
  if(role==='owner'||role==='admin')return '/admin/';
  return role==='member'?'/portal/':null;
}
