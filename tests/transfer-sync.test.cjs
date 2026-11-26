'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {parseRequest,runTransfer,encodeSnapshot}=require('../runtime/transfer-sync.cjs');
const {hash}=require('../runtime/guild-actions.cjs');
const id='0123456789abcdef',character='Icex Jenkins-Forever',hex=s=>Buffer.from(s).toString('hex'),now=1800000000000;
const wire=(op='snapshot',data='')=>`TSB1|Q|${id}|${hex(character)}|${op}|${data}`;
const raid={id:1,name:'Żmija | próba',scheduled:1800000100,limit:10,status:'ACTIVE',revision:'a'.repeat(64),ownStatus:'YES'};
function setup({owner='u1',codeUser='u1',receipt,memberError=false,outcome={id,status:'snapshot',snapshot:{userLabel:'Icex',raids:[raid]}}}={}){
 let calls=0;
 const db={prepare:sql=>({get:()=>sql.includes('addon_links')?{user_id:owner}:sql.includes('addon_pair_codes')?{user_id:codeUser,expires_at:now+1000}:receipt})};
 const service={member:async()=>{if(memberError)throw Error('secret')},perform:async(_character,_cmd,expectedUserId)=>{assert.equal(expectedUserId,'u1');calls++;return outcome},snapshot:async()=>({userLabel:'Icex',raids:[raid]})};
 return {db,service,calls:()=>calls};
}
test('parses exact Forever full name and bounded operations',()=>{
 assert.equal(parseRequest(wire()).character,character);
 assert.deepEqual(parseRequest(wire('raid.signup','1:MAYBE:'+raid.revision)).cmd.payload,{raid_id:1,status:'MAYBE'});
 for(const bad of [wire()+'|',wire('chat.send'),wire('raid.signup','0:YES:'+raid.revision),wire('pair','x'),wire().replace(hex(character),'ff'),wire()+'\n',wire().replace(id,'A'.repeat(16)),wire().repeat(20)])assert.throws(()=>parseRequest(bad));
});
test('member snapshot is authenticated and exact linked account is required',async()=>{
 const good=setup();const result=await runTransfer({...good,userId:'u1',wire:wire(),now});
 assert.ok(result.startsWith('TSB1|S|'+id+'|1800000000|'+hex(character)));assert.match(result,/1:1800000100:10:ACTIVE:/);assert.equal(good.calls(),1);
 const other=setup({owner:'other'});assert.match(await runTransfer({...other,userId:'u1',wire:wire(),now}),/^TSB1\|E\|/);assert.equal(other.calls(),0);
 const denied=setup({memberError:true});assert.match(await runTransfer({...denied,userId:'u1',wire:wire(),now}),/^TSB1\|E\|/);assert.equal(denied.calls(),0);
});
test('pair code belongs to current Discord member; exact receipt allows safe duplicate',async()=>{
 const pair=wire('pair','a'.repeat(18));
 const other=setup({codeUser:'other'});assert.match(await runTransfer({...other,userId:'u1',wire:pair,now}),/^TSB1\|E\|/);assert.equal(other.calls(),0);
 const accepted=setup({outcome:{id,status:'accepted'}});assert.match(await runTransfer({...accepted,userId:'u1',wire:pair,now}),/^TSB1\|S\|/);
 const cmd=parseRequest(pair).cmd;const replay=setup({codeUser:'other',receipt:{payload_hash:hash(cmd)},outcome:{id,status:'accepted'}});assert.match(await runTransfer({...replay,userId:'u1',wire:pair,now}),/^TSB1\|S\|/);
 const changed=setup({codeUser:'other',receipt:{payload_hash:'different'}});assert.match(await runTransfer({...changed,userId:'u1',wire:pair,now}),/^TSB1\|E\|/);
});
test('conflict produces error, no optimistic success; refresh pending is explicit',async()=>{
 const conflict=setup({outcome:{id,status:'conflict',error:'Skład zmienił się'}});assert.match(await runTransfer({...conflict,userId:'u1',wire:wire('raid.signup','1:YES:'+raid.revision),now}),/^TSB1\|E\|/);
 const pending=setup({outcome:{id,status:'refresh_pending'}});assert.ok((await runTransfer({...pending,userId:'u1',wire:wire('raid.signup','1:YES:'+raid.revision),now})).includes('|refresh_pending|'));
});
test('bounded projection includes only future active/closed records; untrusted strings are hex',()=>{
 const result=encodeSnapshot({id,character,snapshot:{userLabel:'Icex',raids:[{...raid,id:3,scheduled:1799999999},{...raid,status:'CANCELLED'},...Array.from({length:12},(_,i)=>({...raid,id:i+10}))]},status:'snapshot',now});
 assert.equal(result.split('|').length,17);assert.ok(!result.includes('Żmija'));assert.ok(!result.includes('CANCELLED'));
});
test('real integration service applies a raid signup once and fences a different Discord principal',async()=>{
 const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(':memory:');let depth=0;
 db.transaction=fn=>(...args)=>{if(depth)return fn(...args);db.exec('BEGIN');depth++;try{const result=fn(...args);db.exec('COMMIT');return result}catch(e){db.exec('ROLLBACK');throw e}finally{depth--}};
 db.exec(`CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT);CREATE TABLE members(user_id TEXT PRIMARY KEY,game_nick TEXT,plans_forever TEXT,wow_class TEXT,wow_role TEXT,played_before_ts TEXT,old_ts_nick TEXT,interests TEXT);
 CREATE TABLE raids(id INTEGER PRIMARY KEY,name TEXT,description TEXT,status TEXT,scheduled_ts INTEGER,player_limit INTEGER);CREATE TABLE raid_signups(raid_id INTEGER,user_id TEXT,status TEXT,updated_at INTEGER,PRIMARY KEY(raid_id,user_id));CREATE TABLE polls(id INTEGER,guild_id TEXT);CREATE TABLE expeditions(id INTEGER,status TEXT,expires_at INTEGER);CREATE TABLE expedition_members(expedition_id INTEGER,user_id TEXT,wow_role TEXT);`);
 db.prepare('INSERT INTO members VALUES(?,?,?,?,?,?,?,?)').run('u1','Icex Jenkins','TAK','Paladin','TANK','TAK','','');
 const scheduled=Math.floor(Date.now()/1000)+86400;db.prepare('INSERT INTO raids VALUES(?,?,?,?,?,?)').run(1,'Próba','', 'ACTIVE',scheduled,10);
 const channels=new Map([['zapisy',{id:'12345678901234567',guildId:'guild',name:'zapisy',type:0,permissionsFor:()=>({has:()=>true})}]]);
 const guild={id:'guild',members:{fetch:async({user})=>({id:user,displayName:'Icex'})},channels:{cache:channels,fetch:async ident=>ident?channels.get('zapisy'):channels}};
 const service=require('../runtime/integration-service.cjs')({db,guild,hasPlayer:()=>true,hasStaff:()=>false,refreshProfile:async()=>{},refreshRaid:async()=>{},getChannel:()=>channels.get('zapisy')});
 try{
  db.prepare('INSERT INTO addon_links VALUES(?,?,?)').run(character,'u1',Date.now());
  const {raidState}=require('../runtime/guild-actions.cjs');const revision=raidState(db,1,'u1').revision;
  const signup=wire('raid.signup','1:YES:'+revision);
  const first=await runTransfer({service,db,userId:'u1',wire:signup});assert.match(first,/\|accepted\|/);
  assert.equal(db.prepare('SELECT status FROM raid_signups WHERE raid_id=1 AND user_id=?').get('u1').status,'YES');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM addon_requests').get().n,1);
  const duplicate=await runTransfer({service,db,userId:'u1',wire:signup});assert.match(duplicate,/\|accepted\|/);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM addon_requests').get().n,1);
  await assert.rejects(service.perform(character,{id:'aaaaaaaaaaaaaaaa',operation:'raid.signup',payload:{raid_id:1,status:'NO'},expected_revision:raidState(db,1,'u1').revision},'other'),/Powiązanie/);
  assert.equal(db.prepare('SELECT status FROM raid_signups WHERE user_id=?').get('u1').status,'YES');
 }finally{service.close();db.close()}
});

