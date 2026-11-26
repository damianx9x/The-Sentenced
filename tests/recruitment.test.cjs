'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const root='../runtime/ts-onboarding-v6/src/';
const {validApplication}=require(root+'policy.cjs');
const {termsHash,GateStore}=require(root+'gate-store.cjs');
const {branchCard,staffReview,termsCard,startPanel}=require(root+'discord-payloads.cjs');
const {nextStep,STEPS}=require(root+'wizard.cjs');
const {createRuntime,channelAccess,planChannelRepair}=require(root+'ts-onboarding-runtime.cjs');
const fs=require('node:fs');
const rules=fs.readFileSync(require('node:path').join(__dirname,'../payload/ts-onboarding-v6/content/regulamin.md'),'utf8');
const guildId='1549146537802600568';const applicantId='123456789012345678';const officerId='234567890123456789';
const roleIds={Member:'1549371118366892132',Trial:'1549371119855996948','Oczekujący':'1549372882713321522','Dostęp_zatwierdzony':'1573050779164475544', GM:'1549371114415988797',Oficer:'1549371116034719795','Raid Lider':'1549371117079109643',Veteran:'1549371121525067786',SentencedBot:'1549363706411094149',Ekipa_WWW:'1572327263880478922'};
const startId='1549398541149933683',waitId='1549398553313677355',staffId='1549398574528339968',generalId='1549398546896388276';
const fresh={wasMember:'NIE',firstName:'Ala',age:25,wowClass:'Druid',race:'Tauren',spec:'Balance',professions:['Herbalism','Alchemy'],playstyles:['Casual','PvP'],raidPlan:false};
const old={wasMember:'TAK',oldNick:'DawnyNick'};
function collectButtons(obj){return obj.components.flatMap(x=>x.components).map(x=>x.custom_id).filter(Boolean);}

