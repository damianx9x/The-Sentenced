'use strict';
const {nextAction}=require('./lifecycle.cjs');

// The caller constructs nominations and ballot stores on the same connection.
// Transition + round snapshot + outbox are committed atomically.
function createEngine(db,{electionId,nominationsClose,firstVoteClose,reminderAt,eventAt}) {
 if(typeof electionId!=='string'||!electionId||![nominationsClose,firstVoteClose].every(Number.isSafeInteger)||nominationsClose>=firstVoteClose) throw new Error('INVALID_CONFIG');
 db.exec(`CREATE TABLE IF NOT EXISTS election_state (
   election_id TEXT PRIMARY KEY,status TEXT NOT NULL,current_round INTEGER NOT NULL DEFAULT 0,
   nominations_close INTEGER NOT NULL,first_vote_close INTEGER NOT NULL
 );
 CREATE TABLE IF NOT EXISTS election_outbox (
   event_id TEXT PRIMARY KEY,election_id TEXT NOT NULL,kind TEXT NOT NULL,payload TEXT NOT NULL,
   delivery_state TEXT NOT NULL DEFAULT 'PENDING', message_id TEXT
 );`);
 db.prepare("INSERT INTO election_state(election_id,status,nominations_close,first_vote_close) VALUES (?,'NOMINATIONS',?,?) ON CONFLICT DO NOTHING").run(electionId,nominationsClose,firstVoteClose);
 const state=db.prepare('SELECT * FROM election_state WHERE election_id=?');
 const nominations=db.prepare('SELECT user_id FROM election_nominations WHERE election_id=? ORDER BY submitted_at,user_id');
 const round=db.prepare('SELECT opens_at,closes_at FROM election_rounds WHERE id=?');
 const results=db.prepare('SELECT candidate_id AS id,votes FROM election_candidates WHERE round_id=? ORDER BY candidate_id');
 const insertRound=db.prepare('INSERT INTO election_rounds(id,opens_at,closes_at) VALUES(?,?,?)');
 const insertCandidate=db.prepare('INSERT INTO election_candidates(round_id,candidate_id) VALUES(?,?)');
 const update=db.prepare('UPDATE election_state SET status=?,current_round=? WHERE election_id=?');
 const outbox=db.prepare('INSERT INTO election_outbox(event_id,election_id,kind,payload) VALUES(?,?,?,?)');
 const once=db.prepare('INSERT INTO election_outbox(event_id,election_id,kind,payload) VALUES(?,?,?,?) ON CONFLICT DO NOTHING');
 function tick(now) {
  if(!Number.isSafeInteger(now)) throw new Error('INVALID_TIME');
  db.exec('BEGIN IMMEDIATE');
  try {
   const s=state.get(electionId);
   if(s.nominations_close!==nominationsClose||s.first_vote_close!==firstVoteClose) throw new Error('CONFIG_DRIFT');
   const info={status:s.status,nominationsClose,firstVoteClose};
   if(s.status==='NOMINATIONS') info.candidates=nominations.all(electionId).map(x=>x.user_id);
   if(s.status==='VOTING') {
    const id=`${electionId}:${s.current_round}`, r=round.get(id); if(!r)throw new Error('MISSING_ROUND');
    info.closesAt=r.closes_at;info.results=results.all(id).map(x=>({id:x.id,votes:Number(x.votes)}));
   }
   if(Number.isSafeInteger(reminderAt)&&Number.isSafeInteger(eventAt)&&now>=reminderAt&&now<eventAt) once.run(`${electionId}:REMINDER:0`,electionId,'REMINDER','{}');
   const action=nextAction(info,now);
   if(action.type==='WAIT'){db.exec('COMMIT');return action;}
   let nextStatus=action.type, nextRound=s.current_round;
   if(action.type==='OPEN_VOTE'||action.type==='OPEN_RUNOFF') {
    nextStatus='VOTING';nextRound++;
    const id=`${electionId}:${nextRound}`;
    insertRound.run(id,now,action.closesAt);
    for(const candidate of action.candidates) insertCandidate.run(id,candidate);
   }
   update.run(nextStatus,nextRound,electionId);
   const eventId=`${electionId}:${action.type}:${nextRound}`;
   outbox.run(eventId,electionId,action.type,JSON.stringify(action));
   if(action.type==='WINNER') once.run(`${electionId}:WINNER_GENERAL:${nextRound}`,electionId,'WINNER_GENERAL',JSON.stringify(action));
   db.exec('COMMIT');return {...action,eventId,round:nextRound};
  } catch(error){db.exec('ROLLBACK');throw error;}
 }
 return {tick};
}
module.exports={createEngine};
