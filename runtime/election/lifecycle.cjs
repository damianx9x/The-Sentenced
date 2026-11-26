'use strict';

// Deterministic state transition planning. The adapter must persist each plan in
// a single transaction and only publish after a durable outbox entry exists.
const ROUND_MS = 24 * 60 * 60 * 1000;
function nextAction(state, now) {
 if (!state || !Number.isSafeInteger(now)) throw new Error('INVALID_STATE');
 const {nominationsClose, firstVoteClose, status} = state;
 if (![nominationsClose, firstVoteClose].every(Number.isSafeInteger) || nominationsClose >= firstVoteClose) throw new Error('INVALID_SCHEDULE');
 if (status === 'NOMINATIONS') {
  if (now < nominationsClose) return {type:'WAIT'};
  if (!Array.isArray(state.candidates)) throw new Error('INVALID_CANDIDATES');
  if (state.candidates.length === 0) return {type:'NO_CANDIDATES'};
  if (now >= firstVoteClose) return {type:'MISSED_VOTE_WINDOW'};
  return {type:'OPEN_VOTE', candidates:state.candidates, closesAt:firstVoteClose};
 }
 if (status === 'VOTING') {
  if (!Number.isSafeInteger(state.closesAt) || !Array.isArray(state.results)) throw new Error('INVALID_RESULTS');
  if (now < state.closesAt) return {type:'WAIT'};
  const seen=new Set();
  for (const r of state.results) {
   if (typeof r.id !== 'string' || !r.id || seen.has(r.id) || !Number.isSafeInteger(r.votes) || r.votes<0) throw new Error('INVALID_RESULTS');
   seen.add(r.id);
  }
  if (!state.results.length) return {type:'NO_CANDIDATES'};
  const max=Math.max(...state.results.map(r=>r.votes));
  if (!max) return {type:'NO_VOTES'};
  const leaders=state.results.filter(r=>r.votes===max).map(r=>r.id);
  if (leaders.length===1) return {type:'WINNER', candidateId:leaders[0]};
  return {type:'OPEN_RUNOFF', candidates:leaders, closesAt:now+ROUND_MS};
 }
 if (['NO_CANDIDATES','NO_VOTES','WINNER','MISSED_VOTE_WINDOW'].includes(status)) return {type:'WAIT'};
 throw new Error('INVALID_STATE');
}
module.exports={nextAction,ROUND_MS};
