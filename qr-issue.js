export async function issueAccessQr(store,siteId,origin,rotate,render){
  const key=rotate?store.rotateSiteAccess(siteId):store.ensureSiteAccess(siteId),link=`${origin}/join?site=${encodeURIComponent(key)}`,image=await render(link);
  if(store.siteAccessKey(siteId)!==key)return null;
  return {link,image,registrationExpiresAt:store.siteRegistrationExpiry(siteId)};
}

export async function issueInvitationQr(store,siteId,origin,render){
  const invite=store.createInvitation(siteId),link=`${origin}/join?token=${encodeURIComponent(invite.token)}`,image=await render(link);
  if(!store.invitation(invite.token))return null;
  return {link,image,expiresAt:invite.expiresAt};
}