test('12 points in rules with hash and two separate panels',()=>{
 assert.equal((rules.match(/^## \d\d\./gm)||[]).length,12);
 const t=termsCard(rules,'2026-11-20','https://example.org/#regulamin');
 assert.equal(t.hash,termsHash(rules));assert.ok(collectButtons(t.payload).some(x=>x.startsWith('ts:terms:accept:')));
 assert.deepEqual(collectButtons(startPanel()),['ts:apply:start:v1']);
});
test('branch TA K asks nick, NIE has required fields and no about',()=>{
 assert.equal(validApplication(old).allowed,true);
 assert.equal(validApplication({wasMember:'TAK'}).allowed,false);
 assert.equal(validApplication(fresh).allowed,true);
 assert.equal(validApplication({...fresh,raidPlan:true}).allowed,false);
 assert.equal(validApplication({...fresh,raidPlan:true,raidHoursWeek:4,raidDays:['pon','sr','pt']}).allowed,true);
 assert.equal(validApplication({...fresh,playstyles:['Casual','Casual']}).allowed,false);
 assert.equal(validApplication({...fresh,raidPlan:false,raidDays:['pon']}).allowed,false);
 assert.equal(validApplication({...fresh,age:0}).allowed,false);
 assert.ok(collectButtons(branchCard()).includes('ts:apply:branch:yes'));
 assert.ok(collectButtons(branchCard()).includes('ts:apply:branch:no'));
});
test('staff review card after submit, no auto approval',()=>{
 const p=staffReview({userId:applicantId,wasMember:'NIE',application:fresh,revision:8});
 assert.equal(p.allowedMentions.parse.length,0);
 assert.deepEqual(collectButtons(p),[`ts:review:approve:${applicantId}:8`,`ts:review:reject:${applicantId}:8`]);
 assert.ok(p.embeds[0].fields.some(x=>x.name==='Style'));
});
test('store transitions must require consent, exact revision and officer',()=>{
 const db=new DatabaseSync(':memory:');const store=new GateStore(db,guildId);store.migrate();
 store.init(applicantId,10);const hash=termsHash(rules);
 assert.equal(store.submit(applicantId,hash,old,11,{nativePending:false}).ok,false);
 assert.equal(store.accept(applicantId,hash,12,{nativePending:true}).ok,false);
 assert.equal(store.accept(applicantId,hash,13,{nativePending:false}).ok,true);
 assert.equal(store.draft(applicantId,hash,old,14,{nativePending:false}).ok,true);
 assert.equal(store.submit(applicantId,hash,old,15,{nativePending:false}).ok,true);
 assert.equal(store.get(applicantId).state,'SUBMITTED');
 assert.equal(store.reserveStaffDispatch(applicantId,16).ok,true);
 assert.equal(store.recordStaffMessage(applicantId,'345678901234567890',17).ok,true);
 const rev=store.get(applicantId).submitted_revision;
 assert.equal(store.decide(applicantId,hash,{id:officerId,guildId,authorized:false,isBot:false,applicationRevision:rev},'approve',18,{nativePending:false,memberPresent:true}).ok,false);
 assert.equal(store.decide(applicantId,hash,{id:officerId,guildId,authorized:true,isBot:false,applicationRevision:rev-1},'approve',18,{nativePending:false,memberPresent:true}).ok,false);
 assert.equal(store.get(applicantId).state,'SUBMITTED');
 assert.equal(store.decide(applicantId,hash,{id:officerId,guildId,authorized:true,isBot:false,applicationRevision:rev},'approve',19,{nativePending:false,memberPresent:true}).ok,true);
 assert.equal(store.completeRoleGrant(applicantId,hash,20,{nativePending:false,memberPresent:true,memberRolePresent:true,accessRolePresent:false}).ok,false);
 assert.equal(store.completeRoleGrant(applicantId,hash,21,{nativePending:false,memberPresent:true,memberRolePresent:true,accessRolePresent:true}).ok,true);
 assert.equal(store.get(applicantId).state,'APPROVED');
 db.close();
});

// Lightweight Discord mock: verify that NO roles are added before an officer approval.
function setup({recordApproved,recordApplication,publishApplication}={}){
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT)');
 const roles=new Map();roles.set(guildId,{id:guildId,name:'@everyone',permissions:{bitfield:0n},position:0});
 for(const [name,id] of Object.entries(roleIds))roles.set(id,{id,name,permissions:{bitfield:0n},position:name==='SentencedBot'?10:2});
 const mkOverwrite=(id,allow,deny=0)=>({id,type:0,allow:{bitfield:BigInt(allow)},deny:{bitfield:BigInt(deny)}});
 const view=1<<10;
 const rulesId='1573040361251672064';
 const makeChannel=(id,name,ov)=>({id,name,type:0,parentId:null,permissionOverwrites:{cache:new Map(ov.map((x,i)=>[i,x]))},send:async payload=>({id:'345678901234567890',payload}),messages:{fetch:async()=>{throw Error('NO_EXISTING_MESSAGE')}}});
 const rulesChannel=makeChannel(rulesId,'rules',[mkOverwrite(guildId,view)]);
 const start=makeChannel(startId,'start',[mkOverwrite(guildId,0,view),mkOverwrite(roleIds['Oczekujący'],view)]);
 const wait=makeChannel(waitId,'poczekalnia',[mkOverwrite(guildId,0,view),mkOverwrite(roleIds['Oczekujący'],view)]);
 const general=makeChannel(generalId,'ogólny',[mkOverwrite(guildId,0,view),mkOverwrite(roleIds['Dostęp_zatwierdzony'],view)]);
 const staff=makeChannel(staffId,'oficerka',[mkOverwrite(guildId,0,view),mkOverwrite(roleIds['Oficer'],view)]);
 staff.permissionsFor=member=>({has:()=>member.roles.cache.has(roleIds.Oficer)||member.roles.cache.has(roleIds.GM)});
 const channels=new Map([[rulesId,rulesChannel],[startId,start],[waitId,wait],[generalId,general],[staffId,staff]]);
 let grants=[];
 function mkMember(id,roleNames=[]){
  const roleCache=new Map(roleNames.map(r=>[roleIds[r],roles.get(roleIds[r])]));
  const member={id,user:{id,bot:false},pending:false,displayName:id,roles:{cache:roleCache,
   add:async(role)=>{grants.push(['add',id,role.name]);roleCache.set(role.id,role);},
   remove:async(role)=>{grants.push(['remove',id,role.name]);roleCache.delete(role.id);} },
   send:async()=>true};return member;
 }
 const applicant=mkMember(applicantId),officer=mkMember(officerId,['Oficer']);
 const members=new Map([[applicantId,applicant],[officerId,officer]]);
 const guild={id:guildId,ownerId:'456789012345678901',features:['COMMUNITY','MEMBER_VERIFICATION_GATE_ENABLED'],
  client:{user:{id:'567890123456789012'}},roles:{cache:roles},channels:{cache:channels,fetch:async id=>channels.get(id)},
  members:{me:{permissions:{has:x=>x==='ManageRoles'},roles:{highest:{position:20}}},fetch:async({user})=>members.get(user)}};
 applicant.guild=guild;officer.guild=guild;
 const config={enabled:true,rulesId,startId,waitId,generalId,staffId,accessRoleName:'Dostęp_zatwierdzony',rulesVersion:'2026-11-20',rulesUrl:'https://example.org/#regulamin'};
 const settings=new Map();let staffPayload=null;
 staff.send=async payload=>{staffPayload=payload;return {id:'345678901234567890'};};
 class Fluent{setCustomId(){return this}setTitle(){return this}setLabel(){return this}setRequired(){return this}setMaxLength(){return this}setStyle(){return this}addComponents(){return this}}
 const discord={ModalBuilder:Fluent,TextInputBuilder:Fluent,ActionRowBuilder:Fluent,TextInputStyle:{Short:1,Paragraph:2}};
 const runtime=createRuntime({db,guildId,discord,config,getSetting:k=>settings.get(k),setSetting:(k,v)=>settings.set(k,v),sendWelcome:async()=>true,recordApplication,recordApproved,publishApplication});
 const logs=[];
 function interaction(id,actor=applicantId,extra={}){const o={guild,guildId,user:{id:actor},customId:id,channelId:extra.channelId||(id.startsWith('ts:terms:')?rulesId:startId),
  message:extra.message||null,values:extra.values||[],fields:{getTextInputValue:k=>(extra.fields||{})[k]},
  isRepliable:()=>true,reply:async p=>{logs.push(p);},update:async p=>{logs.push(p);},
  showModal:async p=>{logs.push({modal:p});},isMessageComponent:()=>true};return o;}
 return {db,store:runtime.store,runtime,grants,logs,interaction,guild,config,applicant,officer,settings,getStaffPayload:()=>staffPayload};
}

test('end-to-end new form: waiting after terms, new application, staff decision, only then Member+Access',async()=>{
 const t=setup();const hash=termsHash(rules);
 assert.equal(t.grants.length,0);
 await t.runtime.handle(t.interaction('ts:apply:start:v1'));assert.equal(t.grants.length,0); // no consent -> blocked
 await t.runtime.handle(t.interaction('ts:terms:accept:'+hash.slice(0,16)));
 assert.deepEqual(t.grants,[['add',applicantId,'Oczekujący']]);
 await t.runtime.handle(t.interaction('ts:apply:start:v1'));
 await t.runtime.handle(t.interaction('ts:apply:branch:no'));
 await t.runtime.handle(t.interaction('ts:modal:basic',applicantId,{fields:{firstName:'Ala',age:'25',race:'Tauren',spec:'Balance',professions:'Alchemy, Herbalism'}}));
 await t.runtime.handle(t.interaction('ts:select:class',applicantId,{values:['Druid']}));
 await t.runtime.handle(t.interaction('ts:modal:game-nick',applicantId,{fields:{gameNick:'Ala Tauren'}}));
 await t.runtime.handle(t.interaction('ts:select:styles',applicantId,{values:['Casual','PvP']}));
 await t.runtime.handle(t.interaction('ts:raid:no'));
 await t.runtime.handle(t.interaction('ts:source:ingame'));
 assert.equal(t.store.get(applicantId).state,'DRAFT');
 assert.match(t.logs.at(-1).content,/Czy grasz casualowo, czy nastawiasz się na PvE/);
 await t.runtime.handle(t.interaction('ts:focus:open'));
 await t.runtime.handle(t.interaction('ts:modal:play-focus',applicantId,{fields:{playFocus:'Rajdy w weekend, poza nimi casual.'}}));
 assert.equal(t.grants.length,1);
 await t.runtime.handle(t.interaction('ts:apply:send:v2'));
 const pending=t.store.get(applicantId);assert.equal(pending.state,'SUBMITTED');
 assert.ok(t.getStaffPayload().embeds[0].fields.some(field=>field.name.includes('Casual')&&field.value.includes('weekend')));
 assert.equal(t.grants.length,1);
 const approve=`ts:review:approve:${applicantId}:${pending.submitted_revision}`;
 await t.runtime.handle(t.interaction(approve,officerId,{channelId:staffId,message:{id:'345678901234567890'}}));
 assert.equal(t.store.get(applicantId).state,'APPROVED');
 assert.ok(t.grants.some(x=>x[0]==='add'&&x[2]==='Member'));
 assert.ok(t.grants.some(x=>x[0]==='add'&&x[2]==='Dostęp_zatwierdzony'));
 t.db.close();
});

test('returning member requires nick and refusal never grants Member',async()=>{
 const t=setup();const hash=termsHash(rules);
 await t.runtime.handle(t.interaction('ts:terms:accept:'+hash.slice(0,16)));
 await t.runtime.handle(t.interaction('ts:apply:branch:yes'));
 await t.runtime.handle(t.interaction('ts:modal:oldnick',applicantId,{fields:{nick:'ThrallForever',gameNick:'Thrall Forever'}}));
 await t.runtime.handle(t.interaction('ts:source:ingame'));
 await t.runtime.handle(t.interaction('ts:apply:send:v2'));
 const row=t.store.get(applicantId);assert.equal(row.state,'SUBMITTED');
 const reject=`ts:review:reject:${applicantId}:${row.submitted_revision}`;
 await t.runtime.handle(t.interaction(reject,officerId,{channelId:staffId,message:{id:'345678901234567890'}}));
 assert.equal(t.store.get(applicantId).state,'REJECTED');
 assert.deepEqual(t.grants,[['add',applicantId,'Oczekujący']]);
 t.db.close();
});

test('a late submission callback projects the staff decision already saved by the addon',async()=>{
 let startProfile,finishProfile;
 const profileStarted=new Promise(resolve=>{startProfile=resolve;});
 const resumeProfile=new Promise(resolve=>{finishProfile=resolve;});
 const projected=[];
 const t=setup({
  recordApplication:async()=>{startProfile();await resumeProfile;},
  publishApplication:(id,app,status)=>projected.push({id,nick:app.gameNick,status}),
 });
 try{
  await t.runtime.handle(t.interaction('ts:terms:accept:'+termsHash(rules).slice(0,16)));
  await t.runtime.handle(t.interaction('ts:apply:branch:yes'));
  await t.runtime.handle(t.interaction('ts:modal:oldnick',applicantId,{fields:{nick:'DawnyNick',gameNick:'Nowy Nick'}}));
  await t.runtime.handle(t.interaction('ts:source:ingame'));
  const submit=t.runtime.handle(t.interaction('ts:apply:send:v2'));
  await profileStarted;
  const revision=t.store.get(applicantId).submitted_revision;
  assert.deepEqual(await t.runtime.reviewApplication(t.guild,officerId,'approve',applicantId,revision),{state:'APPROVED'});
  finishProfile();
  await submit;
  assert.deepEqual(projected.map(x=>x.status),['APPROVED','APPROVED']);
  assert.ok(projected.every(x=>x.id===applicantId&&x.nick==='Nowy Nick'));
 } finally {finishProfile();t.db.close();}
});

test('staff may approve a valid application after access was manually granted',async()=>{
 const t=setup(), hash=termsHash(rules);
 await t.runtime.handle(t.interaction('ts:terms:accept:'+hash.slice(0,16)));
 await t.runtime.handle(t.interaction('ts:apply:branch:yes'));
 await t.runtime.handle(t.interaction('ts:modal:oldnick',applicantId,{fields:{nick:'DawnyNick',gameNick:'Nowy Nick'}}));
 await t.runtime.handle(t.interaction('ts:source:ingame'));
 await t.runtime.handle(t.interaction('ts:apply:send:v2'));
 const pending=t.store.get(applicantId), access=roleIds['Dostęp_zatwierdzony'];
 t.applicant.roles.cache.set(access,t.guild.roles.cache.get(access));
 await t.runtime.handle(t.interaction(`ts:review:approve:${applicantId}:${pending.submitted_revision}`,officerId,{channelId:staffId,message:{id:pending.staff_message_id}}));
 assert.equal(t.store.get(applicantId).state,'APPROVED');
 assert.ok(t.applicant.roles.cache.has(access));
 assert.ok(t.applicant.roles.cache.has(roleIds.Member));
 assert.equal(t.grants.filter(([op,,role])=>op==='add'&&role==='Dostęp_zatwierdzony').length,0);
 t.db.close();
});

test('manual access does not replace consent and survives failed role grant',async()=>{
 for(const missingConsent of [true,false]){
  const t=setup(), hash=termsHash(rules);
  await t.runtime.handle(t.interaction('ts:terms:accept:'+hash.slice(0,16)));
  await t.runtime.handle(t.interaction('ts:apply:branch:yes'));
  await t.runtime.handle(t.interaction('ts:modal:oldnick',applicantId,{fields:{nick:'DawnyNick',gameNick:'Nowy Nick'}}));
  await t.runtime.handle(t.interaction('ts:source:ingame'));
  await t.runtime.handle(t.interaction('ts:apply:send:v2'));
  const pending=t.store.get(applicantId), access=roleIds['Dostęp_zatwierdzony'];
  t.applicant.roles.cache.set(access,t.guild.roles.cache.get(access));
  if(missingConsent)t.db.prepare('UPDATE ts_onboarding_gate SET accepted_at=NULL WHERE guild_id=? AND user_id=?').run(guildId,applicantId);
  else t.applicant.roles.add=async()=>{throw Error('Discord unavailable');};
  await t.runtime.handle(t.interaction(`ts:review:approve:${applicantId}:${pending.submitted_revision}`,officerId,{channelId:staffId,message:{id:pending.staff_message_id}}));
  assert.equal(t.store.get(applicantId).state,missingConsent?'SUBMITTED':'GRANTING');
  assert.ok(t.applicant.roles.cache.has(access));
  assert.equal(t.grants.filter(([op,,role])=>op==='remove'&&role==='Dostęp_zatwierdzony').length,0);
  if(missingConsent)assert.match(t.logs.at(-1).content,/ręczna rola nie zastępuje zgody/);
  t.db.close();
 }
});

test('raid YES prompts for hours and multiselect weekdays, then requires explicit Send',async()=>{
 const t=setup(),hash=termsHash(rules);
 await t.runtime.handle(t.interaction('ts:terms:accept:'+hash.slice(0,16)));
 await t.runtime.handle(t.interaction('ts:apply:branch:no'));
 await t.runtime.handle(t.interaction('ts:modal:basic',applicantId,{fields:{firstName:'Marek',age:'33',race:'Orc',spec:'Fury',professions:'Mining, Engineering'}}));
 await t.runtime.handle(t.interaction('ts:select:class',applicantId,{values:['Warrior']}));
 await t.runtime.handle(t.interaction('ts:modal:game-nick',applicantId,{fields:{gameNick:'Marek Orc'}}));
 await t.runtime.handle(t.interaction('ts:select:styles',applicantId,{values:['Raidowanie','PvP']}));
 await t.runtime.handle(t.interaction('ts:raid:yes'));
 const beforeInvalid=t.store.get(applicantId);
 for(const hours of ['0','169','1e2','7-8','7 h']){
  await t.runtime.handle(t.interaction('ts:modal:hours',applicantId,{fields:{hours}}));
  assert.match(t.logs.at(-1).content,/np\. 7 lub 7,5/);
  assert.deepEqual(collectButtons(t.logs.at(-1)),['ts:raid:yes','ts:raid:no']);
  assert.equal(t.store.get(applicantId).application_json,beforeInvalid.application_json);
  assert.equal(t.store.get(applicantId).revision,beforeInvalid.revision);
 }
 await t.runtime.handle(t.interaction('ts:raid:yes'));
 assert.ok(t.logs.at(-1).modal);
 await t.runtime.handle(t.interaction('ts:modal:hours',applicantId,{fields:{hours:'7,5'}}));
 await t.runtime.handle(t.interaction('ts:select:days',applicantId,{values:['pon','czw','sob']}));
 assert.equal(t.store.get(applicantId).state,'DRAFT');
 assert.equal(t.grants.length,1); // Oczekujący only
 await t.runtime.handle(t.interaction('ts:apply:send:v2'));
 assert.equal(t.store.get(applicantId).state,'DRAFT');
 await t.runtime.handle(t.interaction('ts:source:other'));
 assert.ok(t.logs.at(-1).modal);
 await t.runtime.handle(t.interaction('ts:modal:referral-source',applicantId,{fields:{source:'   '}}));
 assert.match(t.logs.at(-1).content,/Podaj nazwę źródła/);
 assert.equal(JSON.parse(t.store.get(applicantId).application_json).referralSource,undefined);
 await t.runtime.handle(t.interaction('ts:modal:referral-source',applicantId,{fields:{source:'Polecenie znajomego'}}));
 await t.runtime.handle(t.interaction('ts:apply:send:v2'));
 assert.equal(t.store.get(applicantId).state,'DRAFT');
 await t.runtime.handle(t.interaction('ts:modal:play-focus',applicantId,{fields:{playFocus:'PvE w uzgodnionych dniach.'}}));
 await t.runtime.handle(t.interaction('ts:apply:send:v2'));
 const app=JSON.parse(t.store.get(applicantId).application_json);
 assert.equal(app.referralSource,'Inne źródło: Polecenie znajomego');
 assert.equal(app.raidHoursWeek,7.5);
 assert.deepEqual(app.raidDays,['pon','czw','sob']);
 assert.equal(t.store.get(applicantId).state,'SUBMITTED');
 t.db.close();
});

test('on bot ready both rule & start panels are created separately, not old Trial cards',async()=>{
 const t=setup(); const result=await t.runtime.ensurePanels(t.guild);
 assert.equal(result.enabled,true);
 assert.equal(t.settings.get('ts_terms_panel_v17'),'345678901234567890');
 assert.equal(t.settings.get('start_panel_v05'),'345678901234567890');
 t.db.close();
});

test('legacy recruitment buttons are blocked and candidate role cannot bypass consent',async()=>{
 const t=setup();
 const a=t.interaction('ident:skip');
 assert.equal(t.runtime.shouldBlockLegacy(a),true);
 assert.equal(t.runtime.shouldBlockLegacy(t.interaction('onboarding:start')),true);
 assert.equal(t.runtime.shouldBlockLegacy(t.interaction('review:accept:000')),true);
 assert.equal(t.runtime.shouldBlockLegacy(t.interaction('botmenu:open')),true);
 t.db.close();
});

test('stale cards and nonstaff cannot grant roles, and a failed projection leaves approval intact',async()=>{
 const t=setup({recordApproved:async()=>{throw Error('write unavailable');}});
 const terms='ts:terms:accept:'+termsHash(rules).slice(0,16);
 await t.runtime.handle(t.interaction(terms,applicantId,{channelId:startId}));
 assert.equal(t.grants.length,0);
 await t.runtime.handle(t.interaction(terms));
 await t.runtime.handle(t.interaction('ts:apply:branch:yes'));
 await t.runtime.handle(t.interaction('ts:modal:oldnick',applicantId,{fields:{nick:'DawnyNick',gameNick:'Nowy Nick'}}));
 await t.runtime.handle(t.interaction('ts:source:ingame'));
 await t.runtime.handle(t.interaction('ts:apply:send:v2'));
 const row=t.store.get(applicantId);
 const approve='ts:review:approve:'+applicantId+':'+row.submitted_revision;
 const staffCard={channelId:staffId,message:{id:row.staff_message_id}};
 await t.runtime.handle(t.interaction(approve,applicantId,staffCard));
 await t.runtime.handle(t.interaction(approve,officerId,{channelId:staffId,message:{id:'456789012345678901'}}));
 assert.equal(t.store.get(applicantId).state,'SUBMITTED');
 assert.equal(t.grants.length,1);
 await Promise.all([
  t.runtime.handle(t.interaction(approve,officerId,staffCard)),
  t.runtime.handle(t.interaction(approve,officerId,staffCard)),
 ]);
 assert.equal(t.store.get(applicantId).state,'APPROVED');
 assert.equal(t.grants.filter(([op,,role])=>op==='add'&&role==='Member').length,1);
 assert.ok(t.applicant.roles.cache.has(roleIds['Dostęp_zatwierdzony']));
 t.db.close();
});

test('an approved account is guided to /bot without granting recruitment roles',async()=>{
 const t=setup();
 const id=roleIds['Dostęp_zatwierdzony'];
 t.applicant.roles.cache.set(id,t.guild.roles.cache.get(id));
 await t.runtime.handle(t.interaction('ts:terms:accept:'+termsHash(rules).slice(0,16)));
 assert.match(t.logs.at(-1).content,/Masz już dostęp.*\/bot/);
 assert.equal(t.grants.length,0);
 t.db.close();
});

test('recruitment starts after the retired Discord roles have been removed',async()=>{
 const t=setup();
 t.guild.roles.cache.delete(roleIds.Trial);
 t.guild.roles.cache.delete(roleIds.Veteran);
 assert.equal((await t.runtime.ensurePanels(t.guild)).enabled,true);
 t.db.close();
});

test('submission projects the full in-game nick into the linked profile',async()=>{
 let got;const t=setup({recordApplication:async(id,app)=>{got={id,app}}});const hash=termsHash(rules);
 await t.runtime.handle(t.interaction('ts:terms:accept:'+hash.slice(0,16)));await t.runtime.handle(t.interaction('ts:apply:branch:yes'));
 await t.runtime.handle(t.interaction('ts:modal:oldnick',applicantId,{fields:{nick:'Old',gameNick:'Full Name'}}));
 await t.runtime.handle(t.interaction('ts:source:ingame'));
 await t.runtime.handle(t.interaction('ts:apply:send:v2'));
 assert.equal(got.id,applicantId);assert.equal(got.app.gameNick,'Full Name');assert.equal(t.store.get(applicantId).state,'SUBMITTED');
});

test('repair restores verified access on moves, and ignores names and guarded unknown channels',()=>{
 const t=setup();
 const channel=t.guild.channels.cache.get(generalId);
 const old=channelAccess(t.guild);
 channel.name='inny-ogólny';
 assert.deepEqual(planChannelRepair(old,t.guild,t.config),[]);
 channel.parentId='1574410871969419474';
 channel.permissionOverwrites={cache:new Map(channel.permissionOverwrites.cache)};
 channel.permissionOverwrites.cache.delete(1);
 const result=planChannelRepair(old,t.guild,t.config);
 assert.equal(result.length,1);
 assert.equal(result[0].before.parentId,channel.parentId);
 assert.ok(result[0].restore.some(o=>o.id===roleIds['Dostęp_zatwierdzony']&&o.allow==='1024'));
 assert.deepEqual(planChannelRepair([],t.guild,t.config,[generalId]),[]);
 t.db.close();
});

test('paired officer sees current application and can use the same approval path as Discord',async()=>{
 const t=setup(), hash=termsHash(rules);
 try{
  t.store.init(applicantId,10);
  assert.ok(t.store.accept(applicantId,hash,12,{nativePending:false}).ok);
  assert.ok(t.store.submit(applicantId,hash,{...old,gameNick:'Nowy Nick'},15,{nativePending:false}).ok);
  assert.ok(t.store.reserveStaffDispatch(applicantId,16).ok);
  assert.ok(t.store.recordStaffMessage(applicantId,'345678901234567890',17).ok);
  const seen=[];
  t.guild.channels.cache.get(staffId).messages.fetch=async({message})=>{
   assert.equal(message,'345678901234567890');return {edit:async payload=>seen.push(payload)};
  };
  await assert.rejects(t.runtime.reviewQueue(t.guild,applicantId,1),/OFFICER_AUTHORIZATION_MISSING/);
  const queue=await t.runtime.reviewQueue(t.guild,officerId,1);
  assert.equal(queue.applications[0].fields[0].value,'Nowy Nick');
  const revision=queue.applications[0].revision;
  await assert.rejects(t.runtime.reviewApplication(t.guild,officerId,'approve',applicantId,revision+1),/STALE_STAFF_CARD/);
  t.applicant.pending=true;
  await assert.rejects(t.runtime.reviewApplication(t.guild,officerId,'approve',applicantId,revision),/SCREENING_PENDING/);
  t.applicant.pending=false;
  assert.deepEqual(await t.runtime.reviewApplication(t.guild,officerId,'approve',applicantId,revision),{state:'APPROVED'});
  assert.equal(seen.length,1);assert.deepEqual(seen[0].components,[]);
  assert.equal(t.store.get(applicantId).decision_actor,officerId);
  assert.deepEqual(await t.runtime.reviewApplication(t.guild,officerId,'approve',applicantId,revision),{state:'APPROVED'});
  assert.equal(seen.length,1,'retries do not edit or send twice');
  assert.equal((await t.runtime.reviewQueue(t.guild,officerId,1)).applications.length,0);
  t.officer.roles.cache.clear();
  await assert.rejects(t.runtime.reviewApplication(t.guild,officerId,'approve',applicantId,revision),/OFFICER_AUTHORIZATION_MISSING/);
 }finally{t.db.close()}
});
