'use strict';const {test}=require('node:test'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite'),{createPublicApplications}=require('../runtime/recruitment/public.cjs');
test('public application shows complete answers and updates same thread',async()=>{
 const db=new DatabaseSync(':memory:'),events=[];let message;const thread={id:'t',parentId:'forum',archived:false,fetchStarterMessage:async()=>({author:{id:'bot'},edit:async p=>events.push(['edit',p])}),setName:async n=>events.push(['name',n]),setAppliedTags:async t=>events.push(['tags',t]),send:async payload=>{events.push(['welcome',payload]);return {id:'welcome'}}};
 const forum={type:15,availableTags:[{name:'Oczekujące',id:'pending'},{name:'Ostatnie',id:'recent'}],threads:{create:async p=>{message=p;return thread}}};const guild={client:{user:{id:'bot'}},channels:{fetch:async id=>id==='forum'?forum:thread}};const pub=createPublicApplications({db,guild,forumId:'forum'});const app={gameNick:'Nick',wowClass:'Mage',firstName:'PRIVATE-NAME',age:42};
 assert.equal((await pub.update('123456789012345678',app,'PENDING')).status,'CREATED');assert.equal(JSON.stringify(message).includes('PRIVATE-NAME'),true);assert.equal(JSON.stringify(message).includes('42'),true);assert.deepEqual(message.message.components,[]);assert.deepEqual(message.appliedTags,['pending']);
 assert.equal((await pub.update('123456789012345678',app,'APPROVED')).status,'UPDATED');assert.deepEqual(events.at(-2),['tags',['recent']]);
 const welcome=events.at(-1)[1];
 assert.match(welcome.content,/Gniewna Jaga/);
 assert.deepEqual(welcome.allowedMentions,{parse:[],users:['123456789012345678']});
 await pub.update('123456789012345678',app,'APPROVED');
 assert.equal(events.filter(([action])=>action==='welcome').length,1);
});
test('uncertain creation is not retried blindly',async()=>{const db=new DatabaseSync(':memory:');let calls=0;const forum={type:15,availableTags:[{name:'Oczekujące',id:'p'}],threads:{create:async()=>{calls++;throw Error('timeout')}}};const pub=createPublicApplications({db,guild:{channels:{fetch:async()=>forum}},forumId:'f'});await assert.rejects(pub.update('123456789012345678',{gameNick:'Nick'},'PENDING'));assert.equal((await pub.update('123456789012345678',{gameNick:'Nick'},'PENDING')).status,'UNCERTAIN');assert.equal(calls,1);});

test('concurrent approval while creating does not make a second public post',async()=>{
 const db=new DatabaseSync(':memory:');let release;let calls=0;const gate=new Promise(r=>release=r),events=[];
 const thread={id:'t',parentId:'forum',archived:false,fetchStarterMessage:async()=>({author:{id:'bot'},edit:async()=>{}}),setName:async()=>{},setAppliedTags:async x=>events.push(x)};
 const forum={type:15,availableTags:[{name:'Oczekujące',id:'p'},{name:'Ostatnie',id:'r'}],threads:{create:async()=>{calls++;await gate;return thread}}};const guild={client:{user:{id:'bot'}},channels:{fetch:async id=>id==='forum'?forum:thread}};const p=createPublicApplications({db,guild,forumId:'forum'}),a={gameNick:'Nick'};
 const first=p.update('123456789012345678',a,'PENDING');await new Promise(r=>setImmediate(r));const second=await p.update('123456789012345678',a,'APPROVED');assert.equal(second.status,'CREATING');release();await first;assert.equal(calls,1);assert.deepEqual(events.at(-1),['r']);
});

test('concurrent edits keep the latest staff decision when an older edit is slow',async()=>{
 const db=new DatabaseSync(':memory:');let release,started;const gate=new Promise(r=>release=r),entered=new Promise(r=>started=r),seen=[];
 const thread={id:'t',parentId:'forum',archived:false,fetchStarterMessage:async()=>({author:{id:'bot'},edit:async p=>{if(p.content.includes('Oczekuje')){started();await gate}seen.push(p.content)}}),setName:async()=>{},setAppliedTags:async()=>{}};
 const forum={type:15,availableTags:[{name:'Oczekujące',id:'p'},{name:'Ostatnie',id:'r'}],threads:{create:async()=>thread}};const guild={client:{user:{id:'bot'}},channels:{fetch:async id=>id==='forum'?forum:thread}};
 const p=createPublicApplications({db,guild,forumId:'forum'}),a={gameNick:'Nick'},id='123456789012345678';await p.update(id,a,'PENDING');
 const first=p.update(id,a,'PENDING');await entered;const second=p.update(id,a,'APPROVED');await new Promise(r=>setImmediate(r));release();await Promise.all([first,second]);
 assert.match(seen.at(-1),/Przyjęto do gildii/);assert.equal(db.prepare('SELECT desired_status FROM ts_public_applications WHERE user_id=?').get(id).desired_status,'APPROVED');
});

test('a delayed forum lookup cannot apply an outdated status after approval',async()=>{
 const db=new DatabaseSync(':memory:');let release,started,delay=false;const gate=new Promise(r=>release=r),entered=new Promise(r=>started=r),seen=[];
 const thread={id:'t',parentId:'forum',archived:false,fetchStarterMessage:async()=>({author:{id:'bot'},edit:async p=>seen.push(p.content)}),setName:async()=>{},setAppliedTags:async()=>{}};
 const forum={type:15,availableTags:[{name:'Oczekujące',id:'p'},{name:'Ostatnie',id:'r'}],threads:{create:async()=>thread}};const guild={client:{user:{id:'bot'}},channels:{fetch:async id=>{if(id!=='forum')return thread;if(delay){delay=false;started();await gate}return forum}}};
 const p=createPublicApplications({db,guild,forumId:'forum'}),a={gameNick:'Nick'},id='123456789012345678';await p.update(id,a,'PENDING');delay=true;
 const first=p.update(id,a,'PENDING');await entered;const second=p.update(id,a,'APPROVED');await second;release();assert.equal((await first).status,'SUPERSEDED');assert.equal(seen.length,1);assert.match(seen[0],/Przyjęto do gildii/);
});

test('full application is ephemeral only for current GM or officer on matching thread',async()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE ts_onboarding_gate(user_id TEXT PRIMARY KEY,application_json TEXT)');const guild={id:'g',ownerId:'owner'};const p=createPublicApplications({db,guild,forumId:'f'});
 db.prepare('INSERT INTO ts_public_applications VALUES(?,?,?,?,?)').run('123456789012345678','thread','READY','APPROVED',1);db.prepare('INSERT INTO ts_onboarding_gate VALUES(?,?)').run('123456789012345678',JSON.stringify({wasMember:'NIE',firstName:'PrivateName',age:42,raidPlan:false}));
 async function click(role,channel='thread'){let result,flags;const i={customId:'pubapp:view',guildId:'g',channelId:channel,channel:{parentId:'f'},user:{id:'person'},guild:{members:{fetch:async()=>({id:'person',pending:false,user:{bot:false},roles:{cache:{some:fn=>fn({name:role})}}})}},deferReply:async x=>{flags=x.flags},editReply:async x=>{result=x}};await p.handle(i);assert.equal(flags,64);return result;}
 let result=await click('Member');assert.doesNotMatch(JSON.stringify(result),/PrivateName|42/);assert.match(result.content,/wyłącznie/);
 result=await click('Oficer');assert.match(JSON.stringify(result),/PrivateName/);assert.match(JSON.stringify(result),/42/);assert.match(JSON.stringify(result),/Nie/);
 result=await click('Oficer','wrong');assert.doesNotMatch(JSON.stringify(result),/PrivateName/);
});
