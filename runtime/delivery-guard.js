'use strict';
function schema(db){db.exec(`CREATE TABLE IF NOT EXISTS delivery_effects(effect_key TEXT PRIMARY KEY,kind TEXT NOT NULL,recipient TEXT NOT NULL,day TEXT NOT NULL,status TEXT NOT NULL,created_at INTEGER NOT NULL,message_id TEXT,error TEXT);`);}
// Durable at-most-once attempts. A crash/ambiguous send is never blindly retried.
// This deliberately prefers a missed notification over duplicate private/public spam.
async function deliverOnce(db,{key,kind,recipient,day,limit=100000,userLimit=100000,minIntervalMs=0,minRecipientIntervalMs=0},send){
 schema(db);
 const reserved=db.transaction(()=>{
  if(db.prepare('SELECT 1 FROM delivery_effects WHERE effect_key=?').get(key))return 'skipped';
  if(minIntervalMs>0&&db.prepare('SELECT 1 FROM delivery_effects WHERE kind=? AND created_at>? LIMIT 1').get(kind,Date.now()-minIntervalMs))return 'rate_limited';
  if(minRecipientIntervalMs>0&&db.prepare('SELECT 1 FROM delivery_effects WHERE kind=? AND recipient=? AND created_at>? LIMIT 1').get(kind,recipient,Date.now()-minRecipientIntervalMs))return 'rate_limited';
  if(db.prepare('SELECT count(*) n FROM delivery_effects WHERE kind=? AND day=?').get(kind,day).n>=limit)return 'skipped';
  if(db.prepare('SELECT count(*) n FROM delivery_effects WHERE kind=? AND recipient=? AND day=?').get(kind,recipient,day).n>=userLimit)return 'skipped';
  db.prepare("INSERT INTO delivery_effects(effect_key,kind,recipient,day,status,created_at) VALUES(?,?,?,?,'claimed',?)").run(key,kind,recipient,day,Date.now());return 'reserved';
 })();
 if(reserved!=='reserved')return {status:reserved};
 try{const message=await send();db.prepare("UPDATE delivery_effects SET status='sent',message_id=? WHERE effect_key=?").run(message?.id||null,key);return {status:'sent',message};}
 catch(e){const definitive=[50007,50013,10003].includes(Number(e.code));db.prepare('UPDATE delivery_effects SET status=?,error=? WHERE effect_key=?').run(definitive?'failed':'uncertain',String(e.code||e.name||'send_error').slice(0,50),key);return {status:definitive?'failed':'uncertain'};}
}
module.exports={schema,deliverOnce};
