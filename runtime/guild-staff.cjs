'use strict';
const {DateTime}=require('luxon');
const {EmbedBuilder,ActionRowBuilder,ButtonBuilder,ButtonStyle,StringSelectMenuBuilder,ModalBuilder,TextInputBuilder,TextInputStyle,MessageFlags}=require('discord.js');
const {has,STAFF,text}=require('./guild-core');
const row=(...items)=>new ActionRowBuilder().addComponents(...items);
const button=(id,label,style=ButtonStyle.Secondary)=>new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
const card=(title,description)=>new EmbedBuilder().setColor(0xa8202a).setTitle(title).setDescription(description).setFooter({text:'THE SENTENCED • Panel kadry'});
const kindName=kind=>kind==='DUTY'?'Dyżur':'Zadanie';
function schema(db){db.exec(`CREATE TABLE IF NOT EXISTS guild_staff_items(
 id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('TASK','DUTY')),
 title TEXT NOT NULL, details TEXT NOT NULL DEFAULT '', starts_at INTEGER, ends_at INTEGER,
 created_by TEXT NOT NULL, assigned_to TEXT, status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','CLAIMED','DONE','CANCELLED')),
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
); CREATE INDEX IF NOT EXISTS guild_staff_items_open_idx ON guild_staff_items(status,kind,starts_at);`);}
function parseDuty(start,hours){
 const value=String(start||'').trim();const d=DateTime.fromFormat(value,'yyyy-MM-dd HH:mm',{zone:'Europe/Warsaw',setZone:true});
 if(!d.isValid||d.toFormat('yyyy-MM-dd HH:mm')!==value)throw Error('Termin podaj jako RRRR-MM-DD GG:MM w czasie polskim.');
 if(typeof d.getPossibleOffsets==='function'&&d.getPossibleOffsets().length>1)throw Error('Ta godzina występuje dwa razy przy zmianie czasu. Wybierz inną.');
 const duration=Number(hours);if(!Number.isInteger(duration)||duration<1||duration>12)throw Error('Dyżur musi trwać od 1 do 12 godzin.');
 const starts=d.toMillis(),ends=d.plus({hours:duration}).toMillis();
 if(starts<Date.now()-60000||starts>Date.now()+366*86400000)throw Error('Termin musi być w ciągu najbliższego roku.');
 return {starts,ends};
}
function createGuildStaff({db,guild}){
 schema(db);
 const get=id=>db.prepare('SELECT * FROM guild_staff_items WHERE id=?').get(id);
 function editor(kind){
  const modal=new ModalBuilder().setCustomId(`sc:officer:save:${kind}`).setTitle(kind==='DUTY'?'Zaplanuj dyżur':'Dodaj zadanie kadry');
  const fields=[['title','Tytuł',80,true,TextInputStyle.Short],['details','Opis (opcjonalnie)',500,false,TextInputStyle.Paragraph]];
  if(kind==='DUTY')fields.push(['start','Termin PL: RRRR-MM-DD GG:MM',16,true,TextInputStyle.Short],['hours','Czas trwania w godzinach (1–12)',2,true,TextInputStyle.Short]);
  for(const [id,label,max,required,style] of fields)modal.addComponents(row(new TextInputBuilder().setCustomId(id).setLabel(label).setMaxLength(max).setRequired(required).setStyle(style)));
  return modal;
 }
 function list(history=false){
  const items=db.prepare(history?"SELECT * FROM guild_staff_items WHERE status IN ('DONE','CANCELLED') ORDER BY updated_at DESC,id DESC LIMIT 25":"SELECT * FROM guild_staff_items WHERE status IN ('OPEN','CLAIMED') ORDER BY CASE WHEN starts_at IS NULL THEN 1 ELSE 0 END,starts_at,id DESC LIMIT 25").all();
  const desc=items.map(x=>`**#${x.id} ${kindName(x.kind)}: ${text(x.title,80)}**${x.starts_at?` • <t:${Math.floor(x.starts_at/1000)}:f>`:''}\n${history?(x.status==='DONE'?'Wykonane':'Anulowane'):(x.assigned_to?`Przyjął: <@${x.assigned_to}>`:'Czeka na osobę z kadry')}`).join('\n\n')||(history?'Brak zakończonych wpisów.':'Brak otwartych zadań i dyżurów.');
  const components=history?[]:[row(button('sc:officer:new:TASK','Dodaj zadanie',ButtonStyle.Primary),button('sc:officer:new:DUTY','Zaplanuj dyżur',ButtonStyle.Primary))];
  if(items.length)components.push(row(new StringSelectMenuBuilder().setCustomId('sc:officer:select').setPlaceholder('Wybierz zadanie lub dyżur').addOptions(items.map(x=>({label:`#${x.id} ${kindName(x.kind)}: ${x.title}`.slice(0,100),value:String(x.id)})))));
  components.push(row(button(history?'sc:officer:list':'sc:officer:history',history?'⬅️ Otwarte':'Historia'),button('sc:staff','Stół dowódców'),button('v2:home','Centrum gildii')));
  return {embeds:[card(history?'📜 HISTORIA KADRY':'🛠️ ZADANIA I DYŻURY',desc)],components};
 }
 function detail(item){
  const time=item.starts_at?`\nTermin: <t:${Math.floor(item.starts_at/1000)}:f> – <t:${Math.floor(item.ends_at/1000)}:t>`:'';
  const desc=`${text(item.details||'Bez dodatkowego opisu.',500)}${time}\nStatus: **${item.status}**\nPrzyjął: ${item.assigned_to?`<@${item.assigned_to}>`:'nikt'}\nUtworzył: <@${item.created_by}>`;
  const actions=[];
  if(item.status==='OPEN')actions.push(button(`sc:officer:claim:${item.id}`,'Podejmij',ButtonStyle.Success));
  if(item.status==='CLAIMED')actions.push(button(`sc:officer:release:${item.id}`,'Zwolnij'),button(`sc:officer:done:${item.id}`,'Wykonane',ButtonStyle.Success));
  if(['OPEN','CLAIMED'].includes(item.status))actions.push(button(`sc:officer:cancel:${item.id}`,'Anuluj',ButtonStyle.Danger));
  if(['DONE','CANCELLED'].includes(item.status)&&(!item.ends_at||item.ends_at>Date.now()))actions.push(button(`sc:officer:reopen:${item.id}`,'Otwórz ponownie'));
  return {embeds:[card(`${kindName(item.kind)} #${item.id} • ${text(item.title,80)}`,desc)],components:[...(actions.length?[row(...actions)]:[]),row(button('sc:officer:list','⬅️ Zadania i dyżury'))]};
 }
 async function handle(i){
  if(!i.customId?.startsWith('sc:officer:'))return false;
  if(i.guildId!==guild.id)return false;
  let member;try{member=await guild.members.fetch({user:i.user.id,force:true});}catch{member=null;}
  if(!has(member,STAFF)){await i.reply({content:'Ta część jest dostępna tylko dla kadry.',flags:MessageFlags.Ephemeral});return true;}
  const parts=i.customId.split(':'),action=parts[2],param=parts[3];
  if(action==='new'&&['TASK','DUTY'].includes(param)){await i.showModal(editor(param));return true;}
  await i.deferReply({flags:MessageFlags.Ephemeral});
  const reply=value=>i.editReply(typeof value==='string'?{content:value,allowedMentions:{parse:[]}}:{...value,allowedMentions:{parse:[]}});
  if(action==='list'){await reply(list());return true;}
  if(action==='history'){await reply(list(true));return true;}
  if(action==='save'&&['TASK','DUTY'].includes(param)){
   try{
    const title=i.fields.getTextInputValue('title').trim(),details=i.fields.getTextInputValue('details').trim();
    if(!title||title.length>80||details.length>500||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(title+details))throw Error('Podaj poprawny tytuł i opis.');
    const time=param==='DUTY'?parseDuty(i.fields.getTextInputValue('start'),i.fields.getTextInputValue('hours')):{};
    const now=Date.now();const result=db.prepare('INSERT INTO guild_staff_items(kind,title,details,starts_at,ends_at,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(param,title,details,time.starts??null,time.ends??null,i.user.id,now,now);
    await reply(detail(get(Number(result.lastInsertRowid))));
   }catch(e){await reply(e.message||'Nie udało się zapisać.');}return true;
  }
  const id=Number(action==='select'?i.values?.[0]:param);if(!Number.isSafeInteger(id)||id<1){await reply('Nieprawidłowy wybór.');return true;}
  const item=get(id);if(!item){await reply('Nie znaleziono wpisu.');return true;}
  if(action==='select'){await reply(detail(item));return true;}
  let result;
  if(action==='claim'){
   const claim=db.transaction(()=>{
    const current=get(id);if(!current||current.status!=='OPEN')return {changes:0};
    if(current.kind==='DUTY'&&db.prepare("SELECT id FROM guild_staff_items WHERE kind='DUTY' AND status='CLAIMED' AND assigned_to=? AND starts_at<? AND ends_at>? LIMIT 1").get(i.user.id,current.ends_at,current.starts_at))return {overlap:true};
    return db.prepare("UPDATE guild_staff_items SET assigned_to=?,status='CLAIMED',updated_at=? WHERE id=? AND status='OPEN'").run(i.user.id,Date.now(),id);
   });
   result=claim.immediate();
   if(result.overlap){await reply('Masz już dyżur w tym czasie.');return true;}
  }else if(action==='release')result=db.prepare("UPDATE guild_staff_items SET assigned_to=NULL,status='OPEN',updated_at=? WHERE id=? AND status='CLAIMED' AND assigned_to=?").run(Date.now(),id,i.user.id);
  else if(action==='done')result=db.prepare("UPDATE guild_staff_items SET status='DONE',updated_at=? WHERE id=? AND status='CLAIMED' AND (assigned_to=? OR created_by=?)").run(Date.now(),id,i.user.id,i.user.id);
  else if(action==='cancel')result=db.prepare("UPDATE guild_staff_items SET status='CANCELLED',updated_at=? WHERE id=? AND status IN ('OPEN','CLAIMED') AND created_by=?").run(Date.now(),id,i.user.id);
  else if(action==='reopen')result=db.prepare("UPDATE guild_staff_items SET assigned_to=NULL,status='OPEN',updated_at=? WHERE id=? AND status IN ('DONE','CANCELLED') AND (created_by=? OR assigned_to=?) AND (ends_at IS NULL OR ends_at>?)").run(Date.now(),id,i.user.id,i.user.id,Date.now());
  else {await reply('Ta opcja wygasła.');return true;}
  if(!result.changes){await reply('Stan się zmienił lub nie masz uprawnień do tej operacji. Odśwież listę.');return true;}
  await reply(detail(get(id)));return true;
 }
 return {handle};
}
module.exports={createGuildStaff,schema,parseDuty};
