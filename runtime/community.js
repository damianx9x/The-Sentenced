'use strict';
const {version:SYSTEM_VERSION}=require('./system-version.json');
const {DateTime}=require('luxon');
const {EmbedBuilder,ActionRowBuilder,ButtonBuilder,ButtonStyle,StringSelectMenuBuilder,ModalBuilder,TextInputBuilder,TextInputStyle,MessageFlags}=require('discord.js');
const ZONE='Europe/Warsaw';
const {PLAYERS,STAFF,has,roleKind}=require('./guild-core');
const memeLibrary=[]; // Retired AI scenes are retained in DB for history only.
const {collectTop,imageKey,postKey,validCandidate}=require('./reddit-memes');
const path=require('node:path');
const {createHash}=require('node:crypto');
const SOURCES=['wowmemes'];
const {classify,rankMemes}=require('./meme-policy.cjs');
const MEME_AUTO_PUBLISH_ENABLED=true;
const row=(...items)=>new ActionRowBuilder().addComponents(...items);
const button=(id,label,style=ButtonStyle.Secondary)=>new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
const embed=(title,description)=>new EmbedBuilder().setColor(0x8B1E1E).setTitle(title.slice(0,256)).setDescription(description.slice(0,4000)).setFooter({text:'THE SENTENCED • Za Hordę! • v'+SYSTEM_VERSION});
const text=v=>String(v??'').replace(/@/g,'＠').slice(0,1800);
function schema(db){db.exec(`
 CREATE TABLE IF NOT EXISTS community_state(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS community_memes(id INTEGER PRIMARY KEY,url TEXT UNIQUE NOT NULL,image TEXT UNIQUE NOT NULL,title TEXT NOT NULL,source TEXT NOT NULL,ups INTEGER NOT NULL,seen_at INTEGER NOT NULL,published_at INTEGER,message_id TEXT);
 CREATE TABLE IF NOT EXISTS community_meme_votes(meme_id INTEGER NOT NULL,user_id TEXT NOT NULL,vote INTEGER NOT NULL,PRIMARY KEY(meme_id,user_id));
 CREATE TABLE IF NOT EXISTS community_jobs(id TEXT PRIMARY KEY,kind TEXT NOT NULL,due INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending',message_id TEXT);
 CREATE TABLE IF NOT EXISTS expeditions(id INTEGER PRIMARY KEY,owner_id TEXT NOT NULL,title TEXT NOT NULL,details TEXT NOT NULL,expires_at INTEGER NOT NULL,capacity INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'OPEN',message_id TEXT,created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS expedition_members(expedition_id INTEGER NOT NULL,user_id TEXT NOT NULL,PRIMARY KEY(expedition_id,user_id));
 CREATE TABLE IF NOT EXISTS tavern_rolls(user_id TEXT NOT NULL,day TEXT NOT NULL,value INTEGER NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(user_id,day));
 `);
 for(const [table,name,type] of [['community_memes','post_key','TEXT'],['community_memes','image_key','TEXT'],['community_memes','image_hash','TEXT'],['community_memes','top_rank','INTEGER'],['community_memes','top_period','TEXT'],['community_memes','origin','TEXT'],['community_memes','quality_status',"TEXT NOT NULL DEFAULT 'PENDING'"],['community_memes','asset','TEXT'],['community_memes','caption','TEXT'],['community_memes','theme','TEXT'],['community_jobs','meme_id','INTEGER'],['expeditions','mode',"TEXT NOT NULL DEFAULT 'FREE'"],['expedition_members','wow_role','TEXT']])if(!db.prepare(`PRAGMA table_info(${table})`).all().some(c=>c.name===name))db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
}
function nextWeekSlots(now=Date.now(),random=Math.random){
 const start=DateTime.fromMillis(now,{zone:ZONE}).startOf('week');
 const days=[0,1,2,3,4,5,6];
 for(let i=days.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[days[i],days[j]]=[days[j],days[i]];}
 return days.slice(0,3+Math.floor(random()*3)).map(day=>start.plus({days:day,hours:10,minutes:Math.floor(random()*780)}).toMillis()).sort((a,b)=>a-b);
}
function validMeme(m){try{return m.nsfw===false&&m.spoiler===false&&m.ups>=100&&String(m.title||'').trim().length>=8&&new URL(m.url).protocol==='https:'&&['i.redd.it','i.imgur.com','preview.redd.it'].includes(new URL(m.url).hostname)&&['redd.it','www.reddit.com','reddit.com'].includes(new URL(m.postLink).hostname)&&!/(suicid|rape|nazi|porn|gore|politic|election|president)/i.test(m.title);}catch{return false;}}
function createCommunity({db,guild,getChannel,refreshRaids,refreshPolls}){
 schema(db);
 const staffTools=require('./guild-staff.cjs').createGuildStaff({db,guild});
 const get=(key,fallback=null)=>db.prepare('SELECT value FROM community_state WHERE key=?').get(key)?.value??fallback;
 const set=(key,value)=>db.prepare('INSERT INTO community_state VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,String(value));
 db.transaction(()=>{
  if(get('meme_pipeline_v3')!=='1'){
   db.prepare("UPDATE community_memes SET quality_status='RETIRED' WHERE asset IS NOT NULL AND published_at IS NULL").run();
   for(const m of db.prepare('SELECT * FROM community_memes WHERE asset IS NULL').all()){
    db.prepare('UPDATE community_memes SET post_key=?,image_key=? WHERE id=?').run(postKey(m.url),imageKey(m.image),m.id);
    if(m.published_at===null&&m.quality_status==='PENDING'&&validCandidate({...m,nsfw:false,spoiler:false})&&m.ups>=100)
     db.prepare("UPDATE community_memes SET quality_status='APPROVED',origin='legacy-wow-cache' WHERE id=?").run(m.id);
   }
   set('meme_pipeline_v3','1');set('last_collect','0');
  }
 })();
 let busy=false;
 const locks=new Map();
 const serial=async(key,fn)=>{const previous=locks.get(key)||Promise.resolve();const next=previous.catch(()=>{}).then(fn);locks.set(key,next);try{return await next;}finally{if(locks.get(key)===next)locks.delete(key);}};
 const channel=name=>getChannel(guild,name);
 const link=(name,label)=>{const c=channel(name);return c?new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(label).setURL(`https://discord.com/channels/${guild.id}/${c.id}`):null;};
 function nav(member){
  const items=[button('sc:polls','🗳️ Ankiety'),button('sc:raids','⚔️ Raidy'),button('sc:lfg','🍺 Szukam ekipy')];
  if(has(member,STAFF))items.push(button('sc:staff','🛠️ Kadra'));
  return row(...items);
 }
 async function panel(){const c=channel('wyprawy');if(!c)return;const payload={embeds:[embed('🍺 TABLICA WYPRAW','Dungeon, questy, PvP czy luźne granie? Zbierz ekipę jednym kliknięciem.\n\nZgłoszenia mają termin ważności. Autor i kadra mogą je zamknąć. Trial ma pełny dostęp do zapisów.')],components:[row(button('sc:new','Dodaj wyprawę',ButtonStyle.Success),button('sc:lfg','Zobacz otwarte'))],allowedMentions:{parse:[]}};const id=get('lfg_panel');let existing=id?await c.messages.fetch(id).catch(()=>null):null;const m=existing?await existing.edit(payload):await c.send(payload);set('lfg_panel',m.id);}
 function lfgPayload(e){const users=db.prepare('SELECT user_id,wow_role FROM expedition_members WHERE expedition_id=?').all(e.id);const dungeon=e.mode==='DUNGEON';const slots=dungeon?`\n🛡️ Tank ${users.filter(u=>u.wow_role==='TANK').length}/1 • 💚 Heal ${users.filter(u=>u.wow_role==='HEAL').length}/1 • ⚔️ DPS ${users.filter(u=>u.wow_role==='DPS').length}/3`:'';return {embeds:[embed(`⚔️ WYPRAWA #${e.id} • ${e.title}`.slice(0,256),`${text(e.details)}\n\nOrganizator: <@${e.owner_id}>\nWażna do: <t:${Math.floor(e.expires_at/1000)}:f>\nStatus: **${e.status==='OPEN'?'OTWARTA':'ZAMKNIĘTA'}**\nZapisani: **${users.length}/${e.capacity}**${slots}\n${users.map(u=>`<@${u.user_id}>${u.wow_role?` (${u.wow_role})`:''}`).join(', ')||'Jeszcze nikt — pierwsze miejsce czeka.'}`)],components:e.status==='OPEN'?[row(...(dungeon?['TANK','HEAL','DPS'].map(r=>button(`sc:join:${e.id}:${r}`,r,ButtonStyle.Success)):[button(`sc:join:${e.id}`,'Dołącz',ButtonStyle.Success)]),button(`sc:leave:${e.id}`,'Wypisz mnie'),button(`sc:close:${e.id}`,'Zamknij',ButtonStyle.Danger))]:[],allowedMentions:{parse:[]}};}
 async function refreshLfg(id){const e=db.prepare('SELECT * FROM expeditions WHERE id=?').get(id);const c=channel('wyprawy');if(e?.message_id&&c)await (await c.messages.fetch(e.message_id)).edit(lfgPayload(e));}
 function list(kind){
  const data=kind==='polls'?db.prepare("SELECT id,question AS name,status,message_id,channel_id FROM polls WHERE guild_id=? ORDER BY CASE WHEN status='OPEN' THEN 0 ELSE 1 END,id DESC LIMIT 25").all(guild.id):db.prepare("SELECT id,name,CASE WHEN status='ACTIVE' AND scheduled_ts<? THEN 'TERMIN MINĄŁ' ELSE status END AS status,calendar_message_id AS message_id FROM raids ORDER BY CASE WHEN status='ACTIVE' AND scheduled_ts>? THEN 0 ELSE 1 END,CASE WHEN scheduled_ts>? THEN scheduled_ts END,id DESC LIMIT 25").all(Math.floor(Date.now()/1000),Math.floor(Date.now()/1000),Math.floor(Date.now()/1000));
  return {embeds:[embed(kind==='polls'?'🗳️ GŁOS GILDII':'⚔️ KALENDARZ WYPRAW',data.length?'Wybierz **ID • nazwę • status**, aby przejść do szczegółów i zarządzania.':'Na razie pusto. Nowe wydarzenia pojawią się tutaj.')],components:data.length?[row(new StringSelectMenuBuilder().setCustomId(`sc:select:${kind}`).setPlaceholder('Wybierz z listy').addOptions(data.map(x=>({label:`#${x.id} • ${x.name}`.slice(0,100),description:x.status,value:String(x.id)}))))]:[]};
 }
 async function handle(i){
  if(await staffTools.handle(i))return true;
  if(!i.customId?.startsWith('sc:'))return false;
  if(i.guildId&&i.guildId!==guild.id)return false;
  const member=i.member?.roles?.cache?i.member:await guild.members.fetch(i.user.id);
  if(!has(member,PLAYERS)){await i.reply({content:'Najpierw dołącz przez #start. Ranga Trial odblokowuje funkcje gracza.',flags:MessageFlags.Ephemeral});return true;}
  const parts=i.customId.split(':');const action=parts[1];const id=Number(parts[2]);
  if(action==='new'){
   const modal=new ModalBuilder().setCustomId('sc:create').setTitle('Nowa wyprawa');
   for(const [key,label,placeholder] of [['title','Cel wyprawy','Dungeon / questy / PvP / luźne granie'],['details','Plan i godzina startu','Np. dzisiaj 21:00, szukamy heala i DPS'],['capacity','Liczba miejsc (2–40)','5'],['hours','Ważność w godzinach (1–72)','6'],['mode','Tryb: dungeon albo luźne','dungeon: 1 tank + 1 heal + 3 DPS']])modal.addComponents(row(new TextInputBuilder().setCustomId(key).setLabel(label).setPlaceholder(placeholder).setStyle(key==='details'?TextInputStyle.Paragraph:TextInputStyle.Short).setMaxLength(key==='details'?800:key==='title'?80:key==='mode'?12:2).setRequired(true)));
   await i.showModal(modal);return true;
  }
  if(action==='edit'&&has(member,STAFF)){
   const kind=parts[2], itemId=Number(parts[3]);const x=kind==='polls'?db.prepare('SELECT question AS value FROM polls WHERE id=? AND guild_id=?').get(itemId,guild.id):db.prepare('SELECT description AS value FROM raids WHERE id=?').get(itemId);
   if(!x){await i.reply({content:'Nie ma już tej pozycji.',flags:MessageFlags.Ephemeral});return true;}
   await i.showModal(new ModalBuilder().setCustomId(`sc:save:${kind}:${itemId}`).setTitle(`Edycja #${itemId}`).addComponents(row(new TextInputBuilder().setCustomId('value').setLabel(kind==='polls'?'Treść pytania':'Opis raidu').setStyle(TextInputStyle.Paragraph).setValue(x.value||'').setMaxLength(800).setRequired(true))));return true;
  }
  await i.deferReply({flags:MessageFlags.Ephemeral});
  const reply=content=>i.editReply(typeof content==='string'?{content,allowedMentions:{parse:[]}}:content);
  if(action==='tavern'){
   const job=db.prepare("SELECT id FROM community_jobs WHERE id=? AND kind='tavern' AND status='done'").get(i.customId.slice('sc:tavern:'.length));
   if(!job){await reply('Karczma jeszcze nie otworzyła tej sceny.');return true;}
   const day=DateTime.now().setZone(ZONE).toISODate();const value=createHash('sha256').update(`${guild.id}:${i.user.id}:${day}`).digest().readUInt32BE(0)%20+1;
   const fresh=db.prepare('INSERT OR IGNORE INTO tavern_rolls(user_id,day,value,created_at) VALUES(?,?,?,?)').run(i.user.id,day,value,Date.now()).changes;
   const roll=db.prepare('SELECT value FROM tavern_rolls WHERE user_id=? AND day=?').get(i.user.id,day).value;
   await reply({embeds:[embed('🎲 RZUT LOSU • KARCZMA SKAZANYCH',`**D20: ${roll}**\n${roll===20?'LOK’TAR! Nawet goblin oddaje Ci ostatni kufel.':roll===1?'Mankrik znów prosi o pomoc. Goblin dolicza opłatę za pecha.':roll>=15?'Twoja opowieść o wyprawie rozgrzewa całą ławę Hordy.':roll>=8?'Dobra ekipa i pełny kufel. Dziś wygrywa spokojne granie.':'Zgubiłeś hearthstone. Towarzysze ruszają po Ciebie — bez zostawiania swoich.'}\n\n${fresh?'Pierwszy rzut dzisiaj.':'Dzisiejszy wynik już zapisano; nie losujemy ponownie.'}\n*Zabawa fabularna, nie nagroda ani ranga. Jeden wynik dziennie (czas PL).*`)],components:[row(button('v2:home','⚔️ Centrum gildii'),button('sc:lfg','🍺 Zbierz ekipę'))]});return true;
  }
  if(['polls','raids'].includes(action)){const payload=list(action);payload.components.push(row(button('v2:home','⬅️ Centrum gildii')));await reply(payload);return true;}
  if(action==='staff'){
   if(!has(member,STAFF))await reply('Tylko kadra ma dostęp do tego panelu.');
   else await reply({embeds:[embed('🛠️ STÓŁ DOWÓDCÓW',`Memy: **${get('meme_paused')!=='1'?'aktywne — zatwierdzona kolejka':'wstrzymane'}**\nZarządzaj zadaniami, dyżurami, ankietami i raidami.\nProfile graczy: /profil ustaw\nNowy raid: /raid utworz\nNowa ankieta: /ankieta utworz`)],components:[row(button('sc:officer:list','Zadania i dyżury',ButtonStyle.Primary),button('sc:polls','Ankiety'),button('sc:raids','Raidy')),row(button('sc:memereview','Ocena memów'),button(get('meme_paused')==='1'?'sc:resume':'sc:pause',get('meme_paused')==='1'?'Włącz memy':'Wstrzymaj memy'))]});return true;
  }
  if(['pause','resume'].includes(action)){if(!has(member,STAFF))await reply('Ta opcja jest dla kadry.');else{set('meme_paused',action==='pause'?'1':'0');await reply(action==='pause'?'Memiarnia wstrzymana.':'Memiarnia aktywna: publikowane są wyłącznie zatwierdzone memy, bez powtórek.');}return true;}
  if(['memereview','memepreview','memeapprove','memereject'].includes(action)){
   if(!has(member,STAFF)){await reply('Ocena kolejki jest dla kadry.');return true;}
   if(action==='memereview'){const pending=db.prepare("SELECT * FROM community_memes WHERE quality_status='PENDING' AND source='wowmemes' AND published_at IS NULL ORDER BY ups DESC LIMIT 25").all();await reply({embeds:[embed('🧪 OCENA MEMÓW WOw',pending.length?'Internet trafia tu, nie bezpośrednio na offtop. Zatwierdź tylko humor pasujący do WoW i gildii.':'Brak nowych kandydatów. Kolejka korzysta z memów WoW z Reddita.')],components:pending.length?[row(new StringSelectMenuBuilder().setCustomId('sc:memepreview').setPlaceholder('Wybierz kandydata').addOptions(pending.map(m=>({label:`#${m.id} ${m.title}`.slice(0,100),value:String(m.id)}))))]:[]});return true;}
   const n=action==='memepreview'?Number(i.values[0]):id;const m=db.prepare("SELECT * FROM community_memes WHERE id=? AND source='wowmemes' AND published_at IS NULL AND quality_status='PENDING'").get(n);if(!m){await reply('Ten kandydat został już oceniony albo nie istnieje.');return true;}
   if(action==='memepreview')await reply({embeds:[embed(`🧪 Kandydat #${m.id}`,`${text(m.title)}\n[Źródło](${m.url})`).setImage(m.image)],components:[row(button(`sc:memeapprove:${m.id}`,'Zatwierdź',ButtonStyle.Success),button(`sc:memereject:${m.id}`,'Odrzuć',ButtonStyle.Danger))]});
   else {if(action==='memeapprove'&&!validMeme({nsfw:false,spoiler:false,ups:m.ups,title:m.title,url:m.image,postLink:m.url})){await reply('Kandydat nie spełnia technicznych filtrów bezpieczeństwa.');return true;}db.prepare('UPDATE community_memes SET quality_status=? WHERE id=?').run(action==='memeapprove'?'APPROVED':'REJECTED',m.id);await reply(`Mem #${m.id}: ${action==='memeapprove'?'zatwierdzony':'odrzucony'}.`);}return true;
  }
  if(action==='select'){
   const kind=parts[2], n=Number(i.values[0]);const x=kind==='polls'?db.prepare('SELECT *,question AS name FROM polls WHERE id=? AND guild_id=?').get(n,guild.id):db.prepare('SELECT * FROM raids WHERE id=?').get(n);
   if(!x){await reply('Nie znaleziono tej pozycji.');return true;}
   const c=kind==='polls'?x.channel_id:channel('kalendarz')?.id;const message=kind==='polls'?x.message_id:x.calendar_message_id;const actions=[];
   if(c&&message)actions.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Otwórz wiadomość / zapisy').setURL(`https://discord.com/channels/${guild.id}/${c}/${message}`));
   if(has(member,STAFF))actions.push(button(`sc:edit:${kind}:${n}`,'Edytuj'),button(`sc:confirm:${kind}:${n}`,kind==='raids'?'Zamknij zapisy':'Zamknij ankietę',ButtonStyle.Danger));
   let composition='';if(kind==='raids'){const signed=db.prepare("SELECT m.wow_role FROM raid_signups s LEFT JOIN members m USING(user_id) WHERE s.raid_id=? AND s.status='YES'").all(n);const roles=signed.map(s=>roleKind(s.wow_role));composition=`\nTermin: <t:${x.scheduled_ts}:f>${x.scheduled_ts<Math.floor(Date.now()/1000)?' — termin minął':''}\nBędą: **${signed.length}** • Tank ${roles.filter(r=>r==='TANK').length} • Heal ${roles.filter(r=>r==='HEAL').length} • DPS ${roles.filter(r=>r==='DPS').length} • brak funkcji ${roles.filter(r=>!r).length}`;}
   await reply({embeds:[embed(`#${n} • ${x.name}`.slice(0,256),`Status: **${x.status}**${composition}\n${text(x.description||'Głosuj lub zapisz się w wiadomości wydarzenia.')}`)],components:[...(actions.length?[row(...actions)]:[]),row(button(`sc:${kind}`,kind==='polls'?'⬅️ Ankiety':'⬅️ Wydarzenia'),button('v2:home','Centrum gildii'))]});return true;
  }
  if(['save','confirm','finish'].includes(action)){
   if(!has(member,STAFF)){await reply('Ta opcja jest dla kadry.');return true;}
   const kind=parts[2], n=Number(parts[3]);if(!['polls','raids'].includes(kind)||!Number.isSafeInteger(n)){await reply('Nieprawidłowy identyfikator.');return true;}
   if(action==='confirm'){await reply({content:`Zamknąć ${kind==='polls'?'ankietę':'zapisy na raid'} #${n}?${kind==='raids'?' Wydarzenie i przypomnienia nadal pozostają w kalendarzu.':''}`,components:[row(button(`sc:finish:${kind}:${n}`,'Potwierdzam zamknięcie',ButtonStyle.Danger))]});return true;}
   if(kind==='polls'){
    if(action==='save')db.prepare('UPDATE polls SET question=? WHERE id=? AND guild_id=?').run(i.fields.getTextInputValue('value').trim(),n,guild.id);
    else db.prepare("UPDATE polls SET status='CLOSED',closed_at=? WHERE id=? AND guild_id=?").run(Date.now(),n,guild.id);
    await refreshPolls();
   }else{
    if(action==='save')db.prepare('UPDATE raids SET description=? WHERE id=?').run(i.fields.getTextInputValue('value').trim(),n);
    else db.prepare("UPDATE raids SET status='CLOSED' WHERE id=? AND status='ACTIVE'").run(n);
    await refreshRaids(n);
   }
   await reply(`Zapisano zmiany #${n}.`);return true;
  }
  if(action==='lfg'){const rows=db.prepare("SELECT * FROM expeditions WHERE status='OPEN' AND expires_at>? ORDER BY expires_at LIMIT 15").all(Date.now());const c=channel('wyprawy');await reply({embeds:[embed('🍺 SZUKAM EKIPY',rows.map(e=>`**#${e.id} ${text(e.title)}** — <t:${Math.floor(e.expires_at/1000)}:R>${e.message_id&&c?` [Otwórz](https://discord.com/channels/${guild.id}/${c.id}/${e.message_id})`:''}`).join('\n')||'Tablica jest pusta. Rozpocznij własną wyprawę!')],components:[row(button('sc:new','Dodaj wyprawę',ButtonStyle.Success),button('v2:home','⬅️ Centrum gildii'))]});return true;}
  if(action==='create'){
   const capacity=Number(i.fields.getTextInputValue('capacity')),hours=Number(i.fields.getTextInputValue('hours')),title=i.fields.getTextInputValue('title').trim(),details=i.fields.getTextInputValue('details').trim();
   const modeValue=i.fields.getTextInputValue('mode').trim().toLowerCase();const mode=modeValue==='dungeon'?'DUNGEON':'FREE';
   if(!['dungeon','luźne','luzne','free'].includes(modeValue)){await reply('Tryb: dungeon albo luźne.');return true;}
   const ownerRole=roleKind(db.prepare('SELECT wow_role FROM members WHERE user_id=?').get(i.user.id)?.wow_role);
   if(mode==='DUNGEON'&&(capacity!==5||!ownerRole)){await reply('Dungeon ma 5 miejsc: 1 tank, 1 heal, 3 DPS. Ustaw swoją funkcję w profilu i podaj 5 miejsc.');return true;}
   if(!Number.isInteger(capacity)||capacity<2||capacity>40||!Number.isInteger(hours)||hours<1||hours>72||!title||!details){await reply('Podaj cel, opis, 2–40 miejsc oraz 1–72 godzin ważności.');return true;}
   const c=channel('wyprawy');if(!c){await reply('Tablica chwilowo niedostępna.');return true;}
   await serial(`create:${i.user.id}`,async()=>{
    if(db.prepare("SELECT count(*) n FROM expeditions WHERE owner_id=? AND status='OPEN' AND expires_at>?").get(i.user.id,Date.now()).n>=3){await reply('Masz już 3 otwarte wyprawy. Zamknij poprzednią.');return;}
    const created=require('./lfg-actions.cjs').createExpedition(db,i.user.id,{title,details,capacity,hours,mode});
    if(created.error){await reply(created.error);return;}
    const n=created.id;
    try{const m=await require('./lfg-actions.cjs').publishExpedition({db,guild,channel:c,payload:lfgPayload,id:n});await reply(`Wyprawa #${n} gotowa: https://discord.com/channels/${guild.id}/${c.id}/${m.id}`);}catch(error){await reply(`Wyprawa #${n} zapisana. Publikacja ma niepewny wynik; sprawdź Discord, nie twórz jej ponownie.`);}

   });return true;
  }
  if(['join','leave','close'].includes(action)){
   await serial(`expedition:${id}`,async()=>{
    const e=db.prepare('SELECT * FROM expeditions WHERE id=?').get(id);if(!e||e.status!=='OPEN'||e.expires_at<=Date.now()){await reply('Ta wyprawa jest już zamknięta.');return;}
    if(action==='close'){if(e.owner_id!==i.user.id&&!has(member,STAFF)){await reply('Zamknąć może autor lub kadra.');return;}db.prepare("UPDATE expeditions SET status='CLOSED' WHERE id=?").run(id);}
    else if(action==='leave')db.prepare('DELETE FROM expedition_members WHERE expedition_id=? AND user_id=?').run(id,i.user.id);
    else {const chosen=roleKind(parts[3]||db.prepare('SELECT wow_role FROM members WHERE user_id=?').get(i.user.id)?.wow_role);const outcome=joinExpedition(db,e,i.user.id,chosen);if(outcome==='closed'){await reply('Ta wyprawa jest już zamknięta.');return;}if(outcome==='role'){await reply('Wybierz TANK, HEAL albo DPS.');return;}if(outcome==='full'){await reply('Komplet — brak wolnego miejsca dla tej funkcji.');return;}}
    await refreshLfg(id);await reply(action==='close'?'Wyprawa zamknięta.':action==='leave'?'Wypisano z wyprawy.':'Jesteś na liście. Do zobaczenia w Azeroth!');
   });return true;
  }
  if(action==='vote'){
   const vote=parts[3]==='up'?1:-1;const meme=db.prepare('SELECT id FROM community_memes WHERE id=? AND published_at IS NOT NULL').get(id);if(!meme){await reply('Ten mem nie jest już dostępny.');return true;}
   db.prepare('INSERT INTO community_meme_votes VALUES(?,?,?) ON CONFLICT(meme_id,user_id) DO UPDATE SET vote=excluded.vote').run(id,i.user.id,vote);if(db.prepare('SELECT count(*) n FROM community_meme_votes WHERE meme_id=? AND vote=-1').get(id).n>=2){db.prepare("UPDATE community_memes SET quality_status='RETIRED' WHERE id=?").run(id);}await reply(vote===1?'😂 Goblin zanotował: więcej takich.':'🗑️ Zanotowano — mniej takich klimatów. Dwa głosy na nie wycofują mem z kolejki.');return true;
  }
  await reply('Ten przycisk stracił ważność. Otwórz /bot.');return true;
 }
 async function collect(){
  const {candidates,errors,retryAfter}=await collectTop();
  for(const m of candidates){
   const topic=classify(m.title);if(!topic.theme)continue;
   const pk=postKey(m.url),ik=imageKey(m.image);
   if(db.prepare('SELECT id FROM community_memes WHERE post_key=? OR image_key=? OR url=? OR image=?').get(pk,ik,m.url,m.image))continue;
   db.prepare("INSERT OR IGNORE INTO community_memes(url,image,title,source,ups,seen_at,quality_status,post_key,image_key,top_rank,top_period,origin) VALUES(?,?,?,?,?,?,'APPROVED',?,?,?,?,?)").run(m.url,m.image,text(m.title),m.source,m.ups,Date.now(),pk,ik,m.rank,m.period,m.origin);
   db.prepare('UPDATE community_memes SET theme=? WHERE post_key=?').run(topic.theme,pk);
  }
  set('last_collect',Date.now());set('meme_collect_after',Date.now()+(retryAfter||6*3600000));
  set('meme_source_status',errors.join(';')||'ok');
  console.log(`MEME TOP candidates=${candidates.length} sources=${errors.length?'limited':'ok'}`);
 }
 async function verifiedImage(m){
  if(!validCandidate({...m,nsfw:false,spoiler:false}))return false;
  if(db.prepare("SELECT id FROM community_memes WHERE id<>? AND (published_at IS NOT NULL OR quality_status='QUARANTINED') AND (post_key=? OR image_key=?)").get(m.id,postKey(m.url),imageKey(m.image)))return false;
  const r=await fetch(m.image,{redirect:'error',signal:AbortSignal.timeout(12000)});
  if(!r.ok||!/^image\/(png|jpeg|webp)(?:;|$)/i.test(r.headers.get('content-type')||''))return false;
  if(Number(r.headers.get('content-length'))>10*1024*1024)return false;
  const reader=r.body.getReader();let size=0;const chunks=[];
  try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>10*1024*1024){await reader.cancel();return false;}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}
  if(!size)return false;
  const hash=createHash('sha256').update(Buffer.concat(chunks)).digest('hex');
  if(db.prepare("SELECT id FROM community_memes WHERE id<>? AND image_hash=? AND (published_at IS NOT NULL OR quality_status='QUARANTINED')").get(m.id,hash))return false;
  db.prepare('UPDATE community_memes SET image_hash=? WHERE id=?').run(hash,m.id);return true;
 }

 function plan(now=Date.now()){
  const monday=DateTime.fromMillis(now,{zone:ZONE}).startOf('week');const tavernWeek=monday.toISODate();
  if(get('planned_tavern_week')!==tavernWeek)db.transaction(()=>{for(const day of [1,4]){const due=monday.plus({days:day,hours:18,minutes:Math.floor(Math.random()*180)}).toMillis();if(due>now)db.prepare('INSERT OR IGNORE INTO community_jobs(id,kind,due) VALUES(?,?,?)').run(`tavern:${tavernWeek}:${day}`,'tavern',due);}set('planned_tavern_week',tavernWeek);})();
  const week=DateTime.fromMillis(now,{zone:ZONE}).startOf('week').toISODate();if(get('planned_week')!==week){db.transaction(()=>{nextWeekSlots(now).forEach((due,n)=>{if(due>now)db.prepare('INSERT OR IGNORE INTO community_jobs(id,kind,due) VALUES(?,?,?)').run(`meme:${week}:${n}`,'meme',due);});const due=DateTime.fromMillis(now,{zone:ZONE}).startOf('week').plus({days:6,hours:18}).toMillis();if(due>now)db.prepare('INSERT OR IGNORE INTO community_jobs(id,kind,due) VALUES(?,?,?)').run(`weekly:${week}`,'weekly',due);set('planned_week',week);})();}
 }
 async function publish(job){
  if(require("./maintenance.cjs").maintenance(db))return;
  const persisted=db.prepare('SELECT * FROM community_jobs WHERE id=?').get(job.id);
  if(!persisted||!['pending','sending'].includes(persisted.status))return;
  job=persisted;
  const c=channel(['meme','tavern'].includes(job.kind)?'offtop':'ogłoszenia-bota');if(!c)throw Error('Brak kanału publikacji');
  // Recovery: message footer is a durable delivery key, checked before retry.
  const messages=await c.messages.fetch({limit:100});const existing=messages.find(m=>m.author.id===guild.members.me.id&&m.embeds.some(e=>e.footer?.text?.endsWith(`• ${job.id}`)));
  if(existing){db.prepare("UPDATE community_jobs SET status='done',message_id=? WHERE id=?").run(existing.id,job.id);if(job.kind==='meme'){db.prepare('UPDATE community_memes SET published_at=COALESCE(published_at,?),message_id=? WHERE url=?').run(Date.now(),existing.id,existing.embeds[0]?.url||'');set('last_meme',Date.now());}return;}
  if(job.status==='sending'){
   // Unknown result after a crash/API timeout. A 100-message history window
   // cannot prove non-delivery; quarantine instead of creating a duplicate.
   db.prepare("UPDATE community_jobs SET status='uncertain' WHERE id=?").run(job.id);
   if(job.meme_id)db.prepare("UPDATE community_memes SET quality_status='QUARANTINED' WHERE id=? AND published_at IS NULL").run(job.meme_id);
   console.warn(`🛡️ COMMUNITY delivery uncertain: ${job.id}; wymaga sprawdzenia historii`);return;
  }
  let payload,meme;
  if(job.kind==='meme'){
   if(!MEME_AUTO_PUBLISH_ENABLED||get('meme_paused')==='1'){db.prepare("UPDATE community_jobs SET status='skipped' WHERE id=?").run(job.id);console.log(`⏸️ MEME ${job.id}: automatyczna publikacja wyłączona po audycie jakości`);return;}
   const pool=db.prepare("SELECT * FROM community_memes WHERE published_at IS NULL AND quality_status='APPROVED' AND asset IS NULL AND source='wowmemes' ORDER BY CASE top_period WHEN 'week' THEN 0 WHEN 'month' THEN 1 ELSE 2 END, CASE WHEN top_rank>0 THEN top_rank ELSE 999 END, ups DESC,id LIMIT 100").all();
   const feedback={};for(const v of db.prepare("SELECT m.theme,v.vote,COUNT(*) n FROM community_meme_votes v JOIN community_memes m ON m.id=v.meme_id WHERE m.published_at>? GROUP BY m.theme,v.vote").all(Date.now()-14*86400000)){feedback[v.theme]??={up:0,down:0};feedback[v.theme][v.vote===1?'up':'down']+=v.n;}
   const lastThemes=db.prepare('SELECT theme FROM community_memes WHERE published_at IS NOT NULL ORDER BY published_at DESC LIMIT 3').all().map(x=>x.theme);
   const candidates=rankMemes(pool,{lastThemes,feedback});
   for(const candidate of candidates){
    try{if(await verifiedImage(candidate)){meme=candidate;break;}db.prepare("UPDATE community_memes SET quality_status='REJECTED' WHERE id=?").run(candidate.id);}catch(e){console.warn('MEME IMAGE temporarily unavailable:',e.message);}
   }
   if(!meme){db.prepare("UPDATE community_jobs SET status='skipped' WHERE id=?").run(job.id);return;}
   payload={embeds:[embed('😂 GOBLIŃSKA MEMIARNIA',`${text(meme.title)}\n\n[Źródło: r/${meme.source}](${meme.url})`).setURL(meme.url).setImage(meme.image).setFooter({text:`THE SENTENCED • oceń gust goblina • ${job.id}`})],components:[row(button(`sc:vote:${meme.id}:up`,'😂 Więcej takich'),button(`sc:vote:${meme.id}:down`,'🗑️ Nie mój klimat'))]};
  }else if(job.kind==='tavern'){
   payload={embeds:[embed('🍺 KARCZMA SKAZANYCH • WIECZÓR HORDY','Goblin wyciąga kość D20. Thrall słucha opowieści, a wolne miejsce przy ławie czeka na Ciebie.\n\n🎲 Rzuć los prywatnie — jeden wynik dziennie.\n⚔️ Zbierz ekipę na dungeon, PvP, questy albo RP.\n\n*Bez farmienia punktów, wymuszonych pingów i nagród zmieniających rangi. Po prostu The Sentenced.*').setFooter({text:`THE SENTENCED • Lok’tar ogar! • ${job.id}`})],components:[row(button(`sc:tavern:${job.id}`,'🎲 Rzuć los'),button('sc:lfg','⚔️ Szukam ekipy'),button('v2:crew','🧭 Kto gra?'))]};
  }else{
   const now=Math.floor(Date.now()/1000);const raids=db.prepare("SELECT id,name,scheduled_ts FROM raids WHERE status IN ('ACTIVE','CLOSED') AND scheduled_ts BETWEEN ? AND ? ORDER BY scheduled_ts LIMIT 10").all(now,now+7*86400);const polls=db.prepare("SELECT id,question FROM polls WHERE guild_id=? AND status='OPEN' ORDER BY id DESC LIMIT 10").all(guild.id);const newcomers=db.prepare('SELECT count(*) n FROM members WHERE joined_at>=? AND left_at IS NULL').get(Date.now()-7*86400000).n;
   payload={embeds:[embed('📜 KRONIKA THE SENTENCED',`**Najbliższe wyprawy**\n${raids.map(r=>`#${r.id} ${text(r.name)} — <t:${r.scheduled_ts}:f>`).join('\n')||'Kalendarz czeka na nowe plany.'}\n\n**Głos gildii**\n${polls.map(p=>`#${p.id} ${text(p.question)}`).join('\n')||'Brak otwartych ankiet.'}\n\n**Przy naszej ławie:** ${newcomers} nowych osób w tym tygodniu.\n\nPanel gildii: /bot • Ekipa: #wyprawy`).setFooter({text:`THE SENTENCED • Kronika tygodnia • ${job.id}`})]};
  }
  db.prepare("UPDATE community_jobs SET status='sending',meme_id=? WHERE id=?").run(meme?.id||null,job.id);
  const message=await c.send({...payload,allowedMentions:{parse:[]}});
  db.transaction(()=>{db.prepare("UPDATE community_jobs SET status='done',message_id=? WHERE id=?").run(message.id,job.id);if(meme){db.prepare('UPDATE community_memes SET published_at=?,message_id=? WHERE id=?').run(Date.now(),message.id,meme.id);set('last_meme',Date.now());set('last_meme_theme',meme.theme||'');}})();
 }
 async function tick(){if(busy)return;busy=true;try{
  plan();
  for(const e of db.prepare("SELECT id FROM expeditions WHERE status='OPEN' AND expires_at<=?").all(Date.now())){db.prepare("UPDATE expeditions SET status='CLOSED' WHERE id=?").run(e.id);await refreshLfg(e.id).catch(e=>console.error('LFG REFRESH:',e.message));}
  if(Date.now()>Number(get('meme_collect_after','0')))await collect();
  const hour=DateTime.now().setZone(ZONE).hour;
  if(hour>=10&&hour<23){for(const job of db.prepare("SELECT * FROM community_jobs WHERE status IN ('pending','sending') AND due<=? ORDER BY due LIMIT 1").all(Date.now())){if(job.status==='pending'&&Date.now()-job.due>6*3600000){db.prepare("UPDATE community_jobs SET status='skipped' WHERE id=?").run(job.id);continue;}await publish(job);}}
  db.prepare("DELETE FROM community_memes WHERE published_at IS NULL AND quality_status='PENDING' AND seen_at<?").run(Date.now()-30*86400000);
 }catch(e){console.error('COMMUNITY:',e.message);}finally{busy=false;}}
 async function start(){await panel();plan();void tick();const timer=setInterval(()=>void tick(),60000);timer.unref();console.log('✅ Community 2.5 online | Reddit WoW Top i Karczma Skazanych');return timer;}
 return {handle,start,nav,plan,collect,tick,publish,lfgPayload};
}
const {joinExpedition}=require('./lfg-actions.cjs');
module.exports={createCommunity,schema,nextWeekSlots,validMeme,has,PLAYERS,STAFF,joinExpedition};
