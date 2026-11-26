'use strict';
const {randomUUID}=require('node:crypto');
const EPH=64;
function splitRows(text, delimiter){
 const rows=[];let row=[],field='',quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];
  if(c==='"'){if(quoted && text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}
  else if(!quoted && c===delimiter){row.push(field.trim());field='';}
  else if(!quoted && (c==='\n'||c==='\r')){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field.trim());if(row.some(Boolean))rows.push(row);row=[];field='';}
  else field+=c;
 }
 if(quoted)throw Error('INVALID_ROW');row.push(field.trim());if(row.some(Boolean))rows.push(row);return rows;
}
function parseRoster(text, maxLength=4000){
 if(typeof text!=='string'||!text.trim()||text.length>maxLength)throw Error('INVALID_FILE');
 const rows=[],bindings=Object.create(null);
 if(text.trimStart().startsWith('{')){
  const data=JSON.parse(text);if(!Array.isArray(data.characters)||data.characters.length>5000)throw Error('INVALID_FILE');
  for(const c of data.characters){const name=c.name,wowClass=c.wowClass??c.wow_class??null,id=c.discordId??c.discord_id??null;if(id&&!/^\d{17,20}$/.test(id))throw Error('INVALID_ID');rows.push({name,wowClass,level:c.level??null,rank:c.rank??null});if(id)bindings[name]=id;}
  if(!rows.length)throw Error('INVALID_FILE');return {rows,bindings};
 }
 const first=text.split(/\r?\n/).find(x=>x.trim()&&!x.trim().startsWith('#'))||'';
 const delimiter=first.includes('|')?'|':first.includes(';')?';':',';
 const parsed=splitRows(text,delimiter).filter(x=>!x[0].startsWith('#'));
 if(parsed[0]&&['name','nick','character'].includes(parsed[0][0].toLowerCase())&&['class','wowclass','wow_class','klasa'].includes((parsed[0][1]||'').toLowerCase()))parsed.shift();
 for(const parts of parsed){
  if(parts.length>3||!parts[0])throw Error('INVALID_ROW');
  const [name,wowClass,id]=parts;if(id&&!/^\d{17,20}$/.test(id))throw Error('INVALID_ID');
  rows.push({name,wowClass:wowClass||null});if(id)bindings[name]=id;
 }
 if(!rows.length||rows.length>5000)throw Error('INVALID_FILE');return {rows,bindings};
}
function createRosterDiscord({db,importer,guildId,officerRoleIds,ownerId,refresh=async()=>{},clock=Date.now}){
 const drafts=new Map();
 async function handle(i){
  if(!i.customId?.startsWith('roster:'))return false;
  try{
   if(i.guildId!==guildId)throw Error('NO_ACCESS');
   const m=await i.guild.members.fetch({user:i.user.id,force:true});
   if(m.user?.bot||m.pending!==false||!(m.id===ownerId||officerRoleIds.some(id=>m.roles.cache.has(id))))throw Error('NO_ACCESS');
   const [_,action,key]=i.customId.split(':');
   if(action==='home')return void await i.reply({flags:EPH,content:'**Roster gildii**\nImport z podglądem i potwierdzeniem kadry. Jeden wiersz: `pełny nick|klasa|opcjonalny Discord ID`. Bez ID postać nie zostanie automatycznie przypisana do profilu.',components:[{type:1,components:[{type:2,style:1,label:'Wklej roster',custom_id:'roster:import'},{type:2,style:1,label:'Wczytaj plik',custom_id:'roster:import-file'},{type:2,style:2,label:'Eksportuj JSON',custom_id:'roster:export'},{type:2,style:2,label:'Cofnij import',custom_id:'roster:undo'}]}]});
   if(action==='import')return void await i.showModal({custom_id:'roster:preview',title:'Import rostera gildii',components:[{type:1,components:[{type:4,custom_id:'rows',label:'Nick|klasa|Discord ID (opcjonalnie)',style:2,required:true,max_length:4000,placeholder:'Icex Jenkins|Paladin|123456789012345678'}]}]});
   if(action==='import-file')return void await i.showModal({custom_id:'roster:preview-file',title:'Import pliku rostera',components:[{type:18,label:'Plik TXT, CSV lub JSON',component:{type:19,custom_id:'file',min_values:1,max_values:1,required:true,file_types:['.txt','.csv','.json']}}]});
   if(action==='preview'||action==='preview-file'){
    let text;
    if(action==='preview-file'){
     await i.deferReply({flags:EPH});const uploaded=i.fields.getUploadedFiles('file',true);const a=uploaded.first();
     if(!a||!Number.isSafeInteger(a.size)||a.size>524288)throw Error('INVALID_FILE');
     const url=new URL(a.url);if(url.protocol!=='https:'||url.hostname!=='cdn.discordapp.com')throw Error('INVALID_FILE');
     const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(15000)});if(!response.ok||!response.body)throw Error('INVALID_FILE');
     let size=0;const chunks=[];for await(const chunk of response.body){size+=chunk.length;if(size>524288)throw Error('INVALID_FILE');chunks.push(chunk);}text=Buffer.concat(chunks).toString('utf8');
    }else text=i.fields.getTextInputValue('rows');
    const {rows,bindings}=parseRoster(text,action==='preview-file'?524288:4000);const plan=importer.preview(rows,bindings);const id=randomUUID();
    for(const [k,v] of drafts)if(v.expires<=clock())drafts.delete(k);
    drafts.set(id,{actor:i.user.id,plan,expires:clock()+600000});const bound=plan.filter(x=>x.discordId).length;
    const sample=plan.slice(0,15).map(x=>`• ${x.name.replace(/@/g,'＠').replace(/[`*_~|\\]/g,'\\$&')} — ${x.wowClass||'bez klasy'} — ${x.discordId?'profil wskazany':'bez przypisania'}`).join('\n');
    const reply={flags:EPH,allowedMentions:{parse:[]},content:`**Podgląd importu**\nPostacie: **${plan.length}**, profile wskazane: **${bound}**, do rozpoznania: **${plan.length-bound}**.\n${sample}${plan.length>15?'\n…':' '}\nPrzed zatwierdzeniem sprawdź ID. Podgląd jest ważny 10 minut.`,files:[{attachment:Buffer.from(JSON.stringify(plan,null,2)),name:'podglad-rostera.json'}],components:[{type:1,components:[{type:2,style:3,label:'Zatwierdź import',custom_id:`roster:confirm:${id}`}]}]};
    if(i.deferred){delete reply.flags;await i.editReply(reply);}else await i.reply(reply);return true;
   }
   if(action==='confirm'){
    const d=drafts.get(key);if(!d||d.actor!==i.user.id||d.expires<=clock())throw Error('EXPIRED');
    const result=importer.apply(d.plan,{actorId:i.user.id,now:clock()});drafts.delete(key);
    await i.update({content:`✅ Zaimportowano ${result.characters} postaci; zaktualizowano ${result.profiles} profili. Identyfikator importu: ${result.importId}.`,components:[]});
    try{await refresh();}catch(e){}return true;
   }
   if(action==='undo')return void await i.showModal({custom_id:'roster:undo-preview',title:'Cofnięcie importu',components:[{type:1,components:[{type:4,custom_id:'id',label:'Identyfikator importu',style:1,required:true,max_length:36}]}]});
   if(action==='undo-preview'){
    const importId=i.fields.getTextInputValue('id').trim();
    if(!/^[0-9a-f-]{36}$/i.test(importId))throw Error('INVALID_ID');
    const record=db.prepare('SELECT id,rolled_back_at FROM guild_roster_imports WHERE id=?').get(importId);if(!record||record.rolled_back_at!==null)throw Error('INVALID_ID');
    const n=db.prepare('SELECT COUNT(*) AS n FROM guild_roster_changes WHERE import_id=?').get(importId).n;
    const id=randomUUID();drafts.set(id,{actor:i.user.id,undo:importId,expires:clock()+600000});
    await i.reply({flags:EPH,content:`Cofnięcie importu obejmie ${n} profili i powiązane postacie. Zmienione od importu dane zatrzymają operację.`,components:[{type:1,components:[{type:2,style:4,label:'Potwierdź cofnięcie',custom_id:`roster:undo-confirm:${id}`}]}]});return true;
   }
   if(action==='undo-confirm'){
    const d=drafts.get(key);if(!d||d.actor!==i.user.id||!d.undo||d.expires<=clock())throw Error('EXPIRED');
    importer.rollback(d.undo,clock());drafts.delete(key);await i.update({content:'✅ Import został cofnięty.',components:[]});try{await refresh();}catch(e){}return true;
   }
   if(action==='export'){
    const characters=db.prepare('SELECT name,wow_class,discord_id,level,rank,updated_at FROM guild_roster_characters ORDER BY name').all();
    const profiles=db.prepare('SELECT user_id,game_nick,wow_class,wow_role,interests FROM members WHERE left_at IS NULL ORDER BY user_id').all();
    const attachment=Buffer.from(JSON.stringify({version:1,exportedAt:new Date(clock()).toISOString(),characters,profiles},null,2));
    await i.reply({flags:EPH,content:'Prywatny eksport dla kadry.',files:[{attachment,name:'the-sentenced-roster.json'}]});return true;
   }
   throw Error('INVALID_ACTION');
  }catch(e){const text=e.message==='NO_ACCESS'?'Ta funkcja jest dostępna dla GM i oficerów.':(e.message==='PREVIEW_STALE'||e.message==='ROLLBACK_CONFLICT')?'Dane zmieniły się od podglądu. Przygotuj import ponownie.':e.message==='EXPIRED'?'Podgląd wygasł. Przygotuj import ponownie.':'Nie udało się przetworzyć danych. Sprawdź format i klasy postaci.';if(i.deferred||i.replied)await i.editReply({content:text,components:[]});else await i.reply({content:text,flags:EPH});return true;}
 }
 return {handle};
}
module.exports={createRosterDiscord,parseRoster};
