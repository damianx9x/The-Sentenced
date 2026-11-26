'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const createGateway=require('../runtime/integration-service.cjs');

test('a permanently unavailable Discord panel cannot starve later refreshes',async()=>{
 const db=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT)');
 const service=createGateway({db,guild:{},refreshRaid:async id=>{
  if(id<6)throw Error('Missing Discord message');
 }});
 try{
  const insert=db.prepare('INSERT INTO addon_requests VALUES(?,?,?,?,?,?)');
  for(let id=1;id<=6;id++){
   insert.run('member',String(id),'hash','refresh_pending',JSON.stringify({refresh:'raid',raid_id:id}),id);
  }
  await service.retryRefreshes();
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM addon_requests WHERE status='done'").get().count,0);
  await service.retryRefreshes();
  const receipt=db.prepare('SELECT status,result_json FROM addon_requests WHERE request_id=?').get('6');
  assert.equal(receipt.status,'done');
  assert.equal(JSON.parse(receipt.result_json).discord_refreshed,true);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM addon_requests WHERE status='refresh_pending'").get().count,5);
 }finally{service.close();db.close();}
});
