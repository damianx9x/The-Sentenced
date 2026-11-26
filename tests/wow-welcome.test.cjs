'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite');
const {ensureQueue,enqueueMemberWelcome,exchangeWelcomes}=require('../recruitment/wow-welcome.cjs');
test('old queued and new welcomes are not sent to game after thread-only policy',()=>{
 const db=new DatabaseSync(':memory:');ensureQueue(db);db.prepare('INSERT INTO wow_welcome_outbox(user_id,text,created_at) VALUES(?,?,?)').run('123','Welcome',1800000000);
 assert.equal(enqueueMemberWelcome(db,'456',1800000000000),false);
 assert.deepEqual(exchangeWelcomes(db,{},1800000000000).welcomes,[]);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM wow_welcome_outbox').get().n,1);
 assert.throws(()=>exchangeWelcomes(db,{confirmed:['bad']},1800000000000));db.close();
});
