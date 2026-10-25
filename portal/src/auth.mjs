import {createClient} from '@supabase/supabase-js';
import {el,field,button,link,notice,busy} from './ui.mjs';
import {loginDestination} from './routing.mjs';
export function clearSessionData(storage){for(const key of Object.keys(storage))if(key==='quadrion-auth'||key==='quadrion-password-setup'||key==='quadrion-me'||key.startsWith('quadrion-upload:'))storage.removeItem(key);}
export async function createPortalAuth({root,onChange}){
  const workspaceHome=location.pathname.startsWith('/admin/')?'/admin/':'/portal/';
  let chooseHome=new URLSearchParams(location.search).has('login');
  const response=await fetch('/api/portal?action=config',{cache:'no-store',credentials:'omit'});
  if(!response.ok)throw new Error('Portal access is being prepared. Please contact info@synapse-solutions.ai if you need access.');
  const config=await response.json();
  const params=new URLSearchParams(location.hash.slice(1));
  if(['invite','recovery'].includes(params.get('type')))sessionStorage.setItem('quadrion-password-setup','true');
  const callbackError=params.get('error_description');
  if(callbackError)history.replaceState(null,'',workspaceHome);
  const client=createClient(config.url,config.publishableKey,{auth:{storage:sessionStorage,storageKey:'quadrion-auth',persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,flowType:'implicit'}});
  client.auth.onAuthStateChange(event=>{if(event==='PASSWORD_RECOVERY')sessionStorage.setItem('quadrion-password-setup','true');if(['SIGNED_OUT','TOKEN_REFRESHED','PASSWORD_RECOVERY'].includes(event))setTimeout(onChange,0);});
  const getToken=async()=>{const {data}=await client.auth.getSession();return data.session?.access_token||null;};
  function frame(title,description,...content){root.replaceChildren(el('section',{class:'auth-layout'},el('div',{class:'auth-brand'},link(el('img',{src:'/assets/quadrion-horizontal-on-dark.svg',alt:'Quadrion',width:180}),'/d3-quarter/'),el('p',{class:'eyebrow'},'YOUR QUADRION WORKSPACE'),el('h1',{},'From capture.',el('br'),'To clarity.'),el('p',{},'Your software, processing pipelines and project library. In one place.'),el('div',{class:'auth-diagram','aria-hidden':'true'},el('div'),el('div'),el('div'))),el('div',{class:'auth-panel'},el('div',{class:'auth-form'},el('span',{class:'badge'},'PRIVATE ACCESS'),el('h2',{},title),el('p',{class:'muted'},description),...content),link('← Back to Quadrion','/d3-quarter/','back-link'))));}
  function showLogin(mode='login'){
    const reset=mode==='reset',email=field('Email address','email',{type:'email',required:true,autocomplete:'email'}),password=field('Password','password',{type:'password',required:true,autocomplete:'current-password'});
    const feedback=el('div',{'aria-live':'polite'}),submit=el('button',{type:'submit',class:'primary full'},reset?'Send reset link':'Sign in');
    const form=el('form',{onsubmit:async e=>{e.preventDefault();const done=busy(submit,reset?'Sending…':'Signing in…');feedback.replaceChildren();try{
      if(reset){const {error}=await client.auth.resetPasswordForEmail(email.input.value.trim(),{redirectTo:location.origin+'/portal/account/'});if(error)throw error;feedback.replaceChildren(notice('If an account exists for this address, a reset link will arrive shortly.'));}
      else{const {error}=await client.auth.signInWithPassword({email:email.input.value.trim(),password:password.input.value});if(error)throw error;password.input.value='';chooseHome=true;await onChange();}
    }catch(error){feedback.replaceChildren(notice(reset?'The reset request could not be completed. Please try again shortly.':'Sign-in failed. Check your email and password, then try again.','error'));}finally{done();}}},email.node,reset?null:password.node,submit,feedback);
    frame(reset?'Reset your password':'Welcome back',reset?'We’ll send a secure link to your account email.':'Sign in to your private Quadrion workspace.',callbackError?notice('This sign-in link is invalid or expired. Request a new link.','error'):null,form,button(reset?'Back to sign in':'Forgot password?',()=>showLogin(reset?'login':'reset'),true),el('p',{class:'auth-note'},'Access is managed by Synapse. ',link('Contact us','mailto:info@synapse-solutions.ai')));
  }
  function showPassword(){
    const password=field('New password','new-password',{type:'password',required:true,autocomplete:'new-password',help:'Use at least 12 characters.'}),confirm=field('Confirm new password','confirm-password',{type:'password',required:true,autocomplete:'new-password'}),feedback=el('div',{'aria-live':'polite'}),submit=el('button',{type:'submit',class:'primary full'},'Save password');
    frame('Set your password','Choose a password for your Quadrion account.',el('form',{onsubmit:async e=>{e.preventDefault();feedback.replaceChildren();if(password.input.value.length<12||password.input.value!==confirm.input.value){feedback.replaceChildren(notice('Use at least 12 characters and enter the same password in both fields.','error'));return;}const done=busy(submit,'Saving…');const {error}=await client.auth.updateUser({password:password.input.value});done();if(error){feedback.replaceChildren(notice('Could not update your password. Request a new reset link and try again.','error'));return;}password.input.value='';confirm.input.value='';sessionStorage.removeItem('quadrion-password-setup');chooseHome=true;history.replaceState(null,'',workspaceHome);await onChange();}},password.node,confirm.node,submit,feedback));
  }
  function enterWorkspace(member){
    if(!chooseHome)return false;
    const destination=loginDestination(member.role,location.pathname+location.search);
    if(!destination)throw new Error('Your account does not have workspace access.');
    chooseHome=false;
    if(location.pathname!==new URL(destination,location.origin).pathname){location.replace(destination);return true;}
    history.replaceState(null,'',destination);return false;
  }
  async function signOut(){window.dispatchEvent(new Event('quadrion:signout'));root.replaceChildren();await client.auth.signOut({scope:'local'});clearSessionData(sessionStorage);location.replace('/portal/?login');}
  return {client,getToken,showLogin,showPassword,enterWorkspace,signOut,needsPassword:()=>sessionStorage.getItem('quadrion-password-setup')==='true'};
}
