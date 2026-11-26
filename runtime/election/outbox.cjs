'use strict';
// External send is not transactional with SQLite. An interrupted send is
// UNCERTAIN and must be reconciled against Discord before attempting again.
function createOutbox(db, {clock=Date.now}={}) {
 db.exec('CREATE TABLE IF NOT EXISTS election_delivery_attempts (event_id TEXT PRIMARY KEY, attempted_at INTEGER NOT NULL)');
 const attempt=db.prepare('INSERT INTO election_delivery_attempts(event_id,attempted_at) VALUES(?,?) ON CONFLICT(event_id) DO UPDATE SET attempted_at=excluded.attempted_at');
 const attemptTime=db.prepare('SELECT attempted_at FROM election_delivery_attempts WHERE event_id=?');
 const reconciled=db.prepare("UPDATE election_outbox SET message_id=?,delivery_state='PENDING' WHERE event_id=? AND delivery_state='UNCERTAIN'");
 const get=db.prepare('SELECT * FROM election_outbox WHERE event_id=?');
 const claim=db.prepare("UPDATE election_outbox SET delivery_state='INFLIGHT' WHERE event_id=? AND delivery_state='PENDING' AND payload=?");
 const complete=db.prepare("UPDATE election_outbox SET message_id=?,delivery_state=CASE WHEN payload=? THEN 'SENT' ELSE 'PENDING' END WHERE event_id=?");
 const uncertain=db.prepare("UPDATE election_outbox SET delivery_state=CASE WHEN message_id IS NULL THEN 'UNCERTAIN' ELSE 'PENDING' END WHERE event_id=? AND delivery_state='INFLIGHT'");
 const missing=db.prepare("UPDATE election_outbox SET message_id=NULL,delivery_state='PENDING' WHERE event_id=? AND message_id=? AND delivery_state='INFLIGHT'");
 const recover=db.prepare("UPDATE election_outbox SET delivery_state=CASE WHEN message_id IS NULL THEN 'UNCERTAIN' ELSE 'PENDING' END WHERE delivery_state='INFLIGHT'");
 async function deliver(eventId, transport, payload) {
  const row=get.get(eventId); if(!row||row.delivery_state!=='PENDING')return {status:'SKIPPED'};
  if(Number(claim.run(eventId,row.payload).changes)!==1)return {status:'SKIPPED'};
  try {
   let id=row.message_id;
   if(id) await transport.edit(id,payload); else {attempt.run(eventId,clock());id=await transport.send(payload);}
   if(typeof id!=='string'||!id)throw new Error('NO_MESSAGE_ID');
   complete.run(id,row.payload,eventId);
   return {status:'SENT',messageId:id};
  } catch(e) {
   if(row.message_id && e?.code === 10008) { missing.run(eventId,row.message_id); return {status:'MESSAGE_MISSING'}; }
   uncertain.run(eventId);return {status:row.message_id?'RETRY_EDIT':'UNCERTAIN'};
  }
 }
 async function reconcile(eventId,transport) {
  const row=get.get(eventId),a=attemptTime.get(eventId);
  if(!row||row.delivery_state!=='UNCERTAIN'||!a||clock()-a.attempted_at<120000)return {status:'WAIT'};
  try {
   const result=await transport.find(eventId,a.attempted_at);
   if(result?.status==='FOUND'&&typeof result.messageId==='string') {reconciled.run(result.messageId,eventId);return {status:'FOUND'};}
   if(result?.status==='ABSENT') {reconciled.run(null,eventId);return {status:'ABSENT'};}
  } catch(e) { /* keep UNCERTAIN until history is accessible */ }
  return {status:'WAIT'};
 }
 return {deliver,reconcile,recover:()=>recover.run()};
}
module.exports={createOutbox};
