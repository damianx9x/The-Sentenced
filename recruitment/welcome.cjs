'use strict';
// Legacy entry points still call this after role changes and during catch-up.
// Welcomes are now sent exclusively by public.cjs in the application thread.
// Retire the old delivery flag without posting or creating a WoW queue entry.
async function sendWelcome({db,guild,target,upsertMember,now}) {
 if(!guild||!target||target.user?.bot)return false;
 upsertMember(target);
 const result=db.prepare('UPDATE members SET welcomed_at=? WHERE user_id=? AND welcomed_at IS NULL').run(now(),target.id);
 return Number(result.changes)===1;
}
module.exports={sendWelcome};
