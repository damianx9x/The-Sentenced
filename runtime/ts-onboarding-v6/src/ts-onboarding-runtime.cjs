'use strict';
const {inviteContacts}=require('../../recruitment/invite-contacts.cjs');
/* The Sentenced: reviewed staging adapter. Never enabled automatically.
 * Native Discord screening + candidate role ACL MUST be verified independently.
 */
const fs=require('node:fs');
const path=require('node:path');
const {GateStore,ST,termsHash}=require('./gate-store.cjs');
const {validApplication}=require('./policy.cjs');
const {termsCard,startPanel,branchCard,staffReview}=require('./discord-payloads.cjs');
const {calculate,ability}=require('./acl-oracle.cjs');
const {safeText}=require('./wizard.cjs');
const ID=/^\d{17,20}$/;
const ALLOWED_CLASSES=['Warrior','Paladin','Hunter','Rogue','Priest','Shaman','Mage','Warlock','Druid'];
const STYLES=['Casual','Raidowanie','PvP'];
const PLAY_FOCUS='Czy grasz casualowo, czy nastawiasz się na PvE? Jak pogodzisz jedno z drugim?';
const DAYS=[['pon','Poniedziałek'],['wt','Wtorek'],['sr','Środa'],['czw','Czwartek'],['pt','Piątek'],['sob','Sobota'],['nd','Niedziela']];
const EPH=1<<6;
const NO_MENTIONS={parse:[]};
function onlyOneByName(cache,name) {const m=[...cache.values()].filter(x=>x.name===name);if(m.length!==1)throw Error(`UNIQUE_ROLE_OR_CHANNEL_REQUIRED:${name}:${m.length}`);return m[0];}
function asChannel(raw){return {id:raw.id,name:raw.name,type:raw.type,permission_overwrites:[...raw.permissionOverwrites.cache.values()].map(x=>({id:x.id,type:typeof x.type==='number'?x.type:(x.type==='role'?0:1),allow:x.allow.bitfield.toString(),deny:x.deny.bitfield.toString()}))};}
const CHANNEL_ACL_KEY='ts_verified_channel_access_v1';
const managedChannelTypes=new Set([0,2,5,13,15,16]);
function channelAccess(guild){
 return [...guild.channels.cache.values()].filter(c=>managedChannelTypes.has(c.type)).map(c=>({...asChannel(c),parentId:c.parentId||null}));
}
function overwriteSignature(overwrites){
 return JSON.stringify(overwrites.map(o=>[o.id,o.type,o.allow,o.deny]).sort((a,b)=>a[0].localeCompare(b[0])));
}
function planChannelRepair(previous,guild,config,violationIds=[]){
 const current=channelAccess(guild);
 const older=new Map(previous.map(c=>[c.id,c]));
 const violations=new Set(violationIds);
 const proposed=[];
 for(const channel of current){
  const before=older.get(channel.id);
  if(!before||before.type!==channel.type||overwriteSignature(before.permission_overwrites)===overwriteSignature(channel.permission_overwrites))continue;
  if(before.parentId!==channel.parentId||violations.has(channel.id))proposed.push({before:channel,restore:before.permission_overwrites});
 }
 if(!proposed.length||proposed.length>12)return [];
 const patches=new Map(proposed.map(p=>[p.before.id,p.restore]));
 const cache=new Map(guild.channels.cache);
 for(const [id,overwrites] of patches){
  const channel=cache.get(id);
  cache.set(id,{...asChannel(channel),parentId:channel.parentId,
   permissionOverwrites:{cache:new Map(overwrites.map(o=>[o.id,{...o,allow:{bitfield:BigInt(o.allow)},deny:{bitfield:BigInt(o.deny)}}]))}});
 }
 try{aclInvariant({id:guild.id,roles:guild.roles,channels:{cache}},config);}catch{return [];}
 return proposed;
}
function liveSnapshot(guild){return {id:guild.id,roles:[...guild.roles.cache.values()].map(x=>({id:x.id,name:x.name,permissions:x.permissions.bitfield.toString()})),channels:[...guild.channels.cache.values()].filter(x=>[0,2,5,13,15,16].includes(x.type)).map(asChannel)};}
function aclInvariant(guild,config){
 const snap=liveSnapshot(guild), r=name=>{const matches=snap.roles.filter(x=>x.name===name);if(matches.length!==1)throw Error('ACL_ROLE_UNKNOWN:'+name);return matches[0].id;};
 const waiting=r('Oczekujący'),member=r('Member'),grant=r(config.accessRoleName);
 const rulesId=config.rulesId || config.startId;
 const ekipaRole=snap.roles.find(x=>x.name==='Ekipa_WWW')?.id;
 const ekipaCategoryId='1572323089956737165';
 const evaluate=(name,ids,shouldSeeStart)=>{
  const intended=new Set([rulesId]);
  if(shouldSeeStart || !config.rulesId) intended.add(config.startId);
  if(shouldSeeStart || !config.rulesId) intended.add(config.waitId);
  const leaks=[],visible=[];
  for(const ch of snap.channels){
   // Existing invited Ekipa_WWW participants legitimately see their own private
   // category. This is NOT a bypass to ordinary guild channels. Keeping their
   // private area must not abort startup of the new public onboarding panel.
   if(ekipaRole&&ids.includes(ekipaRole)&&guild.channels.cache.get(ch.id)?.parentId===ekipaCategoryId)continue;
   const bits=calculate({id:snap.id,roles:snap.roles},ch,ids);
   const see=ability(bits,'VIEW_CHANNEL');
   if(see)visible.push(ch.id);
   if(see&&!intended.has(ch.id))leaks.push(ch.name+' ['+ch.id+']');
   if([2,13].includes(ch.type)&&see&&ability(bits,'CONNECT'))leaks.push('VOICE_CONNECT:'+ch.name);
  }
  if(leaks.length)throw Error('ACL_LEAK_'+name+':'+leaks.join(','));
  if(config.rulesId && !visible.includes(rulesId))throw Error('ACL_RULES_HIDDEN_'+name);
  if(config.rulesId && shouldSeeStart && !visible.includes(config.waitId))throw Error('ACL_WAIT_HIDDEN_'+name);
  if((shouldSeeStart || !config.rulesId)&&!visible.includes(config.startId))throw Error('ACL_START_HIDDEN_'+name);
 };
 evaluate('NO_ROLE',[],false);
 evaluate('WAITING',[waiting],true);
 evaluate('WAITING_MEMBER',[waiting,member],true);
 // Any regular role a pending user can receive (including Veteran/Ekipa_WWW)
 // must NOT become a second way around the consent gate.
 const privileged=new Set(['GM','Oficer','Raid Lider','SentencedBot',config.accessRoleName]);
 for(const role of snap.roles){
  if(role.id===snap.id||role.id===waiting||privileged.has(role.name))continue;
  evaluate('SINGLE_'+role.name,[role.id],false);
  evaluate('WAITING_PLUS_'+role.name,[waiting,role.id],true);
 }
 const general=snap.channels.find(x=>x.id===config.generalId);
 if(!general)throw Error('GENERAL_CHANNEL_MISSING');
 const withGrant=calculate({id:snap.id,roles:snap.roles},general,[member,grant]);
 if(!ability(withGrant,'VIEW_CHANNEL'))throw Error('ACCESS_GRANT_ROLE_CANNOT_VIEW_GENERAL');
 const withoutGrant=calculate({id:snap.id,roles:snap.roles},general,[member]);
 if(ability(withoutGrant,'VIEW_CHANNEL'))throw Error('MEMBER_ALONE_EXPOSES_GENERAL');
 const office=snap.channels.find(x=>x.id===config.staffId);if(!office)throw Error('STAFF_CHANNEL_MISSING');
 for (const ids of [[],[waiting],[member],[waiting,member],[grant]]) {
  if(ability(calculate({id:snap.id,roles:snap.roles},office,ids),'VIEW_CHANNEL'))throw Error('STAFF_CHANNEL_EXPOSED');
 }
 return {pass:true,channels:snap.channels.length};
}
function basicText(s,max=200){return typeof s==='string'&&s.trim().length>0&&s.trim().length<=max&&!/[\u0000-\u001f]/.test(s);}
function draftDecode(row){if(!row?.application_json)return {};try{const obj=JSON.parse(row.application_json);return obj&&typeof obj==='object'&&!Array.isArray(obj)?obj:{};}catch(_){return {};}}
function mkModal(d,id,title,fields){const modal=new d.ModalBuilder().setCustomId(id).setTitle(title);for(const f of fields){const comp=new d.TextInputBuilder().setCustomId(f.id).setLabel(f.label).setRequired(true).setMaxLength(f.max||100).setStyle(f.paragraph?d.TextInputStyle.Paragraph:d.TextInputStyle.Short);modal.addComponents(new d.ActionRowBuilder().addComponents(comp));}return modal;}
function menu(id,label,options,max=1){return {type:1,components:[{type:3,custom_id:id,placeholder:label,min_values:1,max_values:max,options:options.map(([value,l])=>({label:l,value}))}]};}
function button(label,id,style=1){return {type:2,label,style,custom_id:id};}
function controls(...b){return [{type:1,components:b}];}
function ep(content,components=[]){return {content,components,allowedMentions:NO_MENTIONS,flags:EPH};}
function createRuntime({db,guildId,discord,config,getSetting,setSetting,getChannel,upsertCandidate,sendWelcome,recordApplication,recordApproved,publishApplication,refreshState}){
 if(!db||!ID.test(guildId)||!discord)throw Error('INVALID_RUNTIME_ARGS');
 const store=new GateStore(db,guildId);
 const rules=fs.readFileSync(path.join(__dirname,'../content/regulamin.md'),'utf8');
 const hash=termsHash(rules);const publicTerms=termsCard(rules,config.rulesVersion,config.rulesUrl);
 if(publicTerms.hash!==hash)throw Error('RULES_HASH_MISMATCH');
 if(!config?.startId||!config?.waitId||!config?.staffId||!config?.generalId||!config?.accessRoleName)throw Error('INCOMPLETE_CONFIG');
 const enabled=Boolean(config.enabled);
 // Security gate can receive an interaction before the READY event creates panels.
 // Initialize the gate table synchronously whenever the feature is enabled.
 if(enabled)store.migrate();
 function assertGuild(guild){if(!guild||guild.id!==guildId)throw Error('WRONG_GUILD');}
 function assertHostReady(guild){assertGuild(guild);if(!guild.features?.includes('COMMUNITY')||!guild.features?.includes('MEMBER_VERIFICATION_GATE_ENABLED'))throw Error('COMMUNITY_RULES_SCREENING_NOT_ENABLED');const accessRole=onlyOneByName(guild.roles.cache,config.accessRoleName);if(!accessRole.permissions||BigInt(accessRole.permissions.bitfield)!==0n)throw Error('ACCESS_ROLE_MUST_HAVE_ZERO_SERVER_PERMISSIONS');const a=aclInvariant(guild,config);const bot=guild.members.me;if(!bot?.permissions?.has('ManageRoles'))throw Error('BOT_MANAGE_ROLES_MISSING');const top=bot.roles.highest.position;for(const roleName of ['Member','Oczekujący',config.accessRoleName]){if(top<=onlyOneByName(guild.roles.cache,roleName).position)throw Error('BOT_ROLE_HIERARCHY_BLOCKED');}return a;}
 function memberPreviouslyApproved(member){
  return member.roles.cache.has(onlyOneByName(member.guild.roles.cache,config.accessRoleName).id);
 }
 async function fetchMember(guild,id){return guild.members.fetch({user:id,force:true});}
 async function verifiedMember(interaction){if(!interaction.guild||interaction.guild.id!==guildId||interaction.guildId!==guildId||!ID.test(interaction.user?.id))throw Error('WRONG_GUILD_OR_USER');const m=await fetchMember(interaction.guild,interaction.user.id);if(m.user.bot)throw Error('BOT_NOT_APPLICANT');if(upsertCandidate)upsertCandidate(m);return m;}
 async function answer(i,payload,change=false){
  if(i.deferred){const {flags,...editable}=payload;return i.editReply(editable);}
  if(change&&i.isMessageComponent?.())return i.update(payload);
  return i.reply({...payload,flags:EPH});
 }
 async function conclude(i,payload){return i.deferred?i.editReply(payload):i.update(payload);}
 function requireCurrent(i,row,m){if(m.pending!==false)throw Error('SCREENING_NOT_CONFIRMED');if(config.rulesId&&!m.roles.cache.has(onlyOneByName(i.guild.roles.cache,'Oczekujący').id))throw Error('WAITING_ROLE_MISSING');if(!row||!['TERMS_ACCEPTED','DRAFT'].includes(row.state)||row.terms_hash!==hash||!row.accepted_at)throw Error('NO_CURRENT_TERMS_CONSENT');if(i.user.id!==row.user_id)throw Error('CROSS_USER');}
 function draftSave(i,m,patch){const row=store.get(m.id);requireCurrent(i,row,m);const merged={...draftDecode(row),...patch};const result=store.draft(m.id,hash,merged,Date.now(),{nativePending:m.pending});if(!result.ok)throw Error(result.reason);return merged;}
 async function sendStaff(guild,userId){const row=store.get(userId);if(!row||row.state!==ST.SUBMITTED||!row.application_json)throw Error('NOT_SUBMITTED');if(!store.reserveStaffDispatch(userId,Date.now()).ok)return {sent:false,reason:'ALREADY_QUEUED'};const channel=await guild.channels.fetch(config.staffId);if(!channel||channel.type!==0||!channel.send)throw Error('STAFF_TEXT_CHANNEL_UNAVAILABLE');try{const application=JSON.parse(row.application_json);const payload=staffReview({userId,wasMember:application.wasMember,application,revision:row.submitted_revision});const msg=await channel.send(payload);if(!store.recordStaffMessage(userId,msg.id,Date.now()).ok)throw Error('STAFF_RECEIPT_UNCERTAIN');return {sent:true};}catch(error){/* A timed-out Discord send may have succeeded. Never replay blindly. */throw Error('STAFF_DISPATCH_UNCERTAIN:'+error.message);}}
 async function submit(i,m,app){const row=store.get(m.id);requireCurrent(i,row,m);if(!basicText(app.gameNick,60))throw Error('GAME_NICK_REQUIRED');const v=validApplication(app);if(!v.allowed)throw Error(v.reason);const sub=store.submit(m.id,hash,app,Date.now(),{nativePending:m.pending});if(!sub.ok)throw Error(sub.reason);try{await recordApplication?.(m.id,app);}catch(_){console.error('[recruitment] Projekcja profilu wymaga uzgodnienia');}Promise.resolve().then(()=>publishApplication?.(m.id,app,'PENDING')).catch(()=>console.error('[recruitment] Publiczna karta wymaga uzgodnienia'));try{const res=await sendStaff(i.guild,m.id);return res.sent?`✅ **Wniosek wysłany do kadry.** Napisz w grze do ${inviteContacts(true)}, aby umówić zaproszenie. Do decyzji kadry pozostajesz w #poczekalnia.`:'Zgłoszenie zapisane; kadra może już je przetwarzać.';}catch(e){return 'Zgłoszenie zapisane, ale doręczenie kadrze jest niepewne. Nie wysyłaj go ponownie. Skontaktuj się z oficerem.';}}
 async function stepMessage(i,m,patch,text,next){draftSave(i,m,patch);return answer(i,ep(text,next));}
 async function showSource(i,m,patch={}){
  return stepMessage(i,m,{...patch,referralSource:undefined},'**Skąd dowiedziałeś się o gildii?**',
   controls(button('Ingame','ts:source:ingame',1),button('Inne źródło','ts:source:other',2)));
 }
 async function showFocus(i,m,patch={}){
  return stepMessage(i,m,patch,'**'+PLAY_FOCUS+'**',controls(button('Odpowiedz','ts:focus:open',1)));
 }
 async function showReferralReview(i,m,patch){
  const app=draftSave(i,m,patch);
  if(app.wasMember==='NIE')return showFocus(i,m,{playFocus:undefined});
  return showReview(i,m,{});
 }
 async function showReview(i,m,patch){
  const app=draftSave(i,m,patch);if(!basicText(app.gameNick,60)){await i.showModal(mkModal(discord,'ts:modal:game-nick-final','Twoja postać w grze',[{id:'gameNick',label:'Pełny nick postaci w grze',max:60}]));return;}if(app.wasMember==='NIE'&&!basicText(app.playFocus,400)){await showFocus(i,m);return;}const validation=validApplication(app);
  if(!validation.allowed)throw Error('INCOMPLETE_FORM:'+validation.reason);
  if(app.wasMember==='TAK'){
   await answer(i,ep([
    '📋 **Sprawdź zgłoszenie The Sentenced**',
    `Dawny nick: ${safeText(app.oldNick)}`,
    `Nick w grze: ${safeText(app.gameNick)}`,
    `Źródło: ${safeText(app.referralSource)}`,
    'Odpowiedzi będą widoczne dla członków gildii na forum zgłoszeń.'
   ].join('\n'),controls(button('Wyślij zgłoszenie','ts:apply:send:v2',3))));
   return;
  }
  // No applicant data in a public channel; only the applicant sees this preview.
  const fields=app.raidPlan
   ? `Rajdy: Tak | ${app.raidHoursWeek} godz./tydz. | ${app.raidDays.join(', ')}`
   : 'Rajdy: Nie';
  const msg=[
   '📋 **Sprawdź zgłoszenie The Sentenced**',
   `Nick w grze: ${safeText(app.gameNick)}`,`Imię: ${safeText(app.firstName)}`,`Wiek: ${app.age}`,
   `Postać: ${safeText(app.wowClass)} / ${safeText(app.race)} / ${safeText(app.spec)}`,
   `Profesje: ${app.professions.map(safeText).join(', ') || 'Brak'}`,
   `Styl gry: ${app.playstyles.join(', ')}`,fields,`Źródło: ${safeText(app.referralSource)}`,
   `${PLAY_FOCUS} ${safeText(app.playFocus)}`,
   '', 'Wszystkie odpowiedzi z wniosku będą widoczne dla członków gildii na forum zgłoszeń.', '**Wyślij zgłoszenie do KADRA → #oficerka?**'
  ].join('\n');
  await answer(i,ep(msg,controls(button('Wyślij zgłoszenie','ts:apply:send:v2',3))));
 }

 async function requireModerator(guild,actorId){
  assertGuild(guild);
  if(!enabled||!ID.test(actorId))throw Error('OFFICER_AUTHORIZATION_MISSING');
  const moderator=await fetchMember(guild,actorId);
  const staffRoles=config.reviewRoleIds||['GM','Oficer'].map(n=>onlyOneByName(guild.roles.cache,n).id);
  if(!moderator||moderator.pending!==false||moderator.user.bot||!(moderator.id===guild.ownerId||staffRoles.some(r=>moderator.roles.cache.has(r))))throw Error('OFFICER_AUTHORIZATION_MISSING');
  const staff=await guild.channels.fetch(config.staffId,{force:true});
  if(!staff?.permissionsFor(moderator)?.has(['ViewChannel','ReadMessageHistory']))throw Error('OFFICER_CHANNEL_ACCESS_REQUIRED');
  return {moderator,staff};
 }
 async function reviewQueue(guild,actorId,page){
  await requireModerator(guild,actorId);
  if(!Number.isSafeInteger(page)||page<1||page>1000)throw Error('BAD_REVIEW_PAGE');
  const size=3;
  const rows=db.prepare(`SELECT user_id, submitted_revision, application_json FROM ts_onboarding_gate
    WHERE guild_id=? AND state=? AND terms_hash=? ORDER BY submitted_at,user_id LIMIT ? OFFSET ?`).all(guildId,ST.SUBMITTED,hash,size+1,(page-1)*size);
  return {page,hasMore:rows.length>size,applications:rows.slice(0,size).map(row=>{
   const application=draftDecode(row);
   const fields=staffReview({userId:row.user_id,wasMember:application.wasMember,application,revision:row.submitted_revision}).embeds[0].fields;
   return {id:row.user_id,revision:row.submitted_revision,fields:fields.map(({name,value})=>({name,value}))};
  })};
 }
 async function reviewApplication(guild,actorId,act,userId,revision){
  const {moderator,staff}=await requireModerator(guild,actorId);
  if(!['approve','reject'].includes(act)||!ID.test(userId)||!Number.isSafeInteger(revision)||revision<1)throw Error('BAD_ACTION');
  const candidate=store.get(userId);
  if(candidate?.submitted_revision===revision&&candidate.decision_actor===actorId&&
    ((act==='approve'&&candidate.state===ST.APPROVED)||(act==='reject'&&candidate.state===ST.REJECTED)))return {state:candidate.state};
  if(!candidate||candidate.submitted_revision!==revision||candidate.state!==ST.SUBMITTED)throw Error('STALE_STAFF_CARD');
  return decideApplication(guild,moderator,act,userId,candidate,async payload=>{
   if(candidate.staff_message_id){
    const message=await staff.messages.fetch({message:candidate.staff_message_id,force:true});
    await message.edit(payload);
   }
  });
 }
 async function decision(i,act,userId,revision){
  if(i.channelId!==config.staffId||!ID.test(userId)||!Number.isSafeInteger(revision)||revision<0)throw Error('NOT_STAFF_CARD');
  const {moderator}=await requireModerator(i.guild,i.user.id);
  const candidate=store.get(userId);
  if(!candidate||candidate.submitted_revision!==revision||candidate.staff_message_id!==i.message?.id)throw Error('STALE_OR_FORGED_STAFF_CARD');
  return decideApplication(i.guild,moderator,act,userId,candidate,payload=>conclude(i,payload));
 }
 async function decideApplication(guild,moderator,act,userId,candidate,publishDecision){
  if(!['approve','reject'].includes(act)||!ID.test(userId))throw Error('BAD_ACTION');
  const revision=candidate.submitted_revision;
  const target=await fetchMember(guild,userId);
  if(target.pending!==false)throw Error('CANDIDATE_NATIVE_SCREENING_PENDING');
  if(act==='approve'){
   assertHostReady(guild);
  }
  const actor={id:moderator.id,guildId,authorized:true,isBot:moderator.user.bot,applicationRevision:revision};
  const result=store.decide(userId,hash,actor,act,Date.now(),{nativePending:target.pending,memberPresent:true});if(!result.ok)throw Error(result.reason);
  if(act==='reject'){
   Promise.resolve().then(()=>publishApplication?.(userId,JSON.parse(candidate.application_json),'REJECTED')).catch(()=>console.error('[recruitment] Publiczna karta wymaga uzgodnienia'));
   try{await publishDecision({content:`❌ Wniosek odrzucony przez <@${moderator.id}>.`,components:[],embeds:[],allowedMentions:NO_MENTIONS});}catch(_){console.error('[recruitment] Karta decyzji wymaga odświeżenia');}
   try{await target.send('Twoje zgłoszenie do The Sentenced zostało odrzucone. W razie pytań skontaktuj się z kadrą.');}catch(_){}
   return {state:ST.REJECTED};
  }
  const memberRole=onlyOneByName(guild.roles.cache,'Member');const accessRole=onlyOneByName(guild.roles.cache,config.accessRoleName);
  const hadMember=target.roles.cache.has(memberRole.id);
  const hadAccess=target.roles.cache.has(accessRole.id);
  let fresh;
  try{
   if(!hadMember)await target.roles.add(memberRole,'TS gate: zatwierdzenie zgłoszenia');
   if(!hadAccess)await target.roles.add(accessRole,'TS gate: zgoda + wniosek + decyzja');
   fresh=await fetchMember(guild,userId);
   const done=store.completeRoleGrant(userId,hash,Date.now(),{
    nativePending:fresh.pending,memberPresent:true,
    memberRolePresent:fresh.roles.cache.has(memberRole.id),accessRolePresent:fresh.roles.cache.has(accessRole.id)
   });
   if(!done.ok)throw Error(done.reason);
  }catch(error){
   // A role write can succeed in Discord even if its response was lost.
   try{
    const current=await fetchMember(guild,userId);
    if(!hadAccess&&current.roles.cache.has(accessRole.id))await current.roles.remove(accessRole,'TS gate: niepełne zatwierdzenie');
    if(!hadMember&&current.roles.cache.has(memberRole.id))await current.roles.remove(memberRole,'TS gate: niepełne zatwierdzenie');
   }catch(_){console.error('[recruitment] Nie potwierdzono cofnięcia ról');}
   throw Error('GRANT_UNCERTAIN_MANUAL_RECONCILIATION_REQUIRED');
  }

  // Roles and decision are committed. Failures of notifications or projection
  // must not revoke access or leave APPROVED inconsistent with Discord.
  const waiting=onlyOneByName(guild.roles.cache,'Oczekujący');
  if(fresh.roles.cache.has(waiting.id)){
   try{await fresh.roles.remove(waiting,'TS gate: akceptacja');}catch(_){console.error('[recruitment] Rola oczekującego wymaga uzgodnienia');}
  }
  try{await recordApproved?.(userId,moderator.id,JSON.parse(candidate.application_json));}catch(_){console.error('[recruitment] Projekcja decyzji wymaga uzgodnienia');}
  Promise.resolve().then(()=>publishApplication?.(userId,JSON.parse(candidate.application_json),'APPROVED')).catch(()=>console.error('[recruitment] Publiczna karta wymaga uzgodnienia'));
  try{await publishDecision({content:`✅ Wniosek zatwierdził <@${moderator.id}>. Rola Member i dostęp potwierdzone.`,components:[],embeds:[],allowedMentions:NO_MENTIONS});}catch(_){console.error('[recruitment] Karta decyzji wymaga odświeżenia');}
  try{await target.send('Twoje zgłoszenie do The Sentenced zostało zaakceptowane. Masz już rangę Member i dostęp do kanałów gildii.');}catch(_){}
  if(store.claimWelcome(userId,Date.now()).ok){
   try{if(await sendWelcome?.(guild,fresh)===true)store.completeWelcome(userId,Date.now());}catch(_){}
  }
  try{await refreshState?.(guild);}catch(_){}
  return {state:ST.APPROVED};
 }

 // TS_ACL_MONITOR_V2: bounded diagnostics; never log applicant content or credentials.
 function tsSafeDiag(error){
  const msg=typeof error?.message==='string'?error.message:'';
  const ec=error?.code;
  let code=Number.isSafeInteger(ec)?'DISCORD_API_'+ec:null;
  const raw=typeof ec==='string'?ec:msg;
  if(!code && /^[A-Z][A-Z0-9_]{2,79}$/.test(raw))code=raw;
  if(!code){const p=msg.split(':',1)[0];if(/^ACL_LEAK_[A-Z0-9_]{1,60}$/.test(p))code=p;else if(p.startsWith('ACL_LEAK_'))code='ACL_LEAK';else if(['ACL_ROLE_UNKNOWN','UNIQUE_ROLE_OR_CHANNEL_REQUIRED','STAFF_DISPATCH_UNCERTAIN','INCOMPLETE_FORM'].includes(p))code=p;}
  const kind=['Error','TypeError','RangeError','ReferenceError','SyntaxError','SqliteError','DiscordAPIError','HTTPError'].includes(error?.name)?error.name:'UnknownError';
  const loc=typeof error?.stack==='string'?error.stack.match(/ts-onboarding-runtime\.cjs:(\d+):(\d+)/):null;
  const channels=msg.startsWith('ACL_LEAK_')?[...msg.matchAll(/\[(\d{17,20})\]/g)].slice(0,12).map(m=>m[1]):[];
  return {code:code||(kind==='TypeError'?'TYPE_ERROR':'UNCLASSIFIED_ERROR'),kind,location:loc?loc[1]+':'+loc[2]:null,channels};
 }
 let tsAclMonitorInstalled=false,tsAclTimer=null,tsAclLast='';
 function tsInstallAclMonitor(guild){
  if(tsAclMonitorInstalled||!guild?.client?.on)return;
  tsAclMonitorInstalled=true;
  let known=[];
  try{const saved=JSON.parse(getSetting(CHANNEL_ACL_KEY)||'[]');if(Array.isArray(saved))known=saved;}catch{}
  let scanning=false;
  const scan=async()=>{
   let diag, problem;
   try{assertHostReady(guild);}catch(e){problem=e;diag=tsSafeDiag(e);}
   const proposals=planChannelRepair(known,guild,config,diag?.channels);
   if(proposals.length){
    try{
     for(const {before,restore} of proposals){
      const live=await guild.channels.fetch(before.id,{force:true});
      if(!live||live.parentId!==before.parentId||overwriteSignature(asChannel(live).permission_overwrites)!==overwriteSignature(before.permission_overwrites))throw Error('CHANNEL_ACL_CHANGED_AGAIN');
      await guild.client.rest.patch('/channels/'+before.id,{body:{permission_overwrites:restore},reason:'Restore verified ACL after a channel move or recruitment access conflict'});
      const confirmed=await guild.channels.fetch(before.id,{force:true});
      if(!confirmed||confirmed.parentId!==before.parentId||overwriteSignature(asChannel(confirmed).permission_overwrites)!==overwriteSignature(restore))throw Error('CHANNEL_ACL_REPAIR_NOT_CONFIRMED');
     }
     assertHostReady(guild);problem=null;
     console.info('[TS_CHANNEL_ACCESS] Restored verified ACL on '+proposals.length+' channel(s)');
    }catch(error){problem=error;diag=tsSafeDiag(error);console.error('[TS_CHANNEL_ACCESS] Repair not confirmed: '+diag.code);}
   }
   if(!problem){
    const snapshot=channelAccess(guild);
    const encoded=JSON.stringify(snapshot);
    if(encoded!==JSON.stringify(known)){setSetting(CHANNEL_ACL_KEY,encoded);known=snapshot;}
    if(tsAclLast)console.info('[TS_ACL_MONITOR_V2] RECOVERED');
    tsAclLast='';return;
   }
   const key=JSON.stringify({code:diag.code,channels:diag.channels});
   if(key===tsAclLast)return;tsAclLast=key;
   console.error('[TS_ACL_MONITOR_V2] '+JSON.stringify(diag));
   // No applicant details, raw errors, or mentions. Do not alert a known exposed staff channel.
   if(diag.code==='STAFF_CHANNEL_EXPOSED')return;
   // Fail closed on unverified staff channel visibility: do not post operational alerts to an exposed channel.
   try{const snap=liveSnapshot(guild);const office=snap.channels.find(c=>c.id===config.staffId);if(!office)return;const allowed=new Set(['GM','Oficer','Raid Lider','SentencedBot']);const ordinary=snap.roles.filter(r=>r.id!==snap.id&&!allowed.has(r.name)&&(BigInt(r.permissions)&8n)===0n);if(office.permission_overwrites.some(o=>o.type===1&&(BigInt(o.allow)&1024n)!==0n))return; if([[],...ordinary.map(r=>[r.id]),ordinary.map(r=>r.id)].some(ids=>ability(calculate({id:snap.id,roles:snap.roles},office,ids),'VIEW_CHANNEL')))return;}catch(_){return;}
   try{const staff=await guild.channels.fetch(config.staffId);if(staff?.type===0 && staff.send)await staff.send({content:'⚠️ Kontrola uprawnień rekrutacji wykryła konflikt. Rekrutacja może być zablokowana. Sprawdź logi TS_ACL_MONITOR_V2 i uprawnienia nowych kanałów. Kod: '+diag.code,allowedMentions:{parse:[]}});}catch(_){console.error('[TS_ACL_MONITOR_V2] STAFF_ALERT_UNDELIVERED');}
  };
  const schedule=(...args)=>{
   if(!args.some(x=>(x?.guild?.id||x?.id)===guild.id))return;
   clearTimeout(tsAclTimer);
   tsAclTimer=setTimeout(async()=>{
    if(scanning){schedule(guild);return;}
    scanning=true;
    try{await scan();}catch(e){console.error('[TS_CHANNEL_ACCESS] Scan error: '+tsSafeDiag(e).code);}
    finally{scanning=false;}
   },1000);
   tsAclTimer.unref?.();
  };
  for(const event of ['channelCreate','channelUpdate','channelDelete','roleCreate','roleUpdate','roleDelete','guildUpdate'])guild.client.on(event,schedule);
  schedule(guild);
 }
 async function ensurePanels(guild){
  if(!enabled)return {enabled:false};tsInstallAclMonitor(guild);assertHostReady(guild);store.migrate();
  const start=await guild.channels.fetch(config.startId);if(!start||start.type!==0)throw Error('START_CHANNEL_NOT_TEXT');
  const rulesChannel=config.rulesId?await guild.channels.fetch(config.rulesId):start;
  if(!rulesChannel||rulesChannel.type!==0)throw Error('RULES_CHANNEL_NOT_TEXT');
  async function upsert(channel,key,payload){
   let msg=null;const id=getSetting(key);
   if(id){try{msg=await channel.messages.fetch(id);if(msg.author?.id!==guild.client.user?.id)throw Error('PANEL_AUTHOR_CHANGED');await msg.edit(payload);}catch(_){msg=null;}}
   if(!msg){msg=await channel.send(payload);setSetting(key,msg.id);}
   return msg;
  }
  await upsert(rulesChannel,'ts_terms_panel_v17',publicTerms.payload);
  await upsert(start,'start_panel_v05',startPanel(config.rulesId));
  const wait=await guild.channels.fetch(config.waitId);if(!wait||wait.type!==0)throw Error('WAIT_CHANNEL_NOT_TEXT');
  const status={allowedMentions:NO_MENTIONS,embeds:[{title:'⏳ Poczekalnia — The Sentenced',description:'Po przesłaniu wniosku czekasz na decyzję GM/Oficera z kanału KADRA → #oficerka. **Member i dostęp nadajemy dopiero po kliknięciu Akceptuj przez kadrę.**'}],components:[]};
  const wid=getSetting('waiting_panel_v01');let wmsg=null;
  if(wid){try{wmsg=await wait.messages.fetch(wid);if(wmsg.author?.id!==guild.client.user?.id)throw Error('WAIT_PANEL_AUTHOR_CHANGED');await wmsg.edit(status);}catch(_){wmsg=null;}}
  if(!wmsg){wmsg=await wait.send(status);setSetting('waiting_panel_v01',wmsg.id);}
  return {enabled:true,rulesHash:hash};
 }
 async function onJoin(member){if(!enabled||member.user.bot||member.guild.id!==guildId)return false;if(memberPreviouslyApproved(member))return false;store.init(member.id,Date.now());return true;}
 function shouldBlockLegacy(i){
  if(!enabled||i.guildId!==guildId||!i.user?.id)return false;
  const id=i.customId||'';
  // Old review cards are never valid under the versioned new staff workflow.
  // Old onboarding / identity buttons are retired for EVERYONE, including
  // the owner and frozen existing members. Other non-recruitment features
  // remain available to grandfathered members without regressions.
  if(id.startsWith('review:')||id.startsWith('onboarding:')||id.startsWith('ident:'))return true;
  if(i.member?.roles?.cache?.has(onlyOneByName(i.guild.roles.cache,config.accessRoleName).id))return false;
  if(i.commandName==='ekipa'&&(i.user.id===i.guild.ownerId||i.member?.roles?.cache?.some?.(role=>['GM','Oficer'].includes(role.name))))return false;
  // A new applicant may only use ts:* interactions, not older menus,
  // old /slash commands or veteran/guild side doors.
  if(id.startsWith('ts:'))return false;
  if(id)return true;
  return Boolean(i.isChatInputCommand?.());
 }
 async function handle(i){
  if(!enabled||!i.customId?.startsWith('ts:'))return false;
  try{
   const id=i.customId;
   const isDecision=id.startsWith('ts:review:');
   const isTerms=id.startsWith('ts:terms:');
   const expectedChannel=isDecision?config.staffId:isTerms?(config.rulesId||config.startId):config.startId;
   if(config.rulesId && i.channelId!==expectedChannel)throw Error('WRONG_CHANNEL');
   if(isDecision && i.deferUpdate)await i.deferUpdate();
   if((id.startsWith('ts:terms:accept:')||id==='ts:modal:oldnick'||id==='ts:apply:send:v2')&&i.deferReply)await i.deferReply({flags:EPH});
   assertHostReady(i.guild);
   if(isDecision){const parts=id.split(':');if(parts.length!==5)throw Error('INVALID_STAFF_ACTION');await decision(i,parts[2],parts[3],Number(parts[4]));return true;}
   const m=await verifiedMember(i);
   if(memberPreviouslyApproved(m))throw Error('ALREADY_APPROVED_LEGACY_MEMBER');
   if(id.startsWith('ts:terms:decline:')){await answer(i,ep('Bez akceptacji aktualnego regulaminu nie można wysłać wniosku ani otrzymać Member.'));return true;}
   if(id.startsWith('ts:terms:accept:')){
    if(id.split(':')[3]!==hash.slice(0,16))throw Error('OUTDATED_RULES_CARD');
    if(m.pending!==false)throw Error('NATIVE_RULES_SCREENING_NOT_FINISHED');store.init(m.id,Date.now());
    // Repeated ACCEPT is a role-recovery operation, not permission to discard an unfinished draft.
    const prior=store.get(m.id);
    if(!(prior?.terms_hash===hash && prior?.accepted_at && [ST.ACCEPTED,ST.DRAFT].includes(prior.state))){
      const r=store.accept(m.id,hash,Date.now(),{nativePending:m.pending});if(!r.ok)throw Error(r.reason);
    }
    // Waiting has NO access to guild channels. It only exposes #poczekalnia.
    // Assign AFTER explicit terms consent and AFTER native screening; never on raw GuildMemberAdd.
    const waitingRole=onlyOneByName(i.guild.roles.cache,'Oczekujący');
    if(!m.roles.cache.has(waitingRole.id)){
      await m.roles.add(waitingRole,'TS onboarding: regulamin zaakceptowany');
      const verified=await fetchMember(i.guild,m.id);
      if(!verified.roles.cache.has(waitingRole.id))throw Error('WAITING_ROLE_READBACK_FAILED');
    }
    await answer(i,ep(`✅ Regulamin zaakceptowany. Przejdź do <#${config.startId}> i kliknij „Dołącz do The Sentenced”.`));return true;
   }
   const row=store.get(m.id);requireCurrent(i,row,m);
   if(id==='ts:apply:start:v1'){await answer(i,{...branchCard(),flags:EPH});return true;}
   if(id.startsWith('ts:apply:branch:')){
    const old=id.endsWith(':yes'),fresh=id.endsWith(':no');if(!old&&!fresh)throw Error('INVALID_BRANCH');
    draftSave(i,m,{wasMember:old?'TAK':'NIE'});
    if(old)await i.showModal(mkModal(discord,'ts:modal:oldnick','The Sentenced — dawny członek',[{id:'nick',label:'Dawny nick w The Sentenced',max:60},{id:'gameNick',label:'Pełny nick postaci w grze',max:60}]));
    else await i.showModal(mkModal(discord,'ts:modal:basic','The Sentenced — rekrutacja',[{id:'firstName',label:'Jak masz na imię?',max:80},{id:'age',label:'Ile masz lat?',max:3},{id:'race',label:'Rasa postaci',max:80},{id:'spec',label:'Specjalizacja postaci',max:80},{id:'professions',label:'Profesje (oddziel przecinkami)',max:200}]));
    return true;
   }
   if(id==='ts:modal:oldnick'){
    const nick=i.fields.getTextInputValue('nick').trim(),gameNick=i.fields.getTextInputValue('gameNick').trim();if(!basicText(nick,60))throw Error('INVALID_OLD_NICK');if(!basicText(gameNick,60))throw Error('GAME_NICK_REQUIRED');const app={wasMember:'TAK',oldNick:nick,gameNick};
    await showSource(i,m,app);return true;
   }
   if(id==='ts:modal:basic'){
    const get=x=>i.fields.getTextInputValue(x).trim();const age=Number(get('age'));
    const firstName=get('firstName'),race=get('race'),spec=get('spec'),professions=get('professions').split(',').map(x=>x.trim()).filter(Boolean);
    if(!basicText(firstName,80)||!Number.isInteger(age)||age<13||age>99||!basicText(race,80)||!basicText(spec,80)||professions.length>3||professions.some(p=>!basicText(p,80)))throw Error('INVALID_BASIC_FORM');
    await stepMessage(i,m,{firstName,age,race,spec,professions},'Wybierz klasę postaci:',[menu('ts:select:class','Klasa',ALLOWED_CLASSES.map(x=>[x,x]))]);return true;
   }
   if(id==='ts:select:class'){
    const wowClass=i.values?.[0];if(!ALLOWED_CLASSES.includes(wowClass))throw Error('BAD_CLASS');
    draftSave(i,m,{wowClass});await i.showModal(mkModal(discord,'ts:modal:game-nick','Twoja postać w grze',[{id:'gameNick',label:'Pełny nick postaci w grze',max:60}]));return true;
   }
   if(id==='ts:modal:game-nick'){
    const gameNick=i.fields.getTextInputValue('gameNick').trim();if(!basicText(gameNick,60))throw Error('GAME_NICK_REQUIRED');
    await stepMessage(i,m,{gameNick},'Wybierz styl gry (możesz zaznaczyć kilka):',[menu('ts:select:styles','Styl gry',STYLES.map(x=>[x,x]),3)]);return true;
   }
   if(id==='ts:modal:game-nick-final'){const gameNick=i.fields.getTextInputValue('gameNick').trim();if(!basicText(gameNick,60))throw Error('GAME_NICK_REQUIRED');await showReview(i,m,{gameNick});return true;}
   if(id==='ts:select:styles'){
    const x=i.values;if(!Array.isArray(x)||!x.length||x.length>3||x.some(y=>!STYLES.includes(y))||new Set(x).size!==x.length)throw Error('BAD_PLAYSTYLES');
    await stepMessage(i,m,{playstyles:x},'Czy planujesz raidować?',controls(button('Tak','ts:raid:yes',3),button('Nie','ts:raid:no',2)));return true;
   }
   if(id==='ts:raid:yes'){draftSave(i,m,{raidPlan:true});await i.showModal(mkModal(discord,'ts:modal:hours','The Sentenced — raidowanie',[{id:'hours',label:'Ile godzin tygodniowo?',max:5}]));return true;}
   if(id==='ts:raid:no'){await showSource(i,m,{raidPlan:false,raidHoursWeek:undefined,raidDays:undefined});return true;}
   if(id==='ts:modal:hours'){
    const hours=Number(i.fields.getTextInputValue('hours').trim().replace(',','.'));if(!Number.isFinite(hours)||hours<=0||hours>168)throw Error('BAD_RAID_HOURS');
    await stepMessage(i,m,{raidHoursWeek:hours},'Wybierz dni odpowiednie na rajdy (wiele):',[menu('ts:select:days','Dni tygodnia',DAYS,7)]);return true;
   }
   if(id==='ts:select:days'){
    const days=i.values;const allowed=DAYS.map(x=>x[0]);if(!Array.isArray(days)||!days.length||days.some(x=>!allowed.includes(x))||new Set(days).size!==days.length)throw Error('BAD_RAID_DAYS');
    await showSource(i,m,{raidDays:days});return true;
   }
   if(id==='ts:source:ingame'){await showReferralReview(i,m,{referralSource:'Ingame'});return true;}
   if(id==='ts:source:other'){
    await i.showModal(mkModal(discord,'ts:modal:referral-source','Skąd dowiedziałeś się o gildii?',[{id:'source',label:'Inne źródło — jakie?',max:120}]));
    return true;
   }
   if(id==='ts:modal:referral-source'){
    const source=i.fields.getTextInputValue('source').trim();
    if(!basicText(source,120)){
     await answer(i,ep('Podaj nazwę źródła (maksymalnie 120 znaków).',controls(button('Inne źródło','ts:source:other',1))));
     return true;
    }
    await showReferralReview(i,m,{referralSource:'Inne źródło: '+source});
    return true;
   }
   if(id==='ts:focus:open'){
    await i.showModal(mkModal(discord,'ts:modal:play-focus','Casual czy PvE?',[
     {id:'playFocus',label:'Jak zagrasz i jak to pogodzisz?',max:400,paragraph:true}
    ]));return true;
   }
   if(id==='ts:modal:play-focus'){
    const playFocus=i.fields.getTextInputValue('playFocus').trim().replace(/\r?\n/g,' ');
    if(!basicText(playFocus,400)){await showFocus(i,m);return true;}
    await showReview(i,m,{playFocus});return true;
   }
   if(id==='ts:apply:send:v2'){
    const row=store.get(m.id);requireCurrent(i,row,m);
    const app=draftDecode(row);if(!basicText(app.referralSource,133)){await showSource(i,m);return true;}if(app.wasMember==='NIE'&&!basicText(app.playFocus,400)){await showFocus(i,m);return true;}if(!validApplication(app).allowed)throw Error('INCOMPLETE_APPLICATION');
    await answer(i,ep(await submit(i,m,app)));return true;
   }
   throw Error('UNKNOWN_INTERACTION');
  }catch(error){
    // TS_ONBOARDING_ERROR_DIAG_V2
   const diag=tsSafeDiag(error);const safeCode=diag.code;
   const stage=i.customId?.startsWith('ts:apply:branch:')?'BRANCH_MODAL':i.customId==='ts:apply:start:v1'?'START_PANEL':i.customId?.startsWith('ts:modal:')?'MODAL_SUBMIT':i.customId?.startsWith('ts:terms:')?'TERMS':i.customId?.startsWith('ts:apply:')?'APPLICATION':'OTHER';
   console.error('[TS_ONBOARDING_ERROR_DIAG_V2] '+JSON.stringify({stage,...diag}));
   const messages={
    ALREADY_APPROVED_LEGACY_MEMBER:'Masz już dostęp do gildii. Otwórz **/bot**, żeby przejść do panelu gracza.',
    NATIVE_RULES_SCREENING_NOT_FINISHED:'Najpierw zakończ weryfikację w Discordzie, a potem wróć do regulaminu.',
    GAME_NICK_REQUIRED:'Podaj pełny nick postaci w grze, aby kadra mogła Cię znaleźć.',
    WAITING_ROLE_MISSING:'Przejdź do regulaminu i kliknij „Akceptuję”, żeby odblokować formularz.',
    NO_CURRENT_TERMS_CONSENT:'Najpierw zaakceptuj aktualny regulamin gildii.',
    INVALID_CANDIDATE_STATE:'Nie można zatwierdzić: wniosek lub zgoda na aktualny regulamin są nieaktualne. Poproś kandydata o sprawdzenie regulaminu i formularza; ręczna rola nie zastępuje zgody.',
    CANDIDATE_NATIVE_SCREENING_PENDING:'Kandydat musi najpierw zakończyć weryfikację w Discordzie.',
    STALE_OR_FORGED_STAFF_CARD:'Ta karta zgłoszenia jest nieaktualna. Sprawdź najnowszy wniosek kandydata.',
    GRANT_UNCERTAIN_MANUAL_RECONCILIATION_REQUIRED:'⚠️ Nie potwierdzono nadania obu ról. Kadra musi sprawdzić stan decyzji i role kandydata.',
   };
   const msg=(messages[error.message]||'⚠️ Nie można kontynuować. Sprawdź aktualny regulamin i formularz albo skontaktuj się z kadrą.')+' [kod: '+safeCode+']';
   if(i.isRepliable?.()){try{if(i.deferred&&i.customId.startsWith('ts:review:'))await i.followUp(ep(msg));else if(i.deferred)await i.editReply({content:msg});else if(i.replied)await i.followUp(ep(msg));else await i.reply(ep(msg));}catch(_){}}
   return true;
  }
 }
 return {enabled,store,termsHash:hash,ensurePanels,onJoin,handle,shouldBlockLegacy,reviewQueue,reviewApplication,requireModerator,aclInvariant:guild=>aclInvariant(guild,config),assertHostReady};
}
module.exports={createRuntime,aclInvariant,liveSnapshot,channelAccess,planChannelRepair};
