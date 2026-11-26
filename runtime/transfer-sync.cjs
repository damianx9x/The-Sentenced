'use strict';
// Manual copy/paste bridge: Discord authenticates the member; no credentials enter WoW.
const {hash}=require('./guild-actions.cjs');
const encode=value=>Buffer.from(String(value),'utf8').toString('hex');
function decode(value){
 if(typeof value!=='string'||value.length%2||!/^[a-f0-9]+$/i.test(value))throw Error('Kod zawiera nieprawidłowy tekst');
 const text=Buffer.from(value,'hex').toString('utf8');
 if(encode(text)!==value.toLowerCase()||/[\x00-\x1f\x7f|<>]/.test(text))throw Error('Kod zawiera nieprawidłowy tekst');
 return text;
}
function parseRequest(wire){
 if(typeof wire!=='string'||Buffer.byteLength(wire)>1200||/[\x00-\x20\x7f]/.test(wire))throw Error('Wklej cały kod z dodatku');
 const parts=wire.split('|');
 if(parts.length!==6||parts[0]!=='TSB1'||parts[1]!=='Q'||!/^[a-f0-9]{16}$/.test(parts[2]))throw Error('Kod ma nieprawidłowy format');
 const character=decode(parts[3]);
 if(character.length<3||character.length>120||!character.includes('-')||character.trim()!==character)throw Error('Wymagany pełny nick postaci i realm');
 const cmd={id:parts[2],operation:parts[4]};
 if(cmd.operation==='snapshot'){if(parts[5]!=='')throw Error('Nieprawidłowy odczyt')}
 else if(cmd.operation==='pair'){
  if(!/^[a-f0-9]{18}$/i.test(parts[5]))throw Error('Nieprawidłowy kod parowania');
  cmd.payload={code:parts[5].toUpperCase()};
 }else if(cmd.operation==='raid.signup'){
  const fields=parts[5].split(':');
  if(fields.length!==3||!/^\d{1,8}$/.test(fields[0])||Number(fields[0])<1||!['YES','MAYBE','NO'].includes(fields[1])||!/^[a-f0-9]{64}$/.test(fields[2]))throw Error('Nieprawidłowy zapis na rajd');
  cmd.payload={raid_id:Number(fields[0]),status:fields[1]};cmd.expected_revision=fields[2];
 }else if(cmd.operation==='staff.review.list'){
  if(!/^[1-9]\d{0,3}$/.test(parts[5])||Number(parts[5])>1000)throw Error('Nieprawidłowa strona wniosków');
  cmd.payload={page:Number(parts[5])};
 }else if(cmd.operation==='staff.review.decide'){
  const [page,action,userId,revision,...extra]=parts[5].split(':');
  if(extra.length||!/^[1-9]\d{0,3}$/.test(page)||Number(page)>1000||!['approve','reject'].includes(action)||!/^\d{17,20}$/.test(userId)||!/^[1-9]\d{0,9}$/.test(revision))throw Error('Nieprawidłowa decyzja kadry');
  cmd.payload={page:Number(page),action,user_id:userId,revision:Number(revision)};
 }else if(cmd.operation==='staff.post'){
  const [channel,encoded,...extra]=parts[5].split(':');
  if(extra.length||!Object.hasOwn(require('./guild-channel-ids.cjs').STAFF_POST_CHANNELS,channel)||!encoded||encoded.length>760)throw Error('Nieprawidłowa wiadomość kadry');
  const content=Buffer.from(encoded,'hex').toString('utf8');
  if(!content.trim()||encode(content)!==encoded||/[\x00-\x1f\x7f]/.test(content))throw Error('Nieprawidłowy tekst wiadomości');
  cmd.payload={channel,content};
 }else throw Error('Ta operacja nie jest obsługiwana');
 return {character,cmd};
}
function safeText(value,max=120){return Array.from(String(value||'').replace(/[\x00-\x1f\x7f|<>]/g,' ').trim()).slice(0,max).join('')}
function encodeSnapshot({id,character,snapshot,status,now=Date.now()}){
 const records=(snapshot.raids||[]).filter(r=>Number.isSafeInteger(r.id)&&r.id>0&&Number.isSafeInteger(r.scheduled)&&r.scheduled>Math.floor(now/1000)&&['ACTIVE','CLOSED'].includes(r.status)&&/^[a-f0-9]{64}$/.test(r.revision)).sort((a,b)=>a.scheduled-b.scheduled||a.id-b.id).slice(0,10).map(r=>[r.id,r.scheduled,Number.isSafeInteger(r.limit)&&r.limit>=0?r.limit:0,r.status,r.revision,['YES','MAYBE','NO'].includes(r.ownStatus)?r.ownStatus:'',encode(safeText(r.name)||'Rajd')].join(':'));
 return ['TSB1','S',id,Math.floor(now/1000),encode(character),encode(safeText(snapshot.userLabel)||'Członek gildii'),status,...records].join('|');
}
function encodeStaff({id,character,outcome,now}){
 const {staff,decision}=outcome;
 const fields=staff.applications.map(application=>[application.id,application.revision,...application.fields.flatMap(({name,value})=>[encode(safeText(name,80)),encode(safeText(value,400))])].join(':'));
 const response=['TSB1','K',id,Math.floor(now/1000),encode(character),staff.page,staff.hasMore?'1':'0',decision?.state||'-',...fields].join('|');
 if(Buffer.byteLength(response)>16384)throw Error('Limit danych wniosków');
 return response;
}
function errorWire(id,message){return ['TSB1','E',/^[a-f0-9]{16}$/.test(id||'')?id:'0000000000000000',encode(safeText(message,180)||'Sprawdź kod i aktualny dostęp gildii')].join('|')}
async function runTransfer({service,db,userId,wire,now=Date.now()}){
 let id;
 try{
  const {character,cmd}=parseRequest(wire);id=cmd.id;
  await service.member(userId);
  const linked=()=>db.prepare('SELECT user_id FROM addon_links WHERE character=?').get(character)?.user_id===userId;
  if(cmd.operation==='pair'){
   const code=db.prepare('SELECT user_id,expires_at FROM addon_pair_codes WHERE code_hash=?').get(hash(cmd.payload.code));
   const receipt=db.prepare('SELECT payload_hash FROM addon_requests WHERE user_id=? AND request_id=?').get(userId,cmd.id);
   if(!(code?.user_id===userId&&code.expires_at>now)&&!(linked()&&receipt?.payload_hash===hash(cmd)))return errorWire(id,'Kod parowania musi pochodzić z Twojego konta. Wybierz Połącz addon.');
  }else if(!linked())return errorWire(id,'Ta postać nie jest połączona z Twoim kontem. Najpierw wybierz Połącz addon.');
  const outcome=await service.perform(character,cmd,userId);
  if(!['snapshot','accepted','refresh_pending'].includes(outcome.status))return errorWire(id,outcome.error||'Operacja nie została potwierdzona. Odśwież stan w dodatku.');
  if(!linked())return errorWire(id,'Powiązanie postaci zmieniło się. Połącz ją ponownie.');
  if(cmd.operation==='staff.post'){
   if(!/^\d{17,20}$/.test(outcome.message_id||''))return errorWire(id,'Brak potwierdzenia publikacji.');
   return ['TSB1','P',id,Math.floor(now/1000),encode(character),outcome.message_id].join('|');
  }
  if(outcome.staff)return encodeStaff({id,character,outcome,now});
  const snapshot=outcome.snapshot||await service.snapshot(userId);
  return encodeSnapshot({id,character,snapshot,status:outcome.status,now});
 }catch{return errorWire(id,'Nie udało się zsynchronizować. Sprawdź kod, członkostwo oraz powiązanie postaci.');}
}
async function handle({interaction,service,db,guildId}){
 const {ModalBuilder,TextInputBuilder,TextInputStyle,ActionRowBuilder,MessageFlags,AttachmentBuilder}=require('discord.js');
 if(!service||interaction.guildId!==guildId){await interaction.reply({content:'Synchronizacja jest chwilowo niedostępna na tym serwerze.',flags:MessageFlags.Ephemeral});return;}
 if(interaction.customId==='transfer:open'){
  await service.member(interaction.user.id);
  const input=new TextInputBuilder().setCustomId('transfer_code').setLabel('Kod skopiowany z dodatku /ts → Discord').setStyle(TextInputStyle.Paragraph).setMinLength(30).setMaxLength(1200).setRequired(true);
  await interaction.showModal(new ModalBuilder().setCustomId('transfer:submit').setTitle('The Sentenced • synchronizacja').addComponents(new ActionRowBuilder().addComponents(input)));return;
 }
 if(interaction.customId!=='transfer:submit')return;
 await interaction.deferReply({flags:MessageFlags.Ephemeral});
 const response=await runTransfer({service,db,userId:interaction.user.id,wire:interaction.fields.getTextInputValue('transfer_code').trim()});
 await interaction.editReply({content:'Otwórz załącznik, skopiuj cały kod i wklej go w **/ts → Discord**. Addon pokaże wynik i dane wybranej sekcji. To ręczna synchronizacja; po zmianach powtórz odczyt. Kod parowania jest jednorazowy i ważny 10 minut.',files:[new AttachmentBuilder(Buffer.from(response,'utf8'),{name:'TheSentenced-sync.txt'})],allowedMentions:{parse:[]}});
}
module.exports={parseRequest,encodeSnapshot,runTransfer,handle};
