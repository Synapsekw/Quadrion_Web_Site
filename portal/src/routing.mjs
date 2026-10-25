// Deep links that survive sign-in for every role: the app's report form and the tester page. Nothing else from the address is honoured.
const deepLink=/^\/portal\/(?:report(?:[/?]|$)|tests\/)/;
export function loginDestination(role,path=''){
  const home=role==='owner'||role==='admin'?'/admin/':role==='member'?'/portal/':null;
  if(home&&typeof path==='string'&&deepLink.test(path)&&!/[\\\s]/.test(path))return path;
  return home;
}
