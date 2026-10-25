// Deep links that survive sign-in for every role: the app's report form and the tester page. Nothing else from the address is honoured.
const deepLink=/^\/portal\/(?:report(?:[/?]|$)|tests\/)/;
export function loginDestination(role,path=''){
  const home=role==='owner'||role==='admin'?'/admin/':role==='member'?'/portal/':null;
  if(home&&typeof path==='string'&&deepLink.test(path)&&!/[\\\s]/.test(path))return path;
  return home;
}
// Owners and admins always have tester access; members need the Tester tick. The server checks the same rule.
export function canTest(member){
  return !!member&&(member.tester===true||member.role==='owner'||member.role==='admin');
}
