'use strict';
// Current game snapshot stays separate from Discord accounts and declarations.
const CLASSES=[['Warrior','Wojownik','🟤'],['Paladin','Paladyn','🩷'],['Hunter','Łowca','🟢'],['Rogue','Łotrzyk','🟡'],['Priest','Kapłan','⚪'],['Shaman','Szaman','🔵'],['Mage','Mag','🩵'],['Warlock','Czarnoksiężnik','🟣'],['Druid','Druid','🟠']];
const key=v=>String(v||'').normalize('NFKC').trim().toLocaleLowerCase('en-US');
const exists=(db,name)=>Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
function readRoster(db){
 if(!exists(db,'guild_roster_characters'))return {rows:[],current:false,observedAt:null};
 const cols=new Set(db.prepare('PRAGMA table_info(guild_roster_characters)').all().map(r=>r.name));
 const selection=['name','wow_class','discord_id','level','updated_at'].map(c=>cols.has(c)?c:'NULL AS '+c).join(',');
 if(cols.has('last_import_id')&&exists(db,'guild_roster_imports')){
  const latest=db.prepare("SELECT id,created_at FROM guild_roster_imports WHERE actor_id='mac-roster-sync' AND rolled_back_at IS NULL ORDER BY created_at DESC,id DESC LIMIT 1").get();
  if(latest){
   const history=cols.has('character_key')&&exists(db,'guild_roster_character_changes');
   // A manual profile binding may change last_import_id. Snapshot membership
   // is the immutable set of character keys recorded by that game import.
   const rows=history?db.prepare('SELECT '+selection+' FROM guild_roster_characters WHERE character_key IN (SELECT character_key FROM guild_roster_character_changes WHERE import_id=?)').all(latest.id):db.prepare('SELECT '+selection+' FROM guild_roster_characters WHERE last_import_id=?').all(latest.id);
   let stamp=Math.floor(latest.created_at/1000);
   if(exists(db,'guild_roster_sync_state')){const state=db.prepare("SELECT source_timestamp FROM guild_roster_sync_state WHERE source='mac-the-sentenced'").get();if(Number.isSafeInteger(state?.source_timestamp)&&state.source_timestamp>0&&state.source_timestamp<=stamp+300)stamp=state.source_timestamp;}
   return {rows,current:rows.length>0,observedAt:stamp};
  }
 }
 const rows=db.prepare('SELECT '+selection+' FROM guild_roster_characters').all();
 return {rows,current:false,observedAt:rows.length?Math.floor(Math.max(...rows.map(r=>Number(r.updated_at)||0))/1000):null};
}
function declarations(db,records){
 const columns=exists(db,'member_preferences')?new Set(db.prepare('PRAGMA table_info(member_preferences)').all().map(r=>r.name)):new Set();
 const required=['specialization','specialization_class','specialization_character','specialization_updated_at'];
 const prefs=new Map(required.every(c=>columns.has(c))?db.prepare('SELECT user_id,'+required.join(',')+' FROM member_preferences').all().map(r=>[r.user_id,r]):[]);
 return records.map(r=>({...r,specialization:prefs.get(r.user_id)}));
}
function composition(roster,records){
 const counts=Object.fromEntries(CLASSES.map(([name])=>[name,0]));const roles={TANK:0,HEAL:0,DPS:0};const specs=new Map();let roleKnown=0,specKnown=0,unknownClass=0;
 const byName=new Map(),byId=new Map(records.map(r=>[String(r.user_id),r]));
 for(const r of records){const name=key(r.game_nick);if(name)byName.set(name,byName.has(name)?null:r);}
 for(const character of roster.rows){
  const klass=character.wow_class;if(Object.hasOwn(counts,klass))counts[klass]++;else unknownClass++;
  const r=character.discord_id?byId.get(String(character.discord_id)):byName.get(key(character.name));
  if(!r||key(r.game_nick)!==key(character.name)||key(r.wow_class)!==key(klass))continue;
  const role=String(r.wow_role||'').toUpperCase();const roleName=role==='HEALER'?'HEAL':role;
  if(Object.hasOwn(roles,roleName)){roles[roleName]++;roleKnown++;}
  const p=r.specialization;
  if(!p||typeof p.specialization!=='string'||!p.specialization.trim()||p.specialization.length>60||/[\x00-\x1f\x7f]/.test(p.specialization)||key(p.specialization_character)!==key(character.name)||key(p.specialization_class)!==key(klass)||!Number.isSafeInteger(p.specialization_updated_at))continue;
  const spec=p.specialization.trim();const id=klass+'|'+key(spec),prev=specs.get(id);specs.set(id,{klass,name:prev?.name||spec,count:(prev?.count||0)+1});specKnown++;
 }
 return {total:roster.rows.length,classes:CLASSES.map(([name,label,emoji])=>({name,label,emoji,count:counts[name]})),unknownClass,roles,roleKnown,roleUnknown:roster.rows.length-roleKnown,specKnown,specUnknown:roster.rows.length-specKnown,specs:[...specs.values()].sort((a,b)=>a.klass.localeCompare(b.klass)||a.name.localeCompare(b.name))};
}
module.exports={readRoster,declarations,composition,CLASSES};
