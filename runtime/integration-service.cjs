'use strict';
const {channelId,STAFF_POST_CHANNELS}=require('./guild-channel-ids.cjs');
const crypto=require('node:crypto');const {hash,profile,updateProfile,raidState,recordRaidSignup,lfgState:readLfg}=require('./guild-actions.cjs');
function actorName(value){if(typeof value!=='string'||value.length<3||value.length>120||!value.includes('-')||/[\x00-\x1f|<>]/.test(value))throw Error('Pełny nick postaci i realm są wymagane');return value.normalize('NFC')}
module.exports=function createGateway({db,guild,hasPlayer,hasStaff,refreshProfile,refreshRaid,recordVote,refreshPoll,joinExpedition,refreshLfg,createLfg,getChannel,reviewQueue,reviewApplication,authorizeStaff}){
 db.exec(`CREATE TABLE IF NOT EXISTS addon_links(character TEXT PRIMARY KEY,user_id TEXT NOT NULL UNIQUE,linked_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS addon_pair_codes(code_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS addon_requests(user_id TEXT NOT NULL,request_id TEXT NOT NULL,payload_hash TEXT NOT NULL,status TEXT NOT NULL,result_json TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(user_id,request_id));`);
 const active=new Set(),pairAttempts=new Map();
 async function member(id){const m=await guild.members.fetch({user:id,force:true});if(!hasPlayer(m))throw Error('Brak aktualnego dostępu członka gildii');return m}
 async function issuePairCode(id){await member(id);const code=crypto.randomBytes(9).toString('hex').toUpperCase();db.transaction(()=>{db.prepare('DELETE FROM addon_pair_codes WHERE user_id=? OR expires_at<?').run(id,Date.now());db.prepare('INSERT INTO addon_pair_codes VALUES(?,?,?)').run(hash(code),id,Date.now()+600000)})();return code}
 async function pair(character,code,request,expectedUserId){
  const existingLink=db.prepare("SELECT user_id FROM addon_links WHERE character=?").get(character);
  if(existingLink&&expectedUserId!==undefined&&existingLink.user_id!==expectedUserId)throw Error('Powiązanie postaci zmieniło się');
  if(existingLink){const saved=db.prepare("SELECT * FROM addon_requests WHERE user_id=? AND request_id=?").get(existingLink.user_id,request.id);if(saved){if(saved.payload_hash!==hash(request))throw Error("ID żądania ma inną treść");await member(existingLink.user_id);return JSON.parse(saved.result_json)}}
  character=actorName(character);const attempts=pairAttempts.get(character)||[];const recent=attempts.filter(x=>Date.now()-x<60000);if(recent.length>=5)throw Error('Odczekaj minutę przed kolejnym kodem');recent.push(Date.now());pairAttempts.set(character,recent);if(pairAttempts.size>1000)pairAttempts.delete(pairAttempts.keys().next().value);
  if(typeof code!=='string'||!/^[A-F0-9]{18}$/.test(code.toUpperCase()))throw Error('Nieprawidłowy kod');const key=hash(code.toUpperCase());const row=db.prepare('SELECT * FROM addon_pair_codes WHERE code_hash=? AND expires_at>?').get(key,Date.now());
  if(!row)throw Error('Kod wygasł albo został wykorzystany');if(expectedUserId!==undefined&&row.user_id!==expectedUserId)throw Error('Kod należy do innego konta');await member(row.user_id);
  return db.transaction(()=>{
   if(!db.prepare('SELECT code_hash FROM addon_pair_codes WHERE code_hash=? AND expires_at>?').get(key,Date.now()))throw Error('Kod wygasł');
   const old=db.prepare('SELECT * FROM addon_links WHERE character=?').get(character);if(old&&old.user_id!==row.user_id)throw Error('Postać ma już inne powiązanie');
   db.prepare('DELETE FROM addon_links WHERE user_id=?').run(row.user_id);db.prepare('INSERT INTO addon_links VALUES(?,?,?) ON CONFLICT(character) DO UPDATE SET user_id=excluded.user_id,linked_at=excluded.linked_at').run(character,row.user_id,Date.now());db.prepare('DELETE FROM addon_pair_codes WHERE code_hash=?').run(key);const result={linked:true};db.prepare('INSERT INTO addon_requests VALUES(?,?,?,?,?,?)').run(row.user_id,request.id,hash(request),'done',JSON.stringify(result),Date.now());return result;
  })();
 }
 async function channel(id,userId,write=false,knownMember){if(!/^\d{17,20}$/.test(id||''))throw Error('Nieprawidłowy kanał');const c=await guild.channels.fetch(id),m=knownMember||await member(userId);const permissions=c?.permissionsFor(m);if(!c||c.guildId!==guild.id||c.type!==0||['oficerka','poczekalnia'].includes(c.name)||!permissions?.has(['ViewChannel','ReadMessageHistory'])||(write&&!permissions.has('SendMessages')))throw Error('Brak dostępu do kanału');return c}
 function pollState(p,userId){const options=JSON.parse(p.options_json);const own=db.prepare('SELECT option_index,voted_at FROM poll_votes WHERE poll_id=? AND user_id=?').get(p.id,userId);return {id:p.id,question:p.question,status:p.status,options,own_option:own?.option_index??null,counts:options.map((_,i)=>db.prepare('SELECT COUNT(*) n FROM poll_votes WHERE poll_id=? AND option_index=?').get(p.id,i).n),revision:hash({options,status:p.status,question:p.question,own:own||null})}}
 function lfgState(e,userId){return readLfg(db,e.id,userId)}
 async function domainChannel(name,userId,knownMember){const c=getChannel?getChannel(guild,name):[...guild.channels.cache.values()].find(x=>x.name===name);if(!c)throw Error('Brak kanału '+name);return channel(c.id,userId,false,knownMember)}
 async function snapshot(userId,payload={}){
  const m=await member(userId);const p=profile(db,userId);const result={profile:p.value,profileRevision:p.revision,checkedAt:Date.now(),userLabel:m.displayName||'Członek gildii',polls:[],raids:[],lfg:[],channels:[],messages:[]};
  for(const poll of db.prepare('SELECT * FROM polls WHERE guild_id=? ORDER BY id DESC LIMIT 20').all(guild.id)){try{await channel(poll.channel_id,userId,false,m);result.polls.push(pollState(poll,userId))}catch{}}
  for(const r of db.prepare('SELECT * FROM raids ORDER BY scheduled_ts DESC LIMIT 20').all()){try{await domainChannel('zapisy',userId,m);result.raids.push(raidState(db,r.id,userId))}catch{}}
  for(const e of db.prepare("SELECT * FROM expeditions WHERE status='OPEN' AND expires_at>? ORDER BY expires_at LIMIT 20").all(Date.now())){try{await domainChannel('wyprawy',userId,m);result.lfg.push(lfgState(e,userId))}catch{}}
  await guild.channels.fetch();result.channels=[...guild.channels.cache.values()].filter(c=>c.type===0&&!['oficerka','poczekalnia'].includes(c.name)&&c.permissionsFor(m)?.has(['ViewChannel','ReadMessageHistory'])).map(c=>({id:c.id,name:c.name,writable:c.permissionsFor(m).has('SendMessages')}));
  if(payload.channel){const c=await channel(payload.channel,userId,false,m);const messages=await c.messages.fetch({limit:20,cache:false});result.messages=[...messages.values()].reverse().map(x=>({id:x.id,author:x.member?.displayName||x.author.globalName||x.author.username,content:x.content,time:x.createdTimestamp,media:[...x.attachments.values()].map(a=>({name:a.name,type:a.contentType||'plik'})).concat(x.stickers.size?[{name:'naklejka',type:'naklejka'}]:[])}))}
  return result;
 }
 async function refresh(result){if(result.refresh==='profile')await refreshProfile();else if(result.refresh==='raid')await refreshRaid(result.raid_id);else if(result.refresh==='poll'){const poll=db.prepare('SELECT * FROM polls WHERE id=? AND guild_id=?').get(result.poll_id,guild.id);if(!poll||!(await refreshPoll(poll)))throw Error('Panel Discord jeszcze nieodświeżony')}else if(result.refresh==='lfg')await refreshLfg(result.expedition_id)}
 async function perform(character,cmd,expectedUserId){
  if(require('./maintenance.cjs').maintenance(db))return {id:cmd?.id,status:'maintenance',error:'Prace serwisowe. Zmiana pozostaje w kolejce'};
  character=actorName(character);if(!cmd||typeof cmd.id!=='string'||!/^[a-f0-9]{16}$/.test(cmd.id)||typeof cmd.operation!=='string')throw Error('Nieprawidłowe żądanie');
  if(Buffer.byteLength(JSON.stringify(cmd))>65536)throw Error('Limit danych');
  if(cmd.payload!==undefined&&(!cmd.payload||typeof cmd.payload!=='object'||Array.isArray(cmd.payload)))throw Error('Nieprawidłowy payload');
  if(cmd.operation==='pair'){try{return {id:cmd.id,status:'accepted',...await pair(character,cmd.payload?.code,cmd,expectedUserId)}}catch{return {id:cmd.id,status:'rejected',error:'Kod wygasł, jest nieprawidłowy lub powiązanie jest niedozwolone'}}}
  const link=db.prepare('SELECT user_id FROM addon_links WHERE character=?').get(character);if(!link)return {id:cmd.id,status:'unlinked',error:'Połącz postać przez /profil moj na Discordzie'};
  const userId=link.user_id;if(expectedUserId!==undefined&&userId!==expectedUserId)throw Error('Powiązanie postaci zmieniło się');const m=await member(userId);
  if(cmd.operation==='snapshot')return {id:cmd.id,status:'snapshot',snapshot:await snapshot(userId,cmd.payload)};
  if(cmd.operation==='staff.review.list'||cmd.operation==='staff.review.decide'){
   if(!reviewQueue||!reviewApplication)return {id:cmd.id,status:'rejected',error:'Panel kadry jest niedostępny'};
   const payload=cmd.payload||{};
   try{
    if(cmd.operation==='staff.review.list')return {id:cmd.id,status:'snapshot',staff:await reviewQueue(userId,payload.page)};
    const decision=await reviewApplication(userId,payload.action,payload.user_id,payload.revision);
    const staff=await reviewQueue(userId,payload.page).catch(()=>({page:1,hasMore:false,applications:[]}));
    return {id:cmd.id,status:'accepted',decision,staff};
   }catch(error){
    if(['STALE_STAFF_CARD','STALE_OR_FORGED_STAFF_CARD','INVALID_CANDIDATE_STATE','RACE_OR_STATE_CHANGED'].includes(error?.message))
     return {id:cmd.id,status:'conflict',error:'Wniosek lub zgoda uległy zmianie. Odśwież kolejkę wniosków.'};
    if(error?.message==='CANDIDATE_NATIVE_SCREENING_PENDING')return {id:cmd.id,status:'rejected',error:'Kandydat musi zakończyć weryfikację Discord.'};
    if(error?.message==='GRANT_UNCERTAIN_MANUAL_RECONCILIATION_REQUIRED')return {id:cmd.id,status:'uncertain',error:'Sprawdź stan ról i wniosku na Discordzie.'};
    return {id:cmd.id,status:'rejected',error:'Sprawdź dostęp kadry i aktualny stan wniosku.'};
   }
  }
  let staffDestination;
  if(cmd.operation==='staff.post'){
   const payload=cmd.payload||{};
   if(typeof payload.channel!=='string'||!Object.hasOwn(STAFF_POST_CHANNELS,payload.channel)||
      typeof payload.content!=='string'||!payload.content.trim()||Buffer.byteLength(payload.content)>380||
      /[\x00-\x1f\x7f]/.test(payload.content))return {id:cmd.id,status:'rejected',error:'Wybierz kanał i wpisz do 380 bajtów tekstu w jednym wierszu.'};
   try{
    if(!authorizeStaff)throw Error('STAFF_FEATURE_UNAVAILABLE');
    const {moderator}=await authorizeStaff(userId);
    const id=channelId(guild,STAFF_POST_CHANNELS[payload.channel]);
    const destination=id&&await guild.channels.fetch(id,{force:true});
    const bot=guild.members.me||await guild.members.fetchMe();
    if(!destination||destination.guildId!==guild.id||destination.type!==0||
       !destination.permissionsFor(moderator)?.has(['ViewChannel','SendMessages'])||
       !destination.permissionsFor(bot)?.has(['ViewChannel','SendMessages']))throw Error('STAFF_CHANNEL_DENIED');
    staffDestination=destination;
   }catch{return {id:cmd.id,status:'rejected',error:'Wymagana jest rola GM lub Oficer oraz prawo pisania na tym kanale.'};}
  }
  if(cmd.operation==='raid.signup')await domainChannel('zapisy',userId);
  if(cmd.operation.startsWith('lfg.'))await domainChannel('wyprawy',userId);
  if(cmd.operation==='chat.send')await channel(cmd.payload?.channel,userId,true);
  if(cmd.operation==='poll.vote'){const p=db.prepare('SELECT * FROM polls WHERE id=? AND guild_id=?').get(cmd.payload?.poll_id,guild.id);if(!p)throw Error('Brak ankiety');await channel(p.channel_id,userId)}
  const key=userId+':'+cmd.id,cmdHash=hash(cmd),old=db.prepare('SELECT * FROM addon_requests WHERE user_id=? AND request_id=?').get(userId,cmd.id);
  if(old){if(old.payload_hash!==cmdHash)return {id:cmd.id,status:'conflict',error:'ID żądania ma inną treść'};return {...JSON.parse(old.result_json),id:cmd.id,status:old.status==='done'?'accepted':old.status}}
  if(active.has(key)||active.size>=8)return {id:cmd.id,status:'busy',error:'Trwa poprzednia operacja'};active.add(key);
  try{
   const payload=cmd.payload||{};let result;
   if(['profile.update','raid.signup','poll.vote','lfg.join','lfg.leave','lfg.close'].includes(cmd.operation)&&typeof cmd.expected_revision!=='string')return {id:cmd.id,status:'rejected',error:'Brak rewizji'};
   if(cmd.operation==='poll.vote'){const poll=db.prepare('SELECT * FROM polls WHERE id=? AND guild_id=?').get(payload.poll_id,guild.id);if(!poll)return {id:cmd.id,status:'rejected',error:'Nie ma tej ankiety'};if(!Number.isSafeInteger(payload.option_index))return {id:cmd.id,status:'rejected',error:'Nieprawidłowy głos'};await channel(poll.channel_id,userId)}
   if(cmd.operation==='raid.signup')await domainChannel('zapisy',userId);
   if(cmd.operation.startsWith('lfg.')&&cmd.operation!=='lfg.create'){const expedition=db.prepare('SELECT * FROM expeditions WHERE id=?').get(payload.expedition_id);if(!expedition)return {id:cmd.id,status:'rejected',error:'Nie ma tej wyprawy'};await domainChannel('wyprawy',userId)}
   if(cmd.operation==='chat.send'||staffDestination){
    const c=staffDestination||await channel(payload.channel,userId,true);if(typeof payload.content!=='string'||!payload.content.trim()||payload.content.length>1800)return {id:cmd.id,status:'rejected',error:'Wiadomość: 1–1800 znaków'};
    db.prepare('INSERT INTO addon_requests VALUES(?,?,?,?,?,?)').run(userId,cmd.id,cmdHash,'uncertain',JSON.stringify({error:'Wysyłanie rozpoczęte; nie powtarzamy wiadomości przy niepewnym wyniku'}),Date.now());
    const title=String(m.displayName||'Członek gildii').replace(/[^\p{L}\p{N} .'-]/gu,'').slice(0,80)||'Kadra';
    const prefix=staffDestination?'Kadra The Sentenced · '+title:title+' · WoW';
    try{
     const msg=await c.send({content:'**'+prefix+'**\n'+payload.content.trim(),allowedMentions:{parse:[]},nonce:hash(key).slice(0,24),enforceNonce:true});
     result={message_id:msg.id};
    }catch(error){
     if(!staffDestination)throw error;
     return {id:cmd.id,status:'uncertain',error:'Nie potwierdzono publikacji. Sprawdź kanał Discord przed ponowieniem.'};
    }
   }else{
    result=db.transaction(()=>{
     let outcome;
     if(cmd.operation==='lfg.create'){const created=require('./lfg-actions.cjs').createExpedition(db,userId,payload);outcome=created.error?created:{refresh:'lfg',expedition_id:created.id}}
     else if(cmd.operation==='profile.update'){outcome=updateProfile(db,userId,cmd.expected_revision,payload);outcome.refresh='profile'}
     else if(cmd.operation==='poll.vote'){
      const poll=db.prepare('SELECT * FROM polls WHERE id=? AND guild_id=?').get(payload.poll_id,guild.id);if(!poll)outcome={error:'Nie ma tej ankiety'};
      else if(pollState(poll,userId).revision!==cmd.expected_revision)outcome={error:'Ankieta lub głos zmieniły się',conflict:true};
      else{const vote=recordVote({guild,user:{id:userId}},payload.poll_id,payload.option_index);outcome=vote.error?{error:vote.error}:{poll:pollState(poll,userId),refresh:'poll',poll_id:poll.id}}
     }else if(cmd.operation==='raid.signup'){outcome=recordRaidSignup(db,{raidId:payload.raid_id,userId,status:payload.status,expectedRevision:cmd.expected_revision});outcome.refresh='raid';outcome.raid_id=payload.raid_id}
     else if(['lfg.join','lfg.leave','lfg.close'].includes(cmd.operation)){
      const e=db.prepare('SELECT * FROM expeditions WHERE id=?').get(payload.expedition_id);
      if(!e||e.status!=='OPEN'||e.expires_at<=Date.now())outcome={error:'Ta wyprawa jest już zamknięta'};
      else if(lfgState(e,userId).revision!==cmd.expected_revision)outcome={error:'Wyprawa zmieniła się',conflict:true};
      else if(cmd.operation==='lfg.close'&&e.owner_id!==userId&&!hasStaff(m))outcome={error:'Zamknąć może autor lub kadra'};
      else{
       if(cmd.operation==='lfg.join'){const joined=joinExpedition(e,userId,payload.role);if(['role','full','closed'].includes(joined))return {error:joined==='full'?'Brak wolnego miejsca':joined==='closed'?'Wyprawa zamknięta':'Wybierz funkcję TANK, HEAL lub DPS'}}
       else if(cmd.operation==='lfg.leave')db.prepare('DELETE FROM expedition_members WHERE expedition_id=? AND user_id=?').run(e.id,userId);
       else db.prepare("UPDATE expeditions SET status='CLOSED' WHERE id=?").run(e.id);
       outcome={refresh:'lfg',expedition_id:e.id};
      }
     }else outcome={error:'Ta funkcja nie jest jeszcze podłączona'};
     if(outcome.error)return outcome;
     db.prepare('INSERT INTO addon_requests VALUES(?,?,?,?,?,?)').run(userId,cmd.id,cmdHash,'refresh_pending',JSON.stringify(outcome),Date.now());return outcome;
    })();
    if(result.error)return {id:cmd.id,status:result.conflict?'conflict':'rejected',error:result.error};
   }
   try{await refresh(result);result={...result,discord_refreshed:true};db.prepare('UPDATE addon_requests SET status=?,result_json=? WHERE user_id=? AND request_id=?').run('done',JSON.stringify(result),userId,cmd.id);return {...result,id:cmd.id,status:'accepted'}}catch{return {...result,id:cmd.id,status:'refresh_pending'}}
  }finally{active.delete(key)}
 }
 let retrying=false;const retry=setInterval(async()=>{if(retrying||require("./maintenance.cjs").maintenance(db))return;retrying=true;try{const rows=db.prepare("SELECT * FROM addon_requests WHERE status='refresh_pending' ORDER BY created_at LIMIT 5").all();for(const r of rows){try{const result=JSON.parse(r.result_json);await refresh(result);result.discord_refreshed=true;db.prepare('UPDATE addon_requests SET status=?,result_json=? WHERE user_id=? AND request_id=?').run('done',JSON.stringify(result),r.user_id,r.request_id)}catch{}}}finally{retrying=false}},10000);retry.unref();
 return {perform,issuePairCode,snapshot,member,close:()=>clearInterval(retry)};
};
