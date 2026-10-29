import { randomBytes } from 'node:crypto';

export async function issueAccessQr(store,siteId,origin,rotate,render,authorize=()=>{}){
  const oldKey=store.ensureSiteAccess(siteId),key=rotate?randomBytes(32).toString('base64url'):oldKey,link=`${origin}/join?site=${encodeURIComponent(key)}`,image=await render(link);
  if(rotate){if(!store.replaceSiteAccess(siteId,oldKey,key,authorize))return null;}else{authorize();if(store.siteAccessKey(siteId)!==key)return null;}
  return {link,image,registrationExpiresAt:store.siteRegistrationExpiry(siteId)};
}

export async function issueInvitationQr(store,siteId,origin,render,authorize=()=>{}){
  const invite=store.createInvitation(siteId,true),link=`${origin}/join?token=${encodeURIComponent(invite.token)}`;
  try{const image=await render(link);if(!store.activateInvitation(invite.token,authorize))return null;return {link,image,expiresAt:invite.expiresAt};}
  catch(error){try{store.discardPendingInvitation(invite.token);}catch{}throw error;}
}
