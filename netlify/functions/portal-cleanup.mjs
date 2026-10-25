import {portalConfig} from '../lib/portal/config.mjs';
import {isPublishedProduction} from '../lib/runtime.mjs';
import {createBackend} from '../lib/portal/supabase.mjs';
import {dispatchVerification} from '../lib/portal/uploads.mjs';
import {dispatchFeedbackVerification} from '../lib/portal/feedback-uploads.mjs';
export default async(request,context)=>{
  const settings=portalConfig();if(!settings.enabled||!isPublishedProduction(context)||settings.verifySecret.length<32)return;
  const backend=createBackend(settings),jobs=await backend.rpc('portal_verify_queue',{});
  await Promise.allSettled(jobs.map(id=>dispatchVerification(settings,id)));
  const abandoned=await backend.rpc('portal_cleanup',{p_cleaned:null});
  for(const file of abandoned){const {error}=await backend.service.storage.from(file.bucket).remove([file.object_path]);if(!error)await backend.rpc('portal_cleanup',{p_cleaned:file.id});}
  // Feedback attachments run after the release work, so a feedback failure never holds it up.
  const feedbackJobs=await backend.rpc('portal_feedback_verify_queue',{});
  await Promise.allSettled(feedbackJobs.map(id=>dispatchFeedbackVerification(settings,id)));
  const feedbackAbandoned=await backend.rpc('portal_feedback_cleanup',{p_cleaned:null});
  for(const file of feedbackAbandoned){const {error}=await backend.service.storage.from(file.bucket).remove([file.object_path]);if(!error)await backend.rpc('portal_feedback_cleanup',{p_cleaned:file.id});}
};
export const config={schedule:'*/5 * * * *'};
