'use strict';
// A single rendering policy is shared by startup, interactions and status changes.
function signupPayload(raid, embed, makeButtons) {
 if (!raid || !embed || typeof makeButtons !== 'function') throw Error('INVALID_RAID_SIGNUP_VIEW');
 let components=[];
 if (raid.status === 'ACTIVE') components=makeButtons(raid.id);
 else if (raid.status === 'CLOSED') {
  embed.setTitle(`🔒 ZAPISY ZAMKNIĘTE — ${raid.name}`);
  embed.setDescription([`📅 <t:${raid.scheduled_ts}:F>`,`⏳ <t:${raid.scheduled_ts}:R>`,'','**Zapisy zostały zamknięte.**'].join('\n'));
 } else if (raid.status === 'CANCELLED') {
  embed.setTitle(`❌ RAID ANULOWANY — ${raid.name}`);
  const lines=[`📅 <t:${raid.scheduled_ts}:F>`,'','**Raid został anulowany.**'];
  if (raid.cancel_reason) lines.push('',`**Powód:** ${raid.cancel_reason}`);
  embed.setDescription(lines.join('\n'));
 }
 return {embeds:[embed],components,allowedMentions:{parse:[]}};
}
module.exports={signupPayload};
