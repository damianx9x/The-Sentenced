'use strict';
function createOnce(db,input){
 if(!/^\d{17,20}$/.test(input.interactionId||''))throw Error('INVALID_INTERACTION');
 db.exec('CREATE TABLE IF NOT EXISTS raid_create_requests(interaction_id TEXT PRIMARY KEY,raid_id INTEGER NOT NULL,created_at INTEGER NOT NULL)');
 const tx=db.transaction(()=>{
  const old=db.prepare('SELECT raid_id FROM raid_create_requests WHERE interaction_id=?').get(input.interactionId);
  if(old)return {id:old.raid_id,existing:true};
  const inserted=db.prepare("INSERT INTO raids(raid_type,name,scheduled_ts,player_limit,description,created_by,created_at,status) VALUES(?,?,?,?,?,?,?,'ACTIVE')").run(input.type,input.name,input.scheduled,input.limit,input.description,input.userId,input.createdAt);
  const id=Number(inserted.lastInsertRowid);db.prepare('INSERT INTO raid_create_requests VALUES(?,?,?)').run(input.interactionId,id,input.createdAt);return {id,existing:false};
 });
 return tx.immediate();
}
async function publish({db,channel,raidId,kind,payload}){
 if(!['signup','calendar'].includes(kind)||!Number.isSafeInteger(raidId)||raidId<1)throw Error('INVALID_RAID_PUBLISH');
 let message;
 try{message=await channel.send({...payload,allowedMentions:{parse:[]},nonce:`ts-${kind==='signup'?'s':'c'}-${raidId}`,enforceNonce:true});}
 catch{return {ok:false,uncertain:true};}
 try{const column=kind==='signup'?'signup_message_id':'calendar_message_id';const result=db.prepare(`UPDATE raids SET ${column}=? WHERE id=?`).run(message.id,raidId);if(Number(result.changes)!==1)throw Error('RAID_NOT_FOUND');}
 catch{return {ok:false,uncertain:true,url:message.url};}
 return {ok:true,message};
}
module.exports={createOnce,publish};
