'use strict';
// Owner's existing Mac SSH bridge reads a bounded, public guild projection.
function safeTitle(value){return Array.from(String(value||'').replace(/[\x00-\x1f\x7f]/g,' ').trim()).slice(0,120).join('');}
function exportSnapshot(db,now=Date.now()){
 // CLOSED means registration has closed, not that the raid was cancelled.
 const raids=db.prepare("SELECT id,name,scheduled_ts,player_limit,status FROM raids WHERE status IN ('ACTIVE','CLOSED') AND scheduled_ts>? ORDER BY scheduled_ts,id LIMIT 20").all(Math.floor(now/1000))
  .map(r=>{const name=safeTitle(r.name);return {id:r.id,title:name&&r.status==='CLOSED'?Array.from(name).slice(0,98).join('')+' • zapisy zamknięte':name,when:r.scheduled_ts,capacity:r.player_limit??0};}).filter(r=>r.title);
 const expeditions=db.prepare("SELECT id,title,expires_at,capacity FROM expeditions WHERE status='OPEN' AND expires_at>? ORDER BY expires_at,id LIMIT 20").all(now)
  .map(e=>({id:e.id,title:safeTitle(e.title),when:Math.floor(e.expires_at/1000),capacity:e.capacity??0})).filter(e=>e.title);
 return {schema:1,generatedAt:Math.floor(now/1000),raids,expeditions};
}
if(require.main===module){
 try{const Database=require('better-sqlite3');const db=new Database('/opt/sentencedbot/data/sentenced.db',{readonly:true,fileMustExist:true});
  try{console.log(JSON.stringify(exportSnapshot(db)))}finally{db.close()}
 }catch{console.error('EVENT_EXPORT_FAILED');process.exitCode=1;}
}
module.exports={exportSnapshot};
