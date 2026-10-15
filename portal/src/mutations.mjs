export async function submitMutation({send,refresh,showError,clear=()=>{}}){
  try{await send();await refresh();return true;}
  catch(error){if([401,403].includes(error.status))clear();showError(error.status===409?'This record changed. Refresh the page and review the current values before saving again.':error.message);return false;}
}
