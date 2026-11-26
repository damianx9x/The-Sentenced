'use strict';
// Explicit allow-list, not role hierarchy guesses or the technical access role.
function canVote(member, allowedRoleIds, ownerId) {
 if(!member || member.user?.bot || member.pending !== false || typeof member.id !== 'string') return false;
 if(member.id === ownerId) return true;
 if(!Array.isArray(allowedRoleIds) || !allowedRoleIds.length || !member.roles?.cache) return false;
 return allowedRoleIds.some(id=>typeof id==='string' && member.roles.cache.has(id));
}
module.exports={canVote};
