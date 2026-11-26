'use strict';
function createNominations(db, { closesAt }) {
 if (!Number.isSafeInteger(closesAt)) throw new Error('INVALID_DEADLINE');
 db.exec(`CREATE TABLE IF NOT EXISTS election_nominations (
  election_id TEXT NOT NULL, user_id TEXT NOT NULL, character_class TEXT NOT NULL,
  availability TEXT NOT NULL, motivation TEXT NOT NULL, balance TEXT NOT NULL,
  submitted_at INTEGER NOT NULL, PRIMARY KEY(election_id,user_id)
 )`);
 const save=db.prepare(`INSERT INTO election_nominations(election_id,user_id,character_class,availability,motivation,balance,submitted_at)
 VALUES(?,?,?,?,?,?,?) ON CONFLICT(election_id,user_id) DO UPDATE SET
 character_class=excluded.character_class,availability=excluded.availability,motivation=excluded.motivation,balance=excluded.balance,submitted_at=excluded.submitted_at`);
 const list=db.prepare('SELECT user_id,character_class,availability,motivation,balance,submitted_at FROM election_nominations WHERE election_id=? ORDER BY submitted_at,user_id');
 function submit({electionId,userId,characterClass,availability,motivation,balance,now,eligible}) {
  if (eligible !== true) throw new Error('NOT_ELIGIBLE');
  if (!Number.isSafeInteger(now) || now >= closesAt) throw new Error('NOMINATIONS_CLOSED');
  if (![electionId,userId].every(x=>typeof x==='string' && x.length>0 && x.length<=128)) throw new Error('INVALID_ID');
  const fields=[characterClass,availability,motivation,balance];
  if (!fields.every(x=>typeof x==='string' && x.trim().length>0 && x.trim().length<=1000)) throw new Error('INVALID_ANSWER');
  save.run(electionId,userId,...fields.map(x=>x.trim()),now);
 }
 return {submit,list:electionId=>list.all(electionId)};
}
module.exports={createNominations};
