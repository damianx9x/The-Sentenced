'use strict';
const crypto = require('node:crypto');
const FIELDS = ['game_nick','plans_forever','wow_class','wow_role','played_before_ts','old_ts_nick','interests'];
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function profile(db,userId) {
 const value=db.prepare('SELECT '+FIELDS.join(',')+' FROM members WHERE user_id=?').get(userId);
 if(!value) throw Error('Brak profilu');
 return {value,revision:hash(value)};
}
function updateProfile(db,userId,expected,payload) {
 return db.transaction(()=>{
 const current=profile(db,userId);
 if(current.revision!==expected)return {error:'Profil zmienił się. Sprawdź aktualne dane.',conflict:true};
 if(!payload||typeof payload!=='object'||Array.isArray(payload))return {error:'Nieprawidłowy profil'};
 if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='guild_roster_characters'").get()) {
  const authority=db.prepare('SELECT name,wow_class FROM guild_roster_characters WHERE discord_id=?').get(userId);
  if(authority && ((typeof payload.game_nick==='string' && payload.game_nick.trim()!==authority.name) || (authority.wow_class && typeof payload.wow_class==='string' && payload.wow_class.trim()!==authority.wow_class)))
   return {error:'Nick i klasa pochodzą z rostera gildii. Poproś oficera o aktualizację.'};
 }

 const value={...current.value};
 for(const [key,v]of Object.entries(payload)){
  if(!FIELDS.includes(key)||typeof v!=='string'||v.length>(key==='interests'?500:100)||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v))return {error:'Nieprawidłowe pole profilu'};
  value[key]=v.trim();
  if(['game_nick','wow_class'].includes(key)&&!value[key])return {error:'Nick i klasa nie mogą być puste'};
  if(key==='wow_role'&&!['TANK','HEAL','DPS'].includes(value[key])||['plans_forever','played_before_ts'].includes(key)&&!['TAK','NIE'].includes(value[key]))return {error:'Sprawdź pola profilu'};
 }
 const changed=db.prepare('UPDATE members SET '+FIELDS.map(k=>k+'=?').join(',')+' WHERE user_id=? AND '+FIELDS.map(k=>k+' IS ?').join(' AND ')).run(...FIELDS.map(k=>value[k]),userId,...FIELDS.map(k=>current.value[k]));
 if(changed.changes!==1)return {error:'Profil zmienił się. Sprawdź aktualne dane.',conflict:true};
 return {profile:profile(db,userId)};
 })();
}
function raidState(db,id,userId) {
 const raid=db.prepare('SELECT * FROM raids WHERE id=?').get(id);if(!raid)return null;
 const roster=db.prepare('SELECT s.user_id,s.status,s.updated_at,m.game_nick,m.wow_role FROM raid_signups s LEFT JOIN members m USING(user_id) WHERE raid_id=? ORDER BY s.user_id').all(id);
 return {id:raid.id,name:raid.name||'Raid',description:raid.description||'',status:raid.status,scheduled:raid.scheduled_ts,limit:raid.player_limit,revision:hash({raid,roster}),ownStatus:roster.find(s=>s.user_id===userId)?.status||null,roster:roster.map(s=>({name:s.game_nick||'Członek gildii',role:s.wow_role||'',status:s.status,self:s.user_id===userId}))};
}
function recordRaidSignup(db,{raidId,userId,status,expectedRevision,now=Date.now()}) {
 return db.transaction(()=>{
  if(!Number.isSafeInteger(raidId)||!['YES','MAYBE','NO'].includes(status))return {error:'Nieprawidłowy zapis na raid'};
  const state=raidState(db,raidId,userId);
  if(!state||state.status!=='ACTIVE'||state.scheduled<=Math.floor(now/1000))return {error:'Ten raid jest zamknięty albo jego termin minął'};
  if(expectedRevision!==undefined&&state.revision!==expectedRevision)return {error:'Skład lub raid zmienił się. Sprawdź aktualny stan.',conflict:true};
  if(status==='YES'&&state.limit&&state.ownStatus!=='YES'&&state.roster.filter(s=>s.status==='YES').length>=state.limit)return {error:'Lista raidu jest pełna. Możesz wybrać Może'};
  db.prepare('INSERT INTO raid_signups(raid_id,user_id,status,updated_at) VALUES(?,?,?,?) ON CONFLICT(raid_id,user_id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at').run(raidId,userId,status,now);
  return {raid:raidState(db,raidId,userId)};
 })();
}
function lfgState(db,id,userId) {
 const e=db.prepare('SELECT * FROM expeditions WHERE id=?').get(id);if(!e)return null;
 const entries=db.prepare('SELECT em.user_id,em.wow_role,m.game_nick FROM expedition_members em LEFT JOIN members m USING(user_id) WHERE expedition_id=? ORDER BY em.user_id').all(e.id);
 return {id:e.id,title:e.title,details:e.details,mode:e.mode,capacity:e.capacity,expires_at:e.expires_at,status:e.status,owner:e.owner_id===userId,own:entries.some(x=>x.user_id===userId),revision:hash({e,entries}),members:entries.map(x=>({name:x.game_nick||'Członek gildii',role:x.wow_role||'',self:x.user_id===userId}))};
}
module.exports={FIELDS,hash,profile,updateProfile,raidState,recordRaidSignup,lfgState};
