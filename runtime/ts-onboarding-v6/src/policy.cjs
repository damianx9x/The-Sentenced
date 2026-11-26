'use strict';
// The Sentenced: pure acceptance oracle. No Discord, DB, network or file writes.
// DO NOT install this as a production handler without adapting and testing all
// existing SentencedBot role-write paths and Discord channel ACLs.
const STATUSES = Object.freeze({
  JOINED: 'JOINED', AWAIT_TERMS: 'AWAIT_TERMS', TERMS_ACCEPTED: 'TERMS_ACCEPTED',
  DRAFT: 'DRAFT', SUBMITTED: 'SUBMITTED', GRANTING: 'GRANTING',
  APPROVED: 'APPROVED', REJECTED: 'REJECTED'
});
const STYLE_SET = new Set(['Casual', 'Raidowanie', 'PvP']);
const DAY_SET = new Set(['pon', 'wt', 'sr', 'czw', 'pt', 'sob', 'nd']);
const REQUIRED_NEW = ['firstName', 'age', 'wowClass', 'race', 'spec', 'professions', 'playstyles', 'raidPlan'];
const ID = /^\d{17,20}$/;
function deny(reason) { return Object.freeze({allowed:false, reason}); }
function allow() { return Object.freeze({allowed:true, reason:'OK'}); }
function hasActiveConsent(s, currentHash) {
  return Boolean(s && typeof currentHash === 'string' && /^[a-f0-9]{64}$/.test(currentHash) &&
    s.consentHash === currentHash && Number.isSafeInteger(s.consentAt) && s.consentAt > 0 &&
    s.consentUserId === s.userId && s.consentGuildId === s.guildId);
}
function eligibleForForm(s, hash) {
  if (!s || !ID.test(s.userId||'') || !ID.test(s.guildId||'')) return deny('UNKNOWN_ID');
  if (s.nativePending !== false) return deny('SCREENING_NOT_VERIFIED');
  if (!hasActiveConsent(s,hash)) return deny('RULES_NOT_ACCEPTED_FOR_CURRENT_VERSION');
  if (![STATUSES.TERMS_ACCEPTED, STATUSES.DRAFT].includes(s.status)) return deny('INVALID_STATE');
  return allow();
}
function str(v, max) {
  return typeof v === 'string' && v.trim().length > 0 && v.trim().length <= max &&
    !/[\u0000-\u001f]/.test(v);
}
function validApplication(app) {
  if (!app || !['TAK', 'NIE'].includes(app.wasMember)) return deny('INVALID_BRANCH');
  if (app.wasMember === 'TAK') return str(app.oldNick,60) ? allow() : deny('OLD_NICK_REQUIRED');
  for (const k of REQUIRED_NEW) {
    if (!(k in app)) return deny('MISSING_'+k.toUpperCase());
  }
  if (!str(app.firstName,80)) return deny('INVALID_NAME');
  if (!Number.isInteger(app.age) || app.age < 1 || app.age > 120) return deny('INVALID_AGE');
  for(const k of ['wowClass','race','spec']) if(!str(app[k],80)) return deny('INVALID_'+k.toUpperCase());
  if (!Array.isArray(app.professions) || app.professions.length>3 || app.professions.some(x=>!str(x,80))) return deny('INVALID_PROFESSIONS');
  if (!Array.isArray(app.playstyles) || !app.playstyles.length || app.playstyles.length>3 ||
      new Set(app.playstyles).size!==app.playstyles.length || app.playstyles.some(x=>!STYLE_SET.has(x))) return deny('INVALID_PLAYSTYLES');
  if (![true,false].includes(app.raidPlan)) return deny('INVALID_RAID_PLAN');
  if (app.raidPlan) {
    if (!Number.isFinite(app.raidHoursWeek)||app.raidHoursWeek<=0||app.raidHoursWeek>168) return deny('INVALID_RAID_HOURS');
    if (!Array.isArray(app.raidDays) || !app.raidDays.length || app.raidDays.length>7 ||
        new Set(app.raidDays).size!==app.raidDays.length || app.raidDays.some(x=>!DAY_SET.has(x))) return deny('INVALID_RAID_DAYS');
  } else if ((app.raidDays && app.raidDays.length) || app.raidHoursWeek) return deny('UNEXPECTED_RAID_FIELDS');
  if (app.about !== undefined && !str(app.about,1200)) return deny('INVALID_ABOUT');
  return allow();
}
function maySubmit(s, hash, application) {
  const form = eligibleForForm(s,hash);
  if (!form.allowed) return form;
  return validApplication(application);
}
function mayApprove(s, hash, actor) {
  if (!s || s.status!==STATUSES.SUBMITTED) return deny('NOT_SUBMITTED');
  if (s.nativePending!==false) return deny('SCREENING_NOT_VERIFIED');
  if (!hasActiveConsent(s,hash)) return deny('RULES_NOT_ACCEPTED_FOR_CURRENT_VERSION');
  if (!s.applicationValid || !Number.isSafeInteger(s.submittedAt) || s.submittedAt<=0) return deny('APPLICATION_NOT_VERIFIED');
  if (!actor || !ID.test(actor.userId||'') || actor.guildId!==s.guildId || actor.authorized!==true || actor.isBot===true) return deny('ACTOR_NOT_AUTHORIZED');
  if (s.userId===actor.userId) return deny('SELF_APPROVAL');
  if (s.memberPresent!==true) return deny('MEMBER_NOT_PRESENT');
  return allow();
}
function mayGrant(s,hash,decision) {
  if (!s || s.status!==STATUSES.GRANTING) return deny('NO_APPROVAL_IN_PROGRESS');
  if (!s.applicationValid || !hasActiveConsent(s,hash) || s.nativePending!==false) return deny('RULES_OR_APPLICATION_MISSING');
  if (!decision || !ID.test(decision.actorId||'') || decision.authorized!==true || decision.applicationId!==s.applicationId || decision.guildId!==s.guildId) return deny('NO_VERIFIED_STAFF_DECISION');
  if (s.memberPresent!==true) return deny('MEMBER_NOT_PRESENT');
  return allow();
}
function canWelcome(s) {
  return Boolean(s && s.status===STATUSES.APPROVED && s.memberRoleVerified===true &&
    s.grantRoleVerified===true && !s.welcomedAt && s.applicationValid);
}
module.exports={STATUSES, hasActiveConsent, eligibleForForm, validApplication, maySubmit, mayApprove, mayGrant, canWelcome};
