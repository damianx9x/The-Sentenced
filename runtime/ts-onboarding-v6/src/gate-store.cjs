'use strict';
/**
 * The Sentenced: durable SQLite onboarding gate. Additive schema only.
 * Works with better-sqlite3 (production adapter) and Node node:sqlite for tests.
 * Do not plug into a live bot without an independent ACL migration / actual source integration.
 */
const {createHash}=require('node:crypto');
const {validApplication}=require('./policy.cjs');
const ST={WAIT:'WAIT_RULES',ACCEPTED:'TERMS_ACCEPTED',DRAFT:'DRAFT',SUBMITTED:'SUBMITTED',GRANTING:'GRANTING',APPROVED:'APPROVED',REJECTED:'REJECTED'};
const ID=/^\d{17,20}$/;
const HASH=/^[0-9a-f]{64}$/;
function checkId(x){return typeof x==='string' && ID.test(x);}
function assertSafeIds(guildId,userId){if(!checkId(guildId)||!checkId(userId))throw Error('INVALID_GUILD_OR_USER');}
function nowSafe(ts){if(!Number.isSafeInteger(ts)||ts<=0)throw Error('INVALID_TIMESTAMP');return ts;}
function termsHash(markdown){return createHash('sha256').update(markdown,'utf8').digest('hex');}
function jsonCopy(x){return JSON.parse(JSON.stringify(x));}
class GateStore {
  constructor(db, guildId){if(!db||typeof db.prepare!=='function'||!checkId(guildId))throw Error('INVALID_STORE');this.db=db;this.guildId=guildId;}
  migrate(){this.db.exec(`
    CREATE TABLE IF NOT EXISTS ts_onboarding_gate (
      guild_id TEXT NOT NULL, user_id TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'WAIT_RULES',
      terms_hash TEXT, accepted_at INTEGER, application_json TEXT,
      submitted_at INTEGER, decision_actor TEXT, decision_at INTEGER,
      role_verified_at INTEGER, welcomed_at INTEGER,
      staff_message_id TEXT, staff_dispatch_at INTEGER, submitted_revision INTEGER, revision INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(guild_id,user_id)
    );
    CREATE INDEX IF NOT EXISTS ts_gate_by_state ON ts_onboarding_gate(guild_id,state);
  `);}
  init(userId,ts){assertSafeIds(this.guildId,userId);nowSafe(ts);this.db.prepare('INSERT OR IGNORE INTO ts_onboarding_gate(guild_id,user_id,state,updated_at) VALUES(?,?,?,?)').run(this.guildId,userId,ST.WAIT,ts);return this.get(userId);}
  get(userId){assertSafeIds(this.guildId,userId);return this.db.prepare('SELECT * FROM ts_onboarding_gate WHERE guild_id=? AND user_id=?').get(this.guildId,userId)||null;}
  _change(sql,...args){return this.db.prepare(sql).run(...args).changes===1;}
  accept(userId,hash,ts,{nativePending}={}){
    assertSafeIds(this.guildId,userId);nowSafe(ts);
    if(!HASH.test(hash))return {ok:false,reason:'INVALID_TERMS_HASH'};
    if(nativePending!==false)return {ok:false,reason:'NATIVE_SCREENING_NOT_VERIFIED'};
    if(!this.get(userId))return {ok:false,reason:'NOT_INITIALIZED'};
    const ok=this._change(`UPDATE ts_onboarding_gate SET state=?,terms_hash=?,accepted_at=?,application_json=NULL,submitted_at=NULL,updated_at=?,revision=revision+1 WHERE guild_id=? AND user_id=? AND state IN (?,?,?)`,
      ST.ACCEPTED,hash,ts,ts,this.guildId,userId,ST.WAIT,ST.ACCEPTED,ST.DRAFT);
    return {ok,reason:ok?'ACCEPTED':'STATE_BLOCKED'};
  }
  draft(userId,hash,data,ts,{nativePending}={}){
    assertSafeIds(this.guildId,userId);nowSafe(ts);
    if(nativePending!==false)return {ok:false,reason:'SCREENING_PENDING'};
    if(!HASH.test(hash))return {ok:false,reason:'BAD_HASH'};
    // Keep partial application draft; reject non-plain-object and dangerous size.
    if(!data || Object.getPrototypeOf(data)!==Object.prototype)return {ok:false,reason:'BAD_DRAFT'};
    let encoded;try{encoded=JSON.stringify(data);}catch(_){return {ok:false,reason:'BAD_DRAFT'};}
    if(encoded.length>6000)return {ok:false,reason:'BAD_DRAFT'};
    const ok=this._change(`UPDATE ts_onboarding_gate SET state=?,application_json=?,updated_at=?,revision=revision+1 WHERE guild_id=? AND user_id=? AND state IN (?,?) AND terms_hash=? AND accepted_at IS NOT NULL`,
      ST.DRAFT,encoded,ts,this.guildId,userId,ST.ACCEPTED,ST.DRAFT,hash);
    return {ok,reason:ok?'DRAFT_SAVED':'CONSENT_OR_STATE_BLOCKED'};
  }
  submit(userId,hash,app,ts,{nativePending}={}){
    assertSafeIds(this.guildId,userId);nowSafe(ts);
    if(nativePending!==false)return {ok:false,reason:'SCREENING_PENDING'};
    if(!HASH.test(hash))return {ok:false,reason:'BAD_HASH'};
    const v=validApplication(app);if(!v.allowed)return {ok:false,reason:v.reason};
    const ok=this._change(`UPDATE ts_onboarding_gate SET state=?,application_json=?,submitted_at=?,submitted_revision=revision+1,updated_at=?,revision=revision+1 WHERE guild_id=? AND user_id=? AND state IN (?,?) AND terms_hash=? AND accepted_at IS NOT NULL AND submitted_at IS NULL`,
      ST.SUBMITTED,JSON.stringify(app),ts,ts,this.guildId,userId,ST.ACCEPTED,ST.DRAFT,hash);
    return {ok,reason:ok?'SUBMITTED':'CONSENT_OR_STATE_BLOCKED'};
  }
  reserveStaffDispatch(userId,ts){
    assertSafeIds(this.guildId,userId);nowSafe(ts);
    const ok=this._change(`UPDATE ts_onboarding_gate SET staff_dispatch_at=-1,updated_at=? WHERE guild_id=? AND user_id=? AND state=? AND staff_dispatch_at IS NULL AND staff_message_id IS NULL`,ts,this.guildId,userId,ST.SUBMITTED);
    return {ok,reason:ok?'CLAIMED':'ALREADY_CLAIMED_OR_STATE_BLOCKED'};
  }
  recordStaffMessage(userId,messageId,ts){
    assertSafeIds(this.guildId,userId);nowSafe(ts);
    if(!checkId(messageId))return {ok:false,reason:'BAD_MESSAGE_ID'};
    const ok=this._change(`UPDATE ts_onboarding_gate SET staff_message_id=?,staff_dispatch_at=?,updated_at=? WHERE guild_id=? AND user_id=? AND state=? AND staff_dispatch_at=-1 AND staff_message_id IS NULL`,messageId,ts,ts,this.guildId,userId,ST.SUBMITTED);
    return {ok,reason:ok?'RECORDED':'NO_CLAIM_OR_ALREADY_SENT'};
  }
  /** Only release if the Discord send definitely failed, not on unknown timeout. */
  releaseFailedStaffDispatch(userId,ts){
    assertSafeIds(this.guildId,userId);nowSafe(ts);
    return this._change(`UPDATE ts_onboarding_gate SET staff_dispatch_at=NULL,updated_at=? WHERE guild_id=? AND user_id=? AND state=? AND staff_dispatch_at=-1 AND staff_message_id IS NULL`,ts,this.guildId,userId,ST.SUBMITTED);
  }
  decide(userId,hash,actor,action,ts,{nativePending,memberPresent}={}){
    assertSafeIds(this.guildId,userId);nowSafe(ts);
    if(!HASH.test(hash))return {ok:false,reason:'INVALID_TERMS_HASH'};
    if(nativePending!==false||memberPresent!==true)return {ok:false,reason:'LIVE_MEMBERSHIP_OR_SCREENING_UNVERIFIED'};
    if(!actor||!checkId(actor.id)||actor.id===userId||actor.guildId!==this.guildId||actor.authorized!==true||actor.isBot===true)return {ok:false,reason:'ACTOR_UNAUTHORIZED'};
    if(!['approve','reject'].includes(action))return {ok:false,reason:'BAD_ACTION'};
    const row=this.get(userId);
    if(!row||row.state!==ST.SUBMITTED||row.terms_hash!==hash||!row.accepted_at||!row.submitted_at||!row.application_json)return {ok:false,reason:'INVALID_CANDIDATE_STATE'};
    if(actor.applicationRevision!==row.submitted_revision)return {ok:false,reason:'STALE_STAFF_CARD'};
    let valid=false;try{valid=validApplication(JSON.parse(row.application_json)).allowed;}catch(_){valid=false;}
    if(!valid)return {ok:false,reason:'INVALID_APPLICATION'};
    const next=action==='approve'?ST.GRANTING:ST.REJECTED;
    const ok=this._change(`UPDATE ts_onboarding_gate SET state=?,decision_actor=?,decision_at=?,updated_at=?,revision=revision+1 WHERE guild_id=? AND user_id=? AND state=? AND terms_hash=?`,next,actor.id,ts,ts,this.guildId,userId,ST.SUBMITTED,hash);
    return {ok,reason:ok?(action==='approve'?'GRANTING_CLAIMED':'REJECTED'):'RACE_OR_STATE_CHANGED'};
  }
  completeRoleGrant(userId,hash,ts,{nativePending,memberPresent,memberRolePresent,accessRolePresent}={}){
    assertSafeIds(this.guildId,userId);nowSafe(ts);
    if(nativePending!==false||memberPresent!==true||memberRolePresent!==true||accessRolePresent!==true)return {ok:false,reason:'DISCORD_ROLE_READBACK_NOT_VERIFIED'};
    if(!HASH.test(hash))return {ok:false,reason:'BAD_HASH'};
    const ok=this._change(`UPDATE ts_onboarding_gate SET state=?,role_verified_at=?,updated_at=?,revision=revision+1 WHERE guild_id=? AND user_id=? AND state=? AND terms_hash=? AND decision_actor IS NOT NULL`,ST.APPROVED,ts,ts,this.guildId,userId,ST.GRANTING,hash);
    return {ok,reason:ok?'APPROVED':'STATE_OR_CONSENT_BLOCKED'};
  }
  claimWelcome(userId,ts){
    assertSafeIds(this.guildId,userId);nowSafe(ts);
    const ok=this._change(`UPDATE ts_onboarding_gate SET welcomed_at=-1,updated_at=?,revision=revision+1 WHERE guild_id=? AND user_id=? AND state=? AND role_verified_at IS NOT NULL AND welcomed_at IS NULL`,ts,this.guildId,userId,ST.APPROVED);
    return {ok,reason:ok?'WELCOME_CLAIMED':'WELCOME_BLOCKED_OR_CLAIMED'};
  }
  completeWelcome(userId,ts){assertSafeIds(this.guildId,userId);nowSafe(ts);return this._change(`UPDATE ts_onboarding_gate SET welcomed_at=?,updated_at=? WHERE guild_id=? AND user_id=? AND state=? AND welcomed_at=-1`,ts,ts,this.guildId,userId,ST.APPROVED);}
  releaseFailedWelcome(userId,ts){assertSafeIds(this.guildId,userId);nowSafe(ts);return this._change(`UPDATE ts_onboarding_gate SET welcomed_at=NULL,updated_at=? WHERE guild_id=? AND user_id=? AND state=? AND welcomed_at=-1`,ts,this.guildId,userId,ST.APPROVED);}
  /** read-only observability — no candidate PII returned to logs */
  counts(){return this.db.prepare('SELECT state,COUNT(*) AS count FROM ts_onboarding_gate WHERE guild_id=? GROUP BY state').all(this.guildId);}
}
module.exports={GateStore,ST,termsHash};
