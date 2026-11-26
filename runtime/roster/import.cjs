'use strict';
const {createHash,randomUUID}=require('node:crypto');
const CLASSES=new Set(['Warrior','Paladin','Hunter','Rogue','Priest','Shaman','Mage','Warlock','Druid']);
function normalizeName(x){if(typeof x!=='string'||!x.trim()||x.trim().length>60||/[\u0000-\u001f]/.test(x))throw Error('INVALID_CHARACTER');return x.trim();}
function preview(rows,members,bindings={}){
 if(!Array.isArray(rows)||!Array.isArray(members)||rows.length>5000)throw Error('INVALID_ROSTER');
 const known=new Map(members.filter(m=>m.left_at==null).map(m=>[String(m.user_id),m]));const names=new Set(),assigned=new Set();
 return rows.map(row=>{
  const name=normalizeName(row.name),key=name.normalize('NFKC').toLocaleLowerCase('en-US');if(names.has(key))throw Error('DUPLICATE_CHARACTER');names.add(key);
  const wowClass=row.wowClass||null;if(wowClass&&!CLASSES.has(wowClass))throw Error('INVALID_CLASS');
  const level=row.level??null,rank=row.rank??null;if(level!==null&&(!Number.isInteger(level)||level<1||level>1000))throw Error('INVALID_LEVEL');if(rank!==null&&(typeof rank!=='string'||rank.length>120||/[\u0000-\u001f]/.test(rank)))throw Error('INVALID_RANK');
  const id=bindings[name]||null;let member=null;
  if(id){if(typeof id!=='string'||!known.has(id)||assigned.has(id))throw Error('INVALID_BINDING');assigned.add(id);member=known.get(id);}
  const matches=members.filter(m=>m.left_at==null&&String(m.game_nick||'').normalize('NFKC').toLocaleLowerCase('en-US')===key).map(m=>String(m.user_id));
  return {name,wowClass,level,rank,discordId:id,status:id?'BOUND':'NEEDS_REVIEW',suggestions:matches,before:member?{game_nick:member.game_nick??null,wow_class:member.wow_class??null}:null};
 });
}
function createImporter(db){
 db.exec(`CREATE TABLE IF NOT EXISTS guild_roster_characters (character_key TEXT PRIMARY KEY,name TEXT NOT NULL,wow_class TEXT,discord_id TEXT,updated_at INTEGER NOT NULL,last_import_id TEXT NOT NULL);
 CREATE UNIQUE INDEX IF NOT EXISTS guild_roster_one_primary ON guild_roster_characters(discord_id) WHERE discord_id IS NOT NULL;
 CREATE TRIGGER IF NOT EXISTS guild_roster_profile_guard BEFORE UPDATE OF game_nick,wow_class ON members
 WHEN EXISTS(SELECT 1 FROM guild_roster_characters r WHERE r.discord_id=NEW.user_id AND (NEW.game_nick IS NOT r.name OR (r.wow_class IS NOT NULL AND NEW.wow_class IS NOT r.wow_class)))
 BEGIN SELECT RAISE(ABORT,'ROSTER_AUTHORITATIVE'); END;
 CREATE TABLE IF NOT EXISTS guild_roster_sync_state (source TEXT PRIMARY KEY,source_timestamp INTEGER NOT NULL,request_id TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS guild_roster_imports (id TEXT PRIMARY KEY,actor_id TEXT NOT NULL,created_at INTEGER NOT NULL,source_hash TEXT NOT NULL,rolled_back_at INTEGER);
 CREATE TABLE IF NOT EXISTS guild_roster_character_changes (import_id TEXT NOT NULL,character_key TEXT NOT NULL,before_json TEXT,PRIMARY KEY(import_id,character_key));
 CREATE TABLE IF NOT EXISTS guild_roster_changes (import_id TEXT NOT NULL,user_id TEXT NOT NULL,before_nick TEXT,before_class TEXT,after_nick TEXT,after_class TEXT,PRIMARY KEY(import_id,user_id));`);
 const columns=new Set(db.prepare('PRAGMA table_info(guild_roster_characters)').all().map(x=>x.name));
 if(!columns.has('level'))db.exec('ALTER TABLE guild_roster_characters ADD COLUMN level INTEGER');
 if(!columns.has('rank'))db.exec('ALTER TABLE guild_roster_characters ADD COLUMN rank TEXT');
 const members=()=>db.prepare('SELECT user_id,game_nick,wow_class,left_at FROM members').all();
 const put=db.prepare(`INSERT INTO guild_roster_characters(character_key,name,wow_class,discord_id,updated_at,last_import_id,level,rank) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(character_key) DO UPDATE SET name=excluded.name,wow_class=COALESCE(excluded.wow_class,guild_roster_characters.wow_class),discord_id=COALESCE(excluded.discord_id,guild_roster_characters.discord_id),updated_at=excluded.updated_at,last_import_id=excluded.last_import_id,level=COALESCE(excluded.level,guild_roster_characters.level),rank=COALESCE(excluded.rank,guild_roster_characters.rank)`);
 const update=db.prepare('UPDATE members SET game_nick=?,wow_class=? WHERE user_id=? AND left_at IS NULL AND game_nick IS ? AND wow_class IS ?');
 const log=db.prepare('INSERT INTO guild_roster_changes VALUES(?,?,?,?,?,?)');
 const getRevision=db.prepare('SELECT last_import_id,discord_id FROM guild_roster_characters WHERE character_key=?');
 const build=(rows,bindings={})=>{
  const resolved=Object.assign(Object.create(null),bindings);for(const r of rows){const name=normalizeName(r.name),old=getRevision.get(name.normalize('NFKC').toLocaleLowerCase('en-US'));if(!resolved[name]&&old?.discord_id)resolved[name]=old.discord_id;}
  return preview(rows,members(),resolved).map(x=>({...x,rosterRevision:getRevision.get(x.name.normalize('NFKC').toLocaleLowerCase('en-US'))?.last_import_id??null}));
 };
 function apply(plan,{actorId,now,source,sourceTimestamp,requestId}){
  if(!Array.isArray(plan)||!actorId||!Number.isSafeInteger(now))throw Error('INVALID_IMPORT');
  if(source!==undefined && (typeof source!=='string'||!source||!Number.isSafeInteger(sourceTimestamp)||typeof requestId!=='string'||!/^[a-f0-9]{64}$/.test(requestId)))throw Error('INVALID_SOURCE');
  const bind={};for(const x of plan)if(x.discordId)bind[x.name]=x.discordId;
  const id=randomUUID(),hash=createHash('sha256').update(JSON.stringify(plan)).digest('hex');db.exec('BEGIN IMMEDIATE');
  try {
   if(source){const previous=db.prepare('SELECT source_timestamp,request_id FROM guild_roster_sync_state WHERE source=?').get(source);if(previous?.request_id===requestId){db.exec('COMMIT');return {duplicate:true};}if(previous && sourceTimestamp<=previous.source_timestamp)throw Error('STALE_SNAPSHOT');}
   const current=build(plan.map(x=>({name:x.name,wowClass:x.wowClass,level:x.level,rank:x.rank})),bind);
   if(current.length!==plan.length||current.some((x,i)=>JSON.stringify(x.before)!==JSON.stringify(plan[i].before)||x.discordId!==plan[i].discordId||x.rosterRevision!==plan[i].rosterRevision))throw Error('PREVIEW_STALE');
   db.prepare('INSERT INTO guild_roster_imports(id,actor_id,created_at,source_hash) VALUES(?,?,?,?)').run(id,actorId,now,hash);
   for(const x of plan){const key=x.name.normalize('NFKC').toLocaleLowerCase('en-US');const old=db.prepare('SELECT * FROM guild_roster_characters WHERE character_key=?').get(key);db.prepare('INSERT INTO guild_roster_character_changes VALUES(?,?,?)').run(id,key,old?JSON.stringify(old):null);put.run(key,x.name,x.wowClass,x.discordId,now,id,x.level,x.rank);
    if(x.discordId){const afterClass=x.wowClass??x.before.wow_class;
     if(Number(update.run(x.name,afterClass,x.discordId,x.before.game_nick,x.before.wow_class).changes)!==1)throw Error('PROFILE_CHANGED');
     log.run(id,x.discordId,x.before.game_nick,x.before.wow_class,x.name,afterClass);
    }}
   if(source)db.prepare('INSERT INTO guild_roster_sync_state(source,source_timestamp,request_id) VALUES(?,?,?) ON CONFLICT(source) DO UPDATE SET source_timestamp=excluded.source_timestamp,request_id=excluded.request_id').run(source,sourceTimestamp,requestId);
   db.exec('COMMIT');return {importId:id,characters:plan.length,profiles:plan.filter(x=>x.discordId).length};
  }catch(e){db.exec('ROLLBACK');throw e;}
 }
 function rollback(id,now){
  if(typeof id!=='string'||!Number.isSafeInteger(now))throw Error('INVALID_ROLLBACK');db.exec('BEGIN IMMEDIATE');try{
   const record=db.prepare('SELECT rolled_back_at FROM guild_roster_imports WHERE id=?').get(id);if(!record||record.rolled_back_at!==null)throw Error('INVALID_ROLLBACK');
   for(const x of db.prepare('SELECT * FROM guild_roster_character_changes WHERE import_id=?').all(id)){
    const live=db.prepare('SELECT last_import_id FROM guild_roster_characters WHERE character_key=?').get(x.character_key);if(!live||live.last_import_id!==id)throw Error('ROLLBACK_CONFLICT');
    if(x.before_json){const old=JSON.parse(x.before_json);db.prepare('UPDATE guild_roster_characters SET name=?,wow_class=?,discord_id=?,updated_at=?,last_import_id=?,level=?,rank=? WHERE character_key=?').run(old.name,old.wow_class,old.discord_id,old.updated_at,old.last_import_id,old.level??null,old.rank??null,x.character_key);}
    else db.prepare('DELETE FROM guild_roster_characters WHERE character_key=?').run(x.character_key);
   }
   for(const x of db.prepare('SELECT * FROM guild_roster_changes WHERE import_id=?').all(id)){
    if(Number(update.run(x.before_nick,x.before_class,x.user_id,x.after_nick,x.after_class).changes)!==1)throw Error('ROLLBACK_CONFLICT');
   }
   db.prepare('UPDATE guild_roster_imports SET rolled_back_at=? WHERE id=?').run(now,id);db.exec('COMMIT');return {rolledBack:true};
  }catch(e){db.exec('ROLLBACK');throw e;}
 }
 return {preview:build,apply,rollback};
}
module.exports={preview,createImporter};