test('staff reply uses a separate private wire type and requires the paired Discord principal',async()=>{
 const application={id:'123456789012345678',revision:4,fields:[{name:'Nick w grze',value:'Łotr'},{name:'Styl gry',value:'PvE'}]};
 assert.equal(parseRequest(wire('staff.review.list','1')).cmd.payload.page,1);
 assert.throws(()=>parseRequest(wire('staff.review.list','1001')));
 const command=wire('staff.review.decide','1:approve:'+application.id+':4');
 assert.deepEqual(parseRequest(command).cmd.payload,{page:1,action:'approve',user_id:application.id,revision:4});
 const outcome={status:'accepted',staff:{page:1,hasMore:false,applications:[application]},decision:{state:'APPROVED'}};
 const test=setup({outcome});
 const reply=await runTransfer({...test,userId:'u1',wire:command,now});
 assert.match(reply,/^TSB1\|K\|/);assert.match(reply,/\|1\|0\|APPROVED\|/);
 assert.ok(reply.includes(hex('Łotr'))&&!reply.includes('Łotr'));
 const other=setup({owner:'other',outcome});
 assert.match(await runTransfer({...other,userId:'u1',wire:command,now}),/^TSB1\|E\|/);
 assert.equal(other.calls(),0);
});

test('private staff worker accepts only the owner paired character and bounded decisions',async()=>{
 const {DatabaseSync}=require('node:sqlite');
 const {createStaffExchange}=require('../runtime/staff-local-bridge.cjs');
 const db=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT);CREATE TABLE addon_links(character TEXT PRIMARY KEY,user_id TEXT UNIQUE);CREATE TABLE ts_onboarding_gate(guild_id TEXT,user_id TEXT,state TEXT,submitted_revision INTEGER,decision_actor TEXT)');
 db.prepare('INSERT INTO addon_links VALUES(?,?)').run(character,'u1');
 const calls=[];
 const staff={page:1,hasMore:false,applications:[]};
 const service={member:async id=>assert.equal(id,'u1'),perform:async(name,cmd,actor)=>{
  assert.equal(name,character);assert.equal(actor,'u1');calls.push(cmd.operation);
  return cmd.operation==='staff.review.decide'?{status:'accepted',decision:{state:'APPROVED'},staff}:{status:'snapshot',staff};
 }};
 const exchange=createStaffExchange({db,guild:{id:'g1',ownerId:'u1'},service,clock:()=>now});
 try{
  const fresh=await exchange({});
  assert.equal(fresh.status,'ready');assert.match(fresh.queue,/^TSB1\|K\|/);
  const decision={wire:wire('staff.review.decide','1:approve:123456789012345678:3'),createdAt:Math.floor(now/1000)};
  const expired={...decision,createdAt:decision.createdAt-901};
  assert.equal((await exchange({decision:expired})).acknowledgement,undefined);
  db.prepare('INSERT INTO ts_onboarding_gate VALUES(?,?,?,?,?)').run('g1','123456789012345678','APPROVED',3,'u1');
  const recovered=await exchange({decision:expired});
  assert.match(recovered.acknowledgement,/^TSB1\|K\|0123456789abcdef\|/);
  assert.match(recovered.acknowledgement,/\|APPROVED$/);
  assert.equal(calls.filter(name=>name==='staff.review.decide').length,0,'expired requests must never be executed');
  db.prepare('UPDATE ts_onboarding_gate SET decision_actor=?').run('other');
  assert.equal((await exchange({decision:expired})).acknowledgement,undefined);
  calls.length=0;
  await assert.rejects(exchange({decision:{...decision,wire:decision.wire.replace(hex(character),hex('Other-Realm'))}}),/INVALID/);
  const result=await exchange({decision});
  assert.match(result.acknowledgement,/\|APPROVED$/);
  assert.deepEqual(calls,['staff.review.decide','staff.review.list']);
 }finally{db.close()}
});

