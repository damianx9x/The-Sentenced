'use strict';
const {inviteContacts}=require('./invite-contacts.cjs');
async function sendWelcome({db,guild,target,upsertMember,getChannel,now}) {
 if(!guild||!target||target.user?.bot)return false;
 upsertMember(target);
 const claim=db.prepare('UPDATE members SET welcomed_at=-1 WHERE user_id=? AND welcomed_at IS NULL').run(target.id);
 if(Number(claim.changes)!==1)return false;
 // A separate durable queue tracks actual in-game greetings, independently of Discord.
 try{require('./wow-welcome.cjs').enqueueMemberWelcome(db,String(target.id),now());}
 catch(error){console.error('WOW_WELCOME_QUEUE_FAILED',error?.code||'QUEUE_ERROR');}
 try{
  const channel=getChannel(guild,'czat-wow');if(!channel?.send)throw Error('WELCOME_CHANNEL_UNAVAILABLE');
  const payload={content:`⚔️ **Witaj w The Sentenced, <@${target.id}>!**\nNowa dusza dołącza do naszych szeregów. Niech ktoś ze starszyzny skieruje Cię do ${inviteContacts(true)}, aby zaprosić Cię także do gildii w grze.\nNiech Twój sztandar nigdy nie opadnie. Chwała Hordzie! 🏴`,allowedMentions:{parse:[],users:[target.id]},nonce:`ts-w-${target.id}`,enforceNonce:true};
  try{await channel.send(payload)}catch(error){
   // Discord rejects bot posts in WoW-linked chat with a definite HTTP 403/20062.
   // Only that confirmed rejection permits a fallback; timeouts stay uncertain.
   if(error?.code!==20062||error?.status!==403)throw error;
   const fallback=getChannel(guild,'ogólny');if(!fallback?.send)throw Error('WELCOME_FALLBACK_UNAVAILABLE');
   await fallback.send(payload);
  }
  db.prepare('UPDATE members SET welcomed_at=? WHERE user_id=? AND welcomed_at=-1').run(now(),target.id);return true;
 }catch(e){console.error('WELCOME_UNCERTAIN',e.code||e.message);return false;}
}
module.exports={sendWelcome};
