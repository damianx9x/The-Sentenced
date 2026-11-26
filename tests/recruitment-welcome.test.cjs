'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite'),{sendWelcome}=require('../recruitment/welcome.cjs');
test('legacy role and catch-up path never posts to any channel or queues greetings',async()=>{
 const db=new DatabaseSync(':memory:');db.exec("CREATE TABLE members(user_id TEXT PRIMARY KEY,welcomed_at INTEGER); INSERT INTO members VALUES('1',NULL)");
 let channels=0;const args={db,guild:{},target:{id:'1',user:{bot:false}},upsertMember:()=>{},getChannel:()=>{channels++;throw Error('must not send')},now:()=>123};
 assert.equal(await sendWelcome(args),true);assert.equal(await sendWelcome(args),false);assert.equal(channels,0);
 assert.equal(db.prepare('SELECT welcomed_at FROM members').get().welcomed_at,123);db.close();
});