test('staff sends Polish text using live authorization, stable channel ID and a single receipt',async()=>{
 const {DatabaseSync}=require('node:sqlite');
 const {CHANNEL_IDS}=require('../runtime/guild-channel-ids.cjs');
 const db=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT)');
 const guildId='1549146537802600568',messages=[];
 const principal={id:'u1',displayName:'Żółw *Kadra*'},bot={id:'bot'};
 let staff=true,botCanSend=true,renamed='new-discord-name';
 const guild={id:guildId,members:{fetch:async()=>principal,me:bot},channels:{fetch:async(channel,opts)=>{
  assert.equal(channel,CHANNEL_IDS['ogólny']);assert.equal(opts.force,true);
  return {guildId,type:0,name:renamed,permissionsFor:m=>({has:()=>m!==bot||botCanSend}),send:async payload=>{
   messages.push(payload);return {id:'123456789012345678'};
  }};
 }}};
 const service=require('../runtime/integration-service.cjs')({db,guild,hasPlayer:()=>true,authorizeStaff:async()=>{
  if(!staff)throw Error('OFFICER_AUTHORIZATION_MISSING');return {moderator:principal};
 }});
 try{
  db.prepare('INSERT INTO addon_links VALUES(?,?,?)').run(character,'u1',now);
  const post=wire('staff.post','general:'+hex('Żółć @everyone https://example.com/obraz'));
  const invoke=(request)=>runTransfer({service,db,userId:'u1',wire:request,now});
  assert.equal(parseRequest(post).cmd.payload.channel,'general');
  assert.match(await invoke(post),/^TSB1\|P\|/);
  assert.match(await invoke(post),/^TSB1\|P\|/);
  assert.equal(messages.length,1);
  assert.match(messages[0].content,/Kadra The Sentenced · Żółw Kadra/);
  assert.deepEqual(messages[0].allowedMentions,{parse:[]});
  staff=false;
  assert.match(await invoke(post),/^TSB1\|E\|/);
  staff=true;botCanSend=false;
  assert.match(await invoke(post),/^TSB1\|E\|/);
  assert.throws(()=>parseRequest(wire('staff.post','general:'+hex('a'.repeat(381)))));
  assert.throws(()=>parseRequest(wire('staff.post','staff:'+hex('test'))));
  assert.equal(messages.length,1);
 }finally{service.close();db.close();}
});
