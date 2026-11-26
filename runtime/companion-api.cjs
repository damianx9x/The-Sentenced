'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {PermissionFlagsBits}=require('discord.js');
const {recordVote,refreshPollMessage}=require('./polls');
const OWNER='1058040262661767188',PORT=8879;
const {FIELDS,hash}=require('./guild-actions.cjs');
module.exports=function start({db,guild,refresh}){
 db.exec(`CREATE TABLE IF NOT EXISTS companion_requests(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,payload_hash TEXT NOT NULL,status TEXT NOT NULL,result_json TEXT,created_at INTEGER NOT NULL)`);
 const sessions=new Map(),active=new Set();
 function profile(){const row=db.prepare('SELECT '+FIELDS.join(',')+' FROM members WHERE user_id=?').get(OWNER);if(!row)throw Error('Brak profilu');return {value:row,revision:hash(row)}}
 function pollState(p){const options=JSON.parse(p.options_json),own=db.prepare('SELECT option_index,voted_at FROM poll_votes WHERE poll_id=? AND user_id=?').get(p.id,OWNER);return {id:p.id,question:p.question,status:p.status,options,counts:options.map((_,i)=>db.prepare('SELECT COUNT(*) AS n FROM poll_votes WHERE poll_id=? AND option_index=?').get(p.id,i).n),own_option:own?.option_index??null,revision:hash({options,status:p.status,question:p.question,own:own||null}),url:p.message_id?`https://discord.com/channels/${guild.id}/${p.channel_id}/${p.message_id}`:null}}
 async function member(){const m=await guild.members.fetch({user:OWNER,force:true});if(!require('./guild-core').has(m))throw Error('Brak aktualnego dostępu gildii');return m}
 async function channel(id,write=false){if(!/^\d{17,20}$/.test(id))throw Error('Nieprawidłowy kanał');const c=await guild.channels.fetch(id);const m=await member();if(!c||['oficerka','poczekalnia'].includes(c.name)||!c.isTextBased()||c.isThread()||!c.permissionsFor(m)?.has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.ReadMessageHistory])||(write&&!c.permissionsFor(m)?.has(PermissionFlagsBits.SendMessages)))throw Error('Brak dostępu do kanału');return c}
 function reply(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data))}
 async function body(req){let text='';for await(const part of req){text+=part;if(Buffer.byteLength(text)>16384)throw Error('Dane przekraczają limit')}return JSON.parse(text)}
 const server=http.createServer(async(req,res)=>{
  try{
   const host=req.headers.host||'';if(!/^(127\.0\.0\.1|localhost):8879$/.test(host))return reply(res,403,{error:'Host'});
   res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
   const url=new URL(req.url,'http://127.0.0.1:8879');
   if(req.method==='GET'&&['/','/app.js','/style.css'].includes(url.pathname)){
    if(url.pathname==='/'){const id=crypto.randomBytes(32).toString('hex');if(sessions.size>=16)sessions.delete(sessions.keys().next().value);sessions.set(id,Date.now()+3600000);res.setHeader('Set-Cookie','ts_session='+id+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600')}
    const file={'/':'index.html','/app.js':'app.js','/style.css':'style.css'}[url.pathname];res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');return res.end(fs.readFileSync(path.join(__dirname,'companion',file)))
   }
   const cookie=(req.headers.cookie||'').match(/(?:^|; )ts_session=([a-f0-9]{64})/);if(!cookie||!(sessions.get(cookie[1])>Date.now()))return reply(res,401,{error:'Otwórz ponownie companion'});
   if(req.method==='POST'&&!['http://127.0.0.1:8879','http://localhost:8879'].includes(req.headers.origin))return reply(res,403,{error:'Origin'});
   if(req.headers.origin&&!['http://127.0.0.1:8879','http://localhost:8879'].includes(req.headers.origin))return reply(res,403,{error:'Origin'});
   if(req.method==='GET'&&url.pathname==='/api/profile'){await member();return reply(res,200,profile())}
   if(req.method==='GET'&&url.pathname==='/api/channels'){
    const m=await member();await guild.channels.fetch();const channels=[...guild.channels.cache.values()].filter(c=>c.type===0&&!['oficerka','poczekalnia'].includes(c.name)&&c.permissionsFor(m)?.has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.ReadMessageHistory])).map(c=>({id:c.id,name:c.name,writable:c.permissionsFor(m).has(PermissionFlagsBits.SendMessages)}));return reply(res,200,{channels,user:'Icex',transport:'SSH / Discord'})
   }
   if(req.method==='GET'&&url.pathname==='/api/messages'){
    const c=await channel(url.searchParams.get('channel'));const messages=await c.messages.fetch({limit:30,cache:false});return reply(res,200,{messages:[...messages.values()].reverse().map(m=>({id:m.id,author:m.member?.displayName||m.author.globalName||m.author.username,content:m.content,time:m.createdTimestamp,edited:m.editedTimestamp,reply:m.reference?.messageId||null,url:m.url,media:[...m.attachments.values()].map(a=>({name:a.name,type:a.contentType||'plik'})).concat(m.stickers.size?[{name:'naklejka',type:'naklejka'}]:[])}))})
   }
   if(req.method==='GET'&&url.pathname==='/api/polls'){
    const polls=db.prepare('SELECT * FROM polls WHERE guild_id=? ORDER BY id DESC LIMIT 20').all(guild.id);const result=[];for(const p of polls){try{await channel(p.channel_id);result.push(pollState(p))}catch{}}return reply(res,200,{polls:result})
   }
   if(req.method==='POST'&&url.pathname==='/api/command'){
    if(require('./maintenance.cjs').maintenance(db))return reply(res,503,{error:'Prace serwisowe. Zachowaj szkic.'});
    await member();
    const cmd=await body(req);if(typeof cmd.request_id!=='string'||!/^[a-zA-Z0-9-]{16,64}$/.test(cmd.request_id))return reply(res,400,{error:'ID żądania'});const payloadHash=hash(cmd);const previous=db.prepare('SELECT * FROM companion_requests WHERE id=?').get(cmd.request_id);
    if(previous){if(previous.user_id!==OWNER||previous.payload_hash!==payloadHash)return reply(res,409,{error:'ID użyte do innej operacji'});return reply(res,previous.status==='done'?200:409,previous.result_json?JSON.parse(previous.result_json):{error:'Poprzednie wysłanie ma niepewny wynik. Nie ponawiamy automatycznie.'})}
    if(active.size>=2)return reply(res,429,{error:'Poczekaj na poprzednią operację'});active.add(cmd.request_id);
    try{
     if(cmd.operation==='profile.update'){
      await member();const current=profile();if(cmd.expected_revision!==current.revision)return reply(res,409,{error:'Profil zmienił się. Wczytaj najnowszą wersję.',current});
      const result=db.transaction(()=>{const outcome=require('./guild-actions.cjs').updateProfile(db,OWNER,cmd.expected_revision,cmd.payload);if(outcome.error)return outcome;db.prepare('INSERT INTO companion_requests VALUES(?,?,?,?,?,?)').run(cmd.request_id,OWNER,payloadHash,'refresh_pending',JSON.stringify({profile:outcome.profile,refresh_pending:true}),Date.now());return outcome;})();
      if(result.error)return reply(res,result.conflict?409:400,result);
      try{await refresh();const result={profile:profile(),discord_refreshed:true};db.prepare('UPDATE companion_requests SET status=?,result_json=? WHERE id=?').run('done',JSON.stringify(result),cmd.request_id);return reply(res,200,result)}catch{return reply(res,202,{profile:profile(),refresh_pending:true,error:'Profil zapisany; panel Discord czeka na odświeżenie.'})}
     }
     if(cmd.operation==='poll.vote'){
      if(!Number.isSafeInteger(cmd.poll_id)||!Number.isSafeInteger(cmd.payload?.option_index))return reply(res,400,{error:'Nieprawidłowy głos'});
      const poll=db.prepare('SELECT * FROM polls WHERE id=? AND guild_id=?').get(cmd.poll_id,guild.id);if(!poll)return reply(res,404,{error:'Ankieta nie istnieje'});await channel(poll.channel_id);await member();
      const interaction={guild,user:{id:OWNER}};const result=db.transaction(()=>{
       const latest=db.prepare('SELECT * FROM polls WHERE id=? AND guild_id=?').get(cmd.poll_id,guild.id);
       if(pollState(latest).revision!==cmd.expected_revision)return {error:'Ankieta lub Twój głos zmieniły się na Discordzie. Odśwież wyniki.',conflict:true};
       const outcome=recordVote(db,interaction,cmd.poll_id,cmd.payload.option_index);if(outcome.error)return {error:outcome.error};
       const result={poll:pollState(latest),poll_id:latest.id,refresh_pending:true};db.prepare('INSERT INTO companion_requests VALUES(?,?,?,?,?,?)').run(cmd.request_id,OWNER,payloadHash,'poll_refresh_pending',JSON.stringify(result),Date.now());return result;
      })();if(result.error)return reply(res,result.conflict?409:400,result);
      try{if(!(await refreshPollMessage(interaction,db,poll)))throw Error('Missing Discord message');result.discord_refreshed=true;delete result.refresh_pending;db.prepare('UPDATE companion_requests SET status=?,result_json=? WHERE id=?').run('done',JSON.stringify(result),cmd.request_id);return reply(res,200,result)}catch{return reply(res,202,result)}
     }
     if(cmd.operation==='chat.send'){
      const c=await channel(cmd.channel,true);const content=cmd.payload?.content;if(typeof content!=='string'||!content.trim()||content.length>1800)return reply(res,400,{error:'Wiadomość: 1–1800 znaków'});
      db.prepare('INSERT INTO companion_requests VALUES(?,?,?,?,?,?)').run(cmd.request_id,OWNER,payloadHash,'sending',null,Date.now());
      const msg=await c.send({content:'**Icex · companion**\n'+content,allowedMentions:{parse:[]},nonce:hash(cmd.request_id).slice(0,24),enforceNonce:true});const result={message_id:msg.id,url:msg.url};db.prepare('UPDATE companion_requests SET status=?,result_json=? WHERE id=?').run('done',JSON.stringify(result),cmd.request_id);return reply(res,200,result)
     }
     return reply(res,400,{error:'Nieobsługiwana operacja'})
    }finally{active.delete(cmd.request_id)}
   }
   reply(res,404,{error:'Nie znaleziono'});
  }catch(error){reply(res,503,{error:'Operacja nie powiodła się. Sprawdź połączenie i uprawnienia.'});console.error('[companion] operation failed',error.code||error.name)}
 });
 const timer=setInterval(async()=>{
  const row=db.prepare("SELECT * FROM companion_requests WHERE status IN ('refresh_pending','poll_refresh_pending') ORDER BY created_at LIMIT 1").get();
  if(row&&!active.has('refresh')){active.add('refresh');try{
   if(row.status==='poll_refresh_pending'){const result=JSON.parse(row.result_json),poll=db.prepare('SELECT * FROM polls WHERE id=? AND guild_id=?').get(result.poll_id,guild.id);if(!poll)throw Error('Missing poll');if(!(await refreshPollMessage({guild,user:{id:OWNER}},db,poll)))throw Error('Missing Discord message')}else await refresh();
   const result=JSON.parse(row.result_json);result.discord_refreshed=true;delete result.refresh_pending;db.prepare('UPDATE companion_requests SET status=?,result_json=? WHERE id=?').run('done',JSON.stringify(result),row.id);
  }catch{}finally{active.delete('refresh')}}
 },10000);timer.unref();
 server.listen(PORT,'127.0.0.1',()=>console.log('[companion] ready loopback 8879'));
 return server;
};
