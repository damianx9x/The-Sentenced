'use strict';
const {createElectionStore}=require('./store.cjs');
const {createNominations}=require('./nominations.cjs');
const {createEngine}=require('./engine.cjs');
const {createDiscordAdapter}=require('./discord.cjs');
const {createOutbox}=require('./outbox.cjs');
const {createMessageRenderer}=require('./messages.cjs');
const {createHash}=require('node:crypto');
const SCHEDULE=Object.freeze({nominationsClose:Date.parse('2026-11-25T22:59:00Z'),firstVoteClose:Date.parse('2026-11-29T17:30:00Z'),reminderAt:Date.parse('2026-11-28T17:00:00Z'),eventAt:Date.parse('2026-11-29T17:00:00Z')});
function createElectionRuntime({db,client,guildId,channelId,generalChannelId,allowedRoleIds,ownerId,secret,clock=Date.now,log=()=>{}}){
 if(!db||!client||![guildId,channelId,generalChannelId,ownerId].every(x=>typeof x==='string'&&x)||!Array.isArray(allowedRoleIds)||!allowedRoleIds.length)throw new Error('ELECTION_CONFIG_REQUIRED');
 const electionId='sentenced-2026';
 const nominations=createNominations(db,{closesAt:SCHEDULE.nominationsClose});
 const ballots=createElectionStore(db,secret);
 const engine=createEngine(db,{electionId,...SCHEDULE});
 const adapter=createDiscordAdapter({db,guildId,channelId,electionId,allowedRoleIds,ownerId,nominations,ballots,clock});
 const outbox=createOutbox(db,{clock}),render=createMessageRenderer(db,electionId);
 const seed=db.prepare("INSERT INTO election_outbox(event_id,election_id,kind,payload) VALUES(?,?,'INITIAL','{}') ON CONFLICT DO NOTHING");
 const pending=db.prepare("SELECT * FROM election_outbox WHERE election_id=? AND delivery_state='PENDING' ORDER BY rowid LIMIT 25");
 const uncertain=db.prepare("SELECT * FROM election_outbox WHERE election_id=? AND delivery_state='UNCERTAIN' ORDER BY rowid LIMIT 25");
 const marker=id=>'TS-'+createHash('sha256').update(id).digest('hex').slice(0,16);
 function mark(payload,id) {
  const tag=marker(id), embeds=(payload.embeds||[]).map(x=>({...x}));
  if(embeds.length) embeds[0].footer={text:`The Sentenced • ${tag}`};else embeds.push({footer:{text:`The Sentenced • ${tag}`}});
  return {...payload,embeds};
 }
 async function findMessage(channel,id,attemptedAt) {
  let before;const cutoff=attemptedAt-60000;
  for(let page=0;page<50;page++) {
   const batch=await channel.messages.fetch({limit:100,...(before?{before}: {})});
   const values=[...batch.values()];
   for(const m of values)if(m.author?.id===client.user?.id && m.embeds?.some(e=>e.footer?.text?.includes(marker(id))))return {status:'FOUND',messageId:m.id};
   if(values.length<100)return {status:'ABSENT'};
   const last=values[values.length-1];if(!last?.id||!Number.isFinite(last.createdTimestamp))return {status:'UNKNOWN'};
   if(last.createdTimestamp<cutoff)return {status:'ABSENT'};before=last.id;
  }
  return {status:'UNKNOWN'};
 }
 db.exec('CREATE TABLE IF NOT EXISTS election_publication (event_id TEXT PRIMARY KEY)');
 const unpublished=db.prepare("SELECT * FROM election_outbox WHERE election_id=? AND kind='OPEN_RUNOFF' AND delivery_state='SENT' AND event_id NOT IN (SELECT event_id FROM election_publication)");
 function ensureRunoffDuration() {
  for(const row of unpublished.all(electionId)) {
   db.exec('BEGIN IMMEDIATE');try {
    const action=JSON.parse(row.payload);const round=Number(row.event_id.split(':').at(-1));
    if(!Number.isSafeInteger(round)||!Number.isSafeInteger(action.closesAt))throw new Error('INVALID_RUNOFF');
    const closes=Math.max(action.closesAt,clock()+24*60*60*1000);
    db.prepare('UPDATE election_rounds SET closes_at=? WHERE id=?').run(closes,`${electionId}:${round}`);
    action.closesAt=closes;
    db.prepare("UPDATE election_outbox SET payload=?,delivery_state='PENDING' WHERE event_id=?").run(JSON.stringify(action),row.event_id);
    db.prepare('INSERT INTO election_publication(event_id) VALUES(?)').run(row.event_id);
    db.exec('COMMIT');
   }catch(e){db.exec('ROLLBACK');throw e;}
  }
 }
 let running=false,timer;
 async function tick(){
  if(running)return;running=true;
  try {
   ensureRunoffDuration();
   const st=db.prepare('SELECT status,current_round FROM election_state WHERE election_id=?').get(electionId);
   const waitingForRunoff=st?.status==='VOTING' && st.current_round>1 && !db.prepare('SELECT 1 FROM election_publication WHERE event_id=?').get(`${electionId}:OPEN_RUNOFF:${st.current_round}`);
   if(!waitingForRunoff) engine.tick(clock());
   for(const row of uncertain.all(electionId)) {
    try {
     const channel=await client.channels.fetch(['REMINDER','WINNER_GENERAL'].includes(row.kind)?generalChannelId:channelId);
     if(channel?.guildId===guildId)await outbox.reconcile(row.event_id,{find:(id,at)=>findMessage(channel,id,at)});
    }catch(e){log('ELECTION_RECONCILE_FAILED',row.kind);}
   }
   for(const row of pending.all(electionId)) {
    try {
     const channel=await client.channels.fetch(['REMINDER','WINNER_GENERAL'].includes(row.kind)?generalChannelId:channelId);
     if(!channel || channel.guildId!==guildId || typeof channel.send!=='function')throw new Error('ELECTION_CHANNEL_UNAVAILABLE');
     const result=await outbox.deliver(row.event_id,{send:async payload=>(await channel.send({...payload,nonce:marker(row.event_id),enforceNonce:true})).id,edit:async(id,payload)=>{const msg=await channel.messages.fetch(id);await msg.edit(payload);}},mark(render(row),row.event_id));
     if(result.status==='UNCERTAIN')log('ELECTION_DELIVERY_UNCERTAIN',row.kind);
     if(result.status==='SENT' && row.kind==='OPEN_RUNOFF')ensureRunoffDuration();
    } catch(e) {log('ELECTION_DELIVERY_FAILED',row.kind);}

   }
  }catch(e){log('ELECTION_TICK_FAILED',String(e?.message||'UNKNOWN'));}finally{running=false;}
 }
 async function start(){outbox.recover();seed.run(`${electionId}:INITIAL:0`,electionId);await tick();timer=setInterval(()=>void tick(),30000);timer.unref?.();}
 function stop(){if(timer)clearInterval(timer);}
 return {start,stop,tick,handle:adapter.handle};
}
module.exports={createElectionRuntime,SCHEDULE};
