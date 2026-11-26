'use strict';
const {createHash}=require('node:crypto');
const {inviteContacts}=require('./invite-contacts.cjs');
function text(s,max=100){return String(s||'').replace(/@/g,'＠').replace(/[`*_~|\\]/g,'\\$&').replace(/[\r\n]/g,' ').slice(0,max);}
function applicationFields(app){
 const labels=[['Czy dawny członek','wasMember'],['Dawny nick','oldNick'],['Nick w grze','gameNick'],['Imię','firstName'],['Wiek','age'],['Klasa','wowClass'],['Rasa','race'],['Specjalizacja','spec'],['Profesje','professions'],['Styl gry','playstyles'],['Planuje rajdy','raidPlan'],['Godziny tygodniowo','raidHoursWeek'],['Dni','raidDays'],['O sobie','about'],['Skąd dowiedziałeś się o gildii?','referralSource'],['Casual czy PvE? Jak to pogodzisz?','playFocus']];
 return labels.filter(([,key])=>Object.hasOwn(app,key)).map(([name,key])=>{let v=app[key];v=Array.isArray(v)?v.join(', '):typeof v==='boolean'?(v?'Tak':'Nie'):String(v??'');return {name,value:text(v,1000)||'—',inline:false};});
}
function createPublicApplications({db,guild,forumId,clock=Date.now}){
 const updates=new Map(),versions=new Map();
 db.exec("CREATE TABLE IF NOT EXISTS ts_public_applications(user_id TEXT PRIMARY KEY,thread_id TEXT,state TEXT NOT NULL,desired_status TEXT NOT NULL,updated_at INTEGER NOT NULL)");
 const get=db.prepare('SELECT * FROM ts_public_applications WHERE user_id=?');
 db.exec('CREATE TABLE IF NOT EXISTS ts_public_application_welcomes(thread_id TEXT PRIMARY KEY, message_id TEXT, started_at INTEGER NOT NULL)');
 const claimWelcome=db.prepare('INSERT OR IGNORE INTO ts_public_application_welcomes(thread_id,started_at) VALUES(?,?)');
 const confirmWelcome=db.prepare('UPDATE ts_public_application_welcomes SET message_id=? WHERE thread_id=?');
 async function welcome(thread,userId,status){
  if(status!=='APPROVED'||get.get(userId)?.desired_status!=='APPROVED'||typeof thread.send!=='function')return;
  if(claimWelcome.run(thread.id,clock()).changes!==1)return;
  try{
   const nonce=createHash('sha256').update('application-welcome:'+thread.id).digest('hex').slice(0,24);
   const message=await thread.send({
    content:`⚔️ Witaj w **The Sentenced**, <@${userId}>! Po zaproszenie do gildii w grze napisz do jednej z tych postaci: ${inviteContacts(true)}. Do zobaczenia w grze!`,
    allowedMentions:{parse:[],users:[userId]},nonce,enforceNonce:true,
   });
   confirmWelcome.run(message.id,thread.id);
  }catch(error){console.error('[recruitment] FORUM_WELCOME_UNCONFIRMED',Number.isInteger(error.code)?error.code:'DISPATCH');}
 }
 const reserve=db.prepare("INSERT INTO ts_public_applications(user_id,state,desired_status,updated_at) VALUES(?,'CREATING',?,?) ON CONFLICT(user_id) DO NOTHING");
 const desired=db.prepare('UPDATE ts_public_applications SET desired_status=?,updated_at=? WHERE user_id=?');
 const release=db.prepare("DELETE FROM ts_public_applications WHERE user_id=? AND state='CREATING' AND thread_id IS NULL");
 const finish=db.prepare("UPDATE ts_public_applications SET thread_id=?,state='READY',updated_at=? WHERE user_id=?");
 const uncertain=db.prepare("UPDATE ts_public_applications SET state='UNCERTAIN',updated_at=? WHERE user_id=? AND state='CREATING'");
 function payload(userId,app,status){
  const character=text(app.gameNick||app.displayName||'Członek gildii'),klass=text(app.wowClass||'niepodana');
  const label=status==='PENDING'?'Oczekuje na decyzję kadry':status==='APPROVED'?'Przyjęto do gildii':'Zgłoszenie zamknięte';
  return {name:`Zgłoszenie • ${character}`.slice(0,100),message:{content:`⚔️ **${character}**\nKandydat: <@${userId}>\n${app.gameNick?'Nick w grze: '+text(app.gameNick):'Nick w grze: niepodany'}\nKlasa: ${klass}\nStatus: **${label}**\n\nMożecie przywitać i wesprzeć gracza w tym wątku.`,allowedMentions:{parse:[]},embeds:[{title:'Odpowiedzi kandydata',fields:applicationFields(app)}],components:[]},marker:createHash('sha256').update(userId).digest('hex').slice(0,12)};
 }
 async function update(userId,app,status){
  if(!/^\d{17,20}$/.test(userId)||!['PENDING','APPROVED','REJECTED'].includes(status))throw Error('PUBLIC_APPLICATION_INVALID');
  const created=Number(reserve.run(userId,status,clock()).changes)===1;
  if(!created)desired.run(status,clock(),userId);
  const state=get.get(userId);if(!created && ['UNCERTAIN','CREATING'].includes(state.state))return {status:state.state};
  const version=state.thread_id?(versions.get(userId)||0)+1:0;
  if(version)versions.set(userId,version);
  let forum,tags;try {
   forum=await guild.channels.fetch(forumId);if(!forum||forum.type!==15)throw Error('PUBLIC_FORUM_UNAVAILABLE');
   const tagName=status==='PENDING'?'Oczekujące':'Ostatnie';tags=forum.availableTags.filter(x=>x.name===tagName);if(tags.length!==1)throw Error('PUBLIC_TAG_INVALID');
  }catch(e){if(created)release.run(userId);throw e;}
  const p=payload(userId,app,status);
  if(state.thread_id){
   // Discord edits are asynchronous: serialize updates for one application so
   // an older pending edit cannot finish after a newer staff decision.
   const previous=updates.get(userId)||Promise.resolve();
   const job=previous.catch(()=>{}).then(async()=>{
    if(versions.get(userId)!==version)return {status:'SUPERSEDED'};
    const thread=await guild.channels.fetch(state.thread_id);if(!thread||thread.parentId!==forumId)throw Error('PUBLIC_THREAD_MISSING');
    if(thread.archived)await thread.setArchived(false);const first=await thread.fetchStarterMessage();if(!first||first.author.id!==guild.client.user.id)throw Error('PUBLIC_THREAD_AUTHOR');
    await first.edit(p.message);await thread.setName(p.name);await thread.setAppliedTags([tags[0].id]);finish.run(thread.id,clock(),userId);await welcome(thread,userId,status);return {status:'UPDATED'};
   });
   updates.set(userId,job);
   try{return await job;}finally{if(updates.get(userId)===job)updates.delete(userId);}
  }
  // Never blindly retry a create that may have reached Discord.
  try{
   const thread=await forum.threads.create({name:p.name,appliedTags:[tags[0].id],message:p.message});
   finish.run(thread.id,clock(),userId);const latest=get.get(userId);if(latest.desired_status!==status)return update(userId,app,latest.desired_status);await welcome(thread,userId,status);return {status:'CREATED'};
  }catch(e){uncertain.run(clock(),userId);throw e;}
 }
 async function handle(i){
  if(i.customId!=='pubapp:view')return false;
  await i.deferReply({flags:64});
  try{
   if(i.guildId!==guild.id||i.channel?.parentId!==forumId)throw Error('NOT_ALLOWED');
   const member=await i.guild.members.fetch({user:i.user.id,force:true});
   if(member.user?.bot||member.pending!==false||!(member.id===guild.ownerId||member.roles.cache.some(r=>['GM','Oficer'].includes(r.name))))throw Error('NOT_ALLOWED');
   const row=db.prepare("SELECT g.application_json FROM ts_public_applications p JOIN ts_onboarding_gate g ON g.user_id=p.user_id WHERE p.thread_id=? AND p.state='READY'").get(i.channelId);if(!row?.application_json)throw Error('NOT_FOUND');
   const app=JSON.parse(row.application_json);if(!app||typeof app!=='object'||Array.isArray(app))throw Error('NOT_FOUND');
   const fields=applicationFields(app);
   await i.editReply({content:'Pełny wniosek widoczny tylko dla Ciebie.',embeds:[{title:'Wniosek rekrutacyjny • kadra',fields}],allowedMentions:{parse:[]}});
  }catch(e){await i.editReply({content:e.message==='NOT_ALLOWED'?'Pełny wniosek jest dostępny wyłącznie dla GM i oficerów.':'Nie można odczytać tego wniosku.',allowedMentions:{parse:[]}});}
  return true;
 }
 return {update,handle};
}
module.exports={createPublicApplications};
