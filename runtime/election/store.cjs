'use strict';
const { createHmac } = require('node:crypto');

// Uses the bot's existing SQLite connection. No user-to-choice row is stored.
// An operator with live DB or interaction access can still correlate activity;
// this is ballot privacy, not cryptographic end-to-end anonymity.
function createElectionStore(db, secret) {
  if (!Buffer.isBuffer(secret) || secret.length < 32) throw new Error('ELECTION_SECRET_REQUIRED');
  db.exec(`
    CREATE TABLE IF NOT EXISTS election_rounds (
      id TEXT PRIMARY KEY, opens_at INTEGER NOT NULL, closes_at INTEGER NOT NULL,
      CHECK(opens_at < closes_at)
    );
    CREATE TABLE IF NOT EXISTS election_candidates (
      round_id TEXT NOT NULL, candidate_id TEXT NOT NULL, votes INTEGER NOT NULL DEFAULT 0 CHECK(votes >= 0),
      PRIMARY KEY(round_id, candidate_id), FOREIGN KEY(round_id) REFERENCES election_rounds(id)
    );
    CREATE TABLE IF NOT EXISTS election_voters (
      round_id TEXT NOT NULL, voter_token TEXT NOT NULL,
      PRIMARY KEY(round_id, voter_token), FOREIGN KEY(round_id) REFERENCES election_rounds(id)
    );
  `);
  db.exec('CREATE TABLE IF NOT EXISTS election_secret_verifier (id INTEGER PRIMARY KEY CHECK(id=1), verifier TEXT NOT NULL)');
  const verifier=createHmac('sha256',secret).update('sentenced-election-secret-verifier-v1').digest('hex');
  db.prepare('INSERT INTO election_secret_verifier(id,verifier) VALUES (1,?) ON CONFLICT DO NOTHING').run(verifier);
  if(db.prepare('SELECT verifier FROM election_secret_verifier WHERE id=1').get().verifier!==verifier) throw new Error('ELECTION_SECRET_MISMATCH');
  const getRound = db.prepare('SELECT opens_at, closes_at FROM election_rounds WHERE id = ?');
  const getCandidate = db.prepare('SELECT 1 FROM election_candidates WHERE round_id = ? AND candidate_id = ?');
  const insertVoter = db.prepare('INSERT INTO election_voters(round_id, voter_token) VALUES (?, ?) ON CONFLICT DO NOTHING');
  const increment = db.prepare('UPDATE election_candidates SET votes = votes + 1 WHERE round_id = ? AND candidate_id = ?');
  function vote({roundId, voterId, candidateId, now}) {
    if (![roundId, voterId, candidateId].every(x => typeof x === 'string' && x.length > 0 && x.length <= 128) || !Number.isSafeInteger(now)) throw new Error('INVALID_BALLOT');
    const token = createHmac('sha256', secret).update(JSON.stringify([roundId, voterId])).digest('hex');
    db.exec('BEGIN IMMEDIATE');
    try {
      const round = getRound.get(roundId);
      if (!round || now < round.opens_at || now >= round.closes_at) throw new Error('VOTING_CLOSED');
      if (!getCandidate.get(roundId, candidateId)) throw new Error('UNKNOWN_CANDIDATE');
      if (Number(insertVoter.run(roundId, token).changes) !== 1) throw new Error('ALREADY_VOTED');
      if (Number(increment.run(roundId, candidateId).changes) !== 1) throw new Error('VOTE_NOT_RECORDED');
      db.exec('COMMIT');
      return {accepted:true};
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  return { vote };
}
module.exports = { createElectionStore };
