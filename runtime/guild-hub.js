'use strict';
const {version:SYSTEM_VERSION}=require('./system-version.json');
const {ABOUT_CHANNEL,SITE}=require('./guild-refresh.cjs');
const {ADDON_CHANNEL}=require('./guild-addon.cjs');
const {CLASS_CHANNELS}=require('./guild-channel-ids.cjs');
const {DateTime}=require('luxon');
const {EmbedBuilder,ActionRowBuilder,ButtonBuilder,ButtonStyle,StringSelectMenuBuilder,ModalBuilder,TextInputBuilder,TextInputStyle,MessageFlags}=require('discord.js');
const {has,text,json,roleKind,missingProfileFields,STAFF,OFFICERS}=require('./guild-core');
const {modes,MODES,PACES}=require('./guild-identity');
const promotions=require('./guild-promotions.cjs');
const PROFESSIONS=Object.freeze({Alchemy:'Alchemia',Blacksmithing:'Kowalstwo',Enchanting:'Zaklinanie',Engineering:'Inżynieria',Herbalism:'Zielarstwo',Leatherworking:'Kuśnierstwo',Mining:'Górnictwo',Skinning:'Skórowanie',Tailoring:'Krawiectwo',Cooking:'Gotowanie',Fishing:'Wędkarstwo',FirstAid:'Pierwsza pomoc'});
const SECONDARY=['Cooking','Fishing','FirstAid'];
const DAYS=['pon','wt','śr','czw','pt','sob','nd'];
const row=(...c)=>new ActionRowBuilder().addComponents(...c);
const btn=(id,label,style=ButtonStyle.Secondary)=>new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
const card=(title,desc)=>new EmbedBuilder().setColor(0xA8202A).setTitle(title.slice(0,256)).setDescription(desc.slice(0,4000)).setFooter({text:'THE SENTENCED • HORDA • v'+SYSTEM_VERSION});
function schema(db){
 db.exec(`CREATE TABLE IF NOT EXISTS member_preferences(user_id TEXT PRIMARY KEY,ready_until INTEGER NOT NULL DEFAULT 0,play_days TEXT NOT NULL DEFAULT '[]',play_start INTEGER,play_end INTEGER,play_note TEXT NOT NULL DEFAULT '',professions TEXT NOT NULL DEFAULT '[]',updated_at INTEGER NOT NULL);`);
 // Preserve existing preferences and optional columns managed by other modules.
 if(typeof db.prepare==='function'){
  const existing=new Set(db.prepare('PRAGMA table_info(member_preferences)').all().map(c=>c.name));
  for(const [name,type] of [['specialization','TEXT'],['specialization_class','TEXT'],['specialization_character','TEXT'],['specialization_updated_at','INTEGER']]){
   if(!existing.has(name))db.exec(`ALTER TABLE member_preferences ADD COLUMN ${name} ${type}`);
  }
 }
}
function parseSpecialization(value){
 if(typeof value!=='string'||value.length>60||/[\x00-\x1f\x7f<>@|]/.test(value))throw Error('Specjalizacja: maksymalnie 60 znaków, bez oznaczeń i znaków sterujących.');
 return value.trim();
}
function specializationFor(preference,record){
 return preference?.specialization&&preference.specialization_class===record?.wow_class&&preference.specialization_character===record?.game_nick?preference.specialization:null;
}
function parseAvailability(days,start,end,note=''){
 const selected=[...new Set(String(days).toLowerCase().split(/[ ,;]+/).filter(Boolean))];
 if(!selected.length||selected.some(d=>!DAYS.includes(d)))throw Error('Dni podaj skrótami: pon wt śr czw pt sob nd.');
 const minutes=v=>{const m=String(v).match(/^(\d{1,2}):([0-5]\d)$/);if(!m||Number(m[1])>23)throw Error('Godzinę podaj jako HH:MM, np. 20:00.');return Number(m[1])*60+Number(m[2]);};
 const a=minutes(start),b=minutes(end);if(a===b)throw Error('Początek i koniec nie mogą być takie same.');
 return {days:selected.map(d=>DAYS.indexOf(d)+1),start:a,end:b,note:String(note).trim().slice(0,150)};
}
// Selected days name the start day, including for windows extending into tomorrow.
function isAvailableAt(p,weekday,minute){
 if(p.play_start==null||p.play_end==null||p.play_start===p.play_end)return false;
 const days=json(p.play_days);
 if(p.play_start<p.play_end)return days.includes(weekday)&&minute>=p.play_start&&minute<p.play_end;
 const previous=weekday===1?7:weekday-1;
 return (days.includes(weekday)&&minute>=p.play_start)||(days.includes(previous)&&minute<p.play_end);
}
const clock=n=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
function createGuildHub({db,guild,getChannel,community,milestones,refreshGuildState=async()=>{}}){
 schema(db);
 const prefs=id=>db.prepare('SELECT * FROM member_preferences WHERE user_id=?').get(id);
 const ensure=id=>db.prepare('INSERT OR IGNORE INTO member_preferences(user_id,updated_at) VALUES(?,?)').run(id,Date.now());
 const present=id=>{const m=guild.members.cache.get(id);return m&&!m.user?.bot&&has(m);};
 const roster=()=>db.prepare('SELECT p.*,m.game_nick,m.display_name,m.wow_class,m.wow_role,m.interests FROM member_preferences p JOIN members m USING(user_id) WHERE m.left_at IS NULL').all().filter(x=>present(x.user_id));
 const ready=()=>roster().filter(x=>x.ready_until>Date.now());
 const name=x=>text(x.game_nick||x.display_name||'Gracz',50);
 const availability=p=>p?.play_start!=null&&json(p.play_days).length?`${json(p.play_days).map(d=>DAYS[d-1]).join(', ')} ${clock(p.play_start)}–${clock(p.play_end)}${p.play_start>p.play_end?' (następny dzień)':''} (PL)`:'Jeszcze nie ustawiona';
 function link(channel,label){const c=getChannel(guild,channel);return c?new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(label).setURL(`https://discord.com/channels/${guild.id}/${c.id}`):null;}
 function dashboard(member){
  const record=db.prepare('SELECT * FROM members WHERE user_id=?').get(member.id);const p=prefs(member.id);const missing=missingProfileFields(record);const players=ready();
  const next=db.prepare("SELECT * FROM raids WHERE status IN ('ACTIVE','CLOSED') AND scheduled_ts>? ORDER BY scheduled_ts LIMIT 1").get(Math.floor(Date.now()/1000));
  const my=db.prepare("SELECT r.id,r.name,r.scheduled_ts,s.status FROM raids r JOIN raid_signups s ON r.id=s.raid_id WHERE s.user_id=? AND r.status IN ('ACTIVE','CLOSED') AND r.scheduled_ts>? ORDER BY r.scheduled_ts LIMIT 3").all(member.id,Math.floor(Date.now()/1000));
  const open=db.prepare("SELECT count(*) n FROM expeditions WHERE status='OPEN' AND expires_at>?").get(Date.now()).n;
  const specialization=specializationFor(p,record);
  return card('⚔️ THE SENTENCED • CENTRUM GILDII',`**${name(record||{})}** • ${text(record?.wow_class||'klasa do uzupełnienia')} • ${text(record?.wow_role||'funkcja do uzupełnienia')}\n${missing.length?`📋 Profil ${4-missing.length}/4 — brakuje: **${missing.map(x=>x[1]).join(', ')}**`:'✅ Profil gotowy'}\n\n**Dziś w gildii**\n🟢 Zgłosiło gotowość: **${players.length}** • otwarte wyprawy: **${open}**\n${next?`⚔️ Następny raid **#${next.id} ${text(next.name,80)}** — <t:${next.scheduled_ts}:R>`:'⚔️ Brak zaplanowanego przyszłego raidu'}\n\n**Twoje plany**\n${my.map(x=>`#${x.id} ${text(x.name,60)} — ${x.status==='YES'?'Będę':x.status==='MAYBE'?'Może':'Nie będę'} • <t:${x.scheduled_ts}:f>`).join('\n')||'Nie masz jeszcze zapisu na przyszły raid.'}\n\n⚔️ Specjalizacja: ${specialization?text(specialization,60)+' (Twoja deklaracja)':'nie zadeklarowano'}\n🕒 Dostępność: ${availability(p)}\n🔨 Profesje: ${json(p?.professions).map(x=>PROFESSIONS[x]).join(', ')||'nie ustawione'}\n\n${p?.ready_until>Date.now()?`🟢 Twoja gotowość wygasa <t:${Math.floor(p.ready_until/1000)}:R>.`:'„Gram teraz” to Twoje zgłoszenie na 2 godziny — widoczność jest dobrowolna.'}`);
 }
 function rows(){
  return [
   row(btn('v2:profile','👤 Mój profil',ButtonStyle.Primary),btn('sc:raids','⚔️ Wydarzenia'),btn('v2:group','🧭 Znajdź grupę')),
   row(btn('sc:polls','🗳️ Ankiety'),btn('v2:guild','🏴 Gildia'),btn('v2:news','📰 Aktualności'),btn('v2:addon','📦 Addon')),
  ];
 }
 function section(action,member){
  const back=row(btn('v2:home','⬅️ Centrum gildii'));
  if(action==='profile')return {embeds:[card('👤 MÓJ PROFIL','Zobacz lub uzupełnij profil, wybierz powiadomienia i ustaw kiedy grasz.')],components:[
   row(btn('botmenu:profile','👤 Mój profil',ButtonStyle.Primary),btn('botmenu:edit','✏️ Edytuj'),btn('identity:home','🏅 Mój sztandar'),btn('notify:home','🔔 Powiadomienia')),
   row(btn('v2:availability','🕒 Kiedy gram'),btn('v2:professions','🔨 Moje profesje'),btn('v2:specialization','⚔️ Specjalizacja')),back]};
  if(action==='group'){const p=prefs(member.id);return {embeds:[card('🧭 ZNAJDŹ GRUPĘ','Znajdź wyprawę, osoby gotowe do gry lub fachowca. Gotowość jest dobrowolna.')],components:[
   row(btn('sc:lfg','⚔️ Otwarte wyprawy',ButtonStyle.Primary),btn('v2:crew','🧭 Kto gra?'),btn('v2:ready',p?.ready_until>Date.now()?'⚪ Kończę granie':'🟢 Gram teraz',ButtonStyle.Success),btn('v2:crafters','🧰 Znajdź fachowca')),back]};}
  if(action==='addon'){
   const {downloadButton,ADDON_HELP}=require('./guild-addon.cjs');
   return {embeds:[card('📦 THE SENTENCED • GUILD HALL',ADDON_HELP)],
    components:[row(downloadButton()),row(btn('transfer:open','Synchronizacja dodatku',ButtonStyle.Primary),btn('integration:addon','Połącz addon')),back]};
  }
  if(action==='guild'){
   const buttons=[btn('history:home','📜 Historia gildii'),btn('v2:promotions','📣 Materiały')];
   if(milestones)buttons.push(btn('v2:milestones','🏆 Osiągnięcia'));
   if(has(member,STAFF))buttons.push(btn('sc:staff','🛠️ Kadra'));
   if(process.env.TS_ROSTER_ENABLED==='true' && has(member,OFFICERS))buttons.push(btn('roster:home','📋 Roster'));
   const links=[link('stan-gildii','Stan gildii'),new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Strona gildii').setURL(SITE),
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('O sobie').setURL(`https://discord.com/channels/${guild.id}/${ABOUT_CHANNEL}`)].filter(Boolean);
   return {embeds:[card('🏴 GILDIA','Poznaj członków, ich postacie, profesje i historie.')],components:[row(btn('v2:table:roster:0:ALL','📊 Tabele gildii',ButtonStyle.Primary),btn('v2:people:0','👥 Ludzie i profesje'),btn('v2:crafters','🔨 Szukaj fachowca'),btn('v2:classes','🛡️ Klasy postaci')),row(...buttons),...(links.length?[row(...links)]:[]),back]};
  }
  if(action==='classes'){
   const channels=CLASS_CHANNELS.filter(([,id])=>guild.channels.cache.get(id)?.type===0);
   const description=channels.map(([label,id])=>`**${label}** — <#${id}>`).join('\n')||'Kanały klasowe jeszcze się wczytują.';
   return {embeds:[card('🛡️ KLASY POSTACI',description)],components:[row(btn('v2:guild','⬅️ Gildia'))]};
  }
  if(action==='news'){
   const news=link('forever-news','📰 Otwórz Forever News');
   return {embeds:[card('📰 AKTUALNOŚCI',news?'Najnowsze informacje o WoW: Forever znajdziesz na kanale Forever News.':'Kanał Forever News jest obecnie niedostępny.')],components:[...(news?[row(news)]:[]),back]};
  }
 }
 function peoplePage(requested){
  const records=new Map(db.prepare('SELECT user_id,game_nick,wow_class,wow_role FROM members WHERE left_at IS NULL').all().map(x=>[x.user_id,x]));
  const preferences=new Map(db.prepare('SELECT user_id,professions,specialization,specialization_class,specialization_character FROM member_preferences').all().map(x=>[x.user_id,x]));
  const intros=new Map(db.prepare('SELECT user_id,message_id,profile FROM member_introductions').all().map(x=>[x.user_id,x]));
  const players=[...guild.members.cache.values()].filter(m=>!m.user?.bot&&has(m)).sort((a,b)=>String(a.displayName||a.user.username).localeCompare(String(b.displayName||b.user.username),'pl'));
  const pages=Math.max(1,Math.ceil(players.length/3)),page=Math.min(Math.max(0,Number.isSafeInteger(requested)?requested:0),pages-1);
  const lines=players.slice(page*3,page*3+3).map(member=>{
   const record=records.get(member.id)||{},entry=intros.get(member.id);let intro={};
   try{const parsed=JSON.parse(entry?.profile||'{}');if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))intro=parsed;}catch(_){}
   const declared=json(preferences.get(member.id)?.professions).map(x=>PROFESSIONS[x]).filter(Boolean);
   const prof=[...new Set([text(intro.professions,150),declared.join(', ')].filter(Boolean))].join(' • ');
   const specialization=specializationFor(preferences.get(member.id),record);
   const character=text(intro.character||[record.game_nick,record.wow_class,record.wow_role].filter(Boolean).join(' • '),120)||'postać do uzupełnienia';
   const about=text(intro.about,420),play=text(intro.play,150);
   const source=entry?.message_id?`[Pełna wizytówka](https://discord.com/channels/${guild.id}/${ABOUT_CHANNEL}/${entry.message_id})`:'';
   return [`**${text(member.displayName||member.user.username,60)}** • <@${member.id}>`,`🎮 ${character}`,specialization?`⚔️ ${text(specialization,60)} (deklaracja gracza)`:'',prof?`🔨 ${prof}`:'🔨 Profesje nieuzupełnione',play?`🎯 ${play}`:'',about?`💬 ${about}`:'',source].filter(Boolean).join('\n');
  });
  const nav=[];if(page>0)nav.push(btn(`v2:people:${page-1}`,'⬅️ Poprzednia'));if(page+1<pages)nav.push(btn(`v2:people:${page+1}`,'Następna ➡️'));
  return {embeds:[card(`👥 LUDZIE I PROFESJE • ${page+1}/${pages}`,`${lines.join('\n\n')||'Brak dostępnych wizytówek.'}\n\nDane pochodzą z profili i dobrowolnych wizytówek. Lista postaci w grze może być szersza.`)],components:[...(nav.length?[row(...nav)]:[]),row(btn('v2:crafters','🔨 Szukaj fachowca'),btn('v2:guild','⬅️ Gildia'))]};
 }
 function crew({mode='ALL',pace='ALL'}={}){const filtered=roster().filter(p=>(mode==='ALL'||modes(p.interests).includes(mode))&&(pace==='ALL'||p.play_pace===pace));const people=filtered.filter(p=>p.ready_until>Date.now());const now=DateTime.now().setZone('Europe/Warsaw');const planned=filtered.filter(p=>isAvailableAt(p,now.weekday,now.hour*60+now.minute)&&p.ready_until<=Date.now());const filters=[row(new StringSelectMenuBuilder().setCustomId(`v2:crewmode:${pace}`).setPlaceholder('Kierunek gry').addOptions([{label:'Wszystkie kierunki',value:'ALL'},...Object.entries(MODES).map(([value,label])=>({value,label}))])),row(new StringSelectMenuBuilder().setCustomId(`v2:crewpace:${mode}`).setPlaceholder('Tempo gry').addOptions([{label:'Każde tempo',value:'ALL'},...Object.entries(PACES).map(([value,label])=>({value,label}))]))];return {embeds:[card('🧭 ZBIERAMY EKIPĘ',`Filtry: **${MODES[mode]||'wszystkie kierunki'}** • **${PACES[pace]||'każde tempo'}**\n\n**Zgłosili „Gram teraz”**\n${people.slice(0,20).map(p=>`🟢 **${name(p)}** • ${text(p.wow_role||'?')} / ${text(p.wow_class||'?')} • ${modes(p.interests).join('/')} • do <t:${Math.floor(p.ready_until/1000)}:t>`).join('\n')||'Brak zgłoszeń dla tych filtrów. Zmień filtr lub zgłoś gotowość.'}\n\n**W tym oknie zwykle grają**\n${planned.slice(0,10).map(p=>`${name(p)} • ${text(p.wow_role||'?')} — ${availability(p)}`).join('\n')||'Brak zgłoszonych okien na teraz.'}\n\nOkno jest deklaracją, nie potwierdzeniem obecności. Kierunki mogą się łączyć; tempo jest dobrowolne. Bez oddzielania gildii ścianami rang.`)],components:[...filters,row(btn('v2:ready','🟢 Przełącz moją gotowość'),btn('sc:lfg','⚔️ Otwarte wyprawy'),btn('v2:home','⬅️ Centrum gildii'))]};}
 async function handle(i){
  if(!i.customId?.startsWith('v2:'))return false;
  if(i.guildId&&i.guildId!==guild.id)return false;
  const action=i.customId.split(':')[1];
  if(['table','tablefilter'].includes(action)){
   if(i.guildId!==guild.id){await i.reply({content:'Tabele są dostępne na serwerze gildii.',flags:MessageFlags.Ephemeral});return true;}
   const privateView=Boolean(i.message?.flags?.has?.(MessageFlags.Ephemeral));
   if(privateView)await i.deferUpdate();else await i.deferReply({flags:MessageFlags.Ephemeral});
   const respond=p=>i.editReply({...p,allowedMentions:{parse:[]}});
   const member=await guild.members.fetch({user:i.user.id,force:true}).catch(()=>null);
   if(!member||member.user?.bot||!has(member)){await respond({content:'Tabele są dostępne dla zatwierdzonych członków gildii.',embeds:[],components:[]});return true;}
   const parts=i.customId.split(':'),view=parts[2];
   const page=action==='tablefilter'?0:Number(parts[3]);
   const filter=action==='tablefilter'?i.values?.[0]:parts[4];
   if(!['roster','raids','dungeons','professions'].includes(view)||!Number.isSafeInteger(page)||page<0||typeof filter!=='string'||filter.length>50){await respond({content:'Ten widok jest nieaktualny. Otwórz tabele ponownie ze stanu gildii.',embeds:[],components:[]});return true;}
   try{
    const tables=require('./guild-tables.cjs').createGuildTables({db,guild,professions:PROFESSIONS});
    await respond({...tables.render({view,page,filter}),content:''});
   }catch(e){console.error('[guild-tables]',e.code||e.name);await respond({content:'Nie udało się odczytać tabel. Spróbuj ponownie za chwilę.',embeds:[],components:[]});}
   return true;
  }
  const member=['specialization','savespecialization'].includes(action)?await guild.members.fetch({user:i.user.id,force:true}):(i.member?.roles?.cache?i.member:await guild.members.fetch(i.user.id));
  if(!has(member)){await i.reply({content:'Najpierw dołącz przez #start. ',flags:MessageFlags.Ephemeral});return true;}
  if(action==='addpromotion'){await i.showModal(promotions.modal());return true;}
  if(action==='specialization'){
   const record=db.prepare('SELECT game_nick,wow_class FROM members WHERE user_id=? AND left_at IS NULL').get(i.user.id);
   if(!record?.game_nick||!record?.wow_class){await i.reply({content:'Najpierw uzupełnij nick i klasę w swoim profilu.',flags:MessageFlags.Ephemeral});return true;}
   const current=specializationFor(prefs(i.user.id),record);
   const input=new TextInputBuilder().setCustomId('specialization').setLabel('Specjalizacja (puste pole usuwa deklarację)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(60).setPlaceholder('np. Enhancement / Restoration');
   if(current)input.setValue(current);
   await i.showModal(new ModalBuilder().setCustomId('v2:savespecialization').setTitle('Twoja specjalizacja • deklaracja').addComponents(row(input)));return true;
  }
  if(action==='availability'){
   const p=prefs(i.user.id);const modal=new ModalBuilder().setCustomId('v2:saveavailability').setTitle('Kiedy zwykle grasz? (czas PL)');
   for(const [id,label,value,placeholder,max] of [['days','Dni rozpoczęcia: pon wt śr czw pt sob nd',json(p?.play_days).map(d=>DAYS[d-1]).join(' '),'pt sob nd',30],['start','Od (HH:MM)',p?.play_start!=null?clock(p.play_start):'','20:00',5],['end','Do (HH:MM)',p?.play_end!=null?clock(p.play_end):'','23:00',5],['note','Dodatkowa informacja (opcjonalnie)',p?.play_note||'','np. questy, luźno, bez pośpiechu',150]]){const input=new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(TextInputStyle.Short).setRequired(id!=='note').setMaxLength(max).setPlaceholder(placeholder);if(value)input.setValue(value);modal.addComponents(row(input));}
   await i.showModal(modal);return true;
  }
  await i.deferReply({flags:MessageFlags.Ephemeral});const reply=p=>i.editReply(typeof p==='string'?{content:p,allowedMentions:{parse:[]}}:{...p,allowedMentions:{parse:[]}});
  if(action==='savespecialization'){
   let specialization;
   try{specialization=parseSpecialization(i.fields.getTextInputValue('specialization'));}catch(e){await reply(e.message);return true;}
   const record=db.prepare('SELECT game_nick,wow_class FROM members WHERE user_id=? AND left_at IS NULL').get(i.user.id);
   if(specialization&&(!record?.game_nick||!record?.wow_class)){await reply('Najpierw uzupełnij nick i klasę w swoim profilu.');return true;}
   ensure(i.user.id);const stamp=Date.now();
   db.prepare('UPDATE member_preferences SET specialization=?,specialization_class=?,specialization_character=?,specialization_updated_at=?,updated_at=? WHERE user_id=?').run(specialization||null,specialization?record.wow_class:null,specialization?record.game_nick:null,stamp,stamp,i.user.id);
   let pending=false;try{await refreshGuildState();}catch{pending=true;}
   await reply({content:(specialization?`Zapisano: **${text(specialization,60)}** dla ${text(record.game_nick,60)} (${text(record.wow_class,40)}). To Twoja deklaracja.`:'Deklaracja specjalizacji została usunięta.')+(pending?' Karta stanu gildii czeka na odświeżenie.':''),components:[row(btn('v2:profile','⬅️ Mój profil'))]});return true;
  }
  if(action==='home'){await reply({embeds:[dashboard(member)],components:rows(member)});return true;}
  if(action==='promotions'){
   const channel=link(promotions.CHANNEL,'Otwórz materiały');
   await reply({embeds:[card('📣 MATERIAŁY PROMOCYJNE','Dodaj gotowy tekst, który pozostali członkowie będą mogli skopiować. Po zatwierdzeniu pojawi się na kanale materiałów.')],components:[row(btn('v2:addpromotion','Dodaj materiał',ButtonStyle.Primary),...(channel?[channel]:[])),row(btn('v2:home','⬅️ Centrum gildii'))]});return true;
  }
  if(action==='publishpromotion'){
   const result=await promotions.publish({guild,getChannel,interaction:i});
   await reply(result.ok?{content:'Materiał został opublikowany.',components:[row(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Otwórz materiał').setURL(result.url)),row(btn('v2:promotions','⬅️ Materiały'))]}:result.error);return true;
  }
  if(['profile','group','guild','news','addon','classes'].includes(action)){await reply(section(action,member));return true;}
  if(action==='people'){const page=Number(i.customId.split(':')[2]);await reply(peoplePage(page));return true;}
  if(action==='milestones'&&milestones){const payload=milestones.overview();await reply({...payload,components:[...(payload.components||[]),row(btn('v2:home','⬅️ Centrum gildii'))]});return true;}
  if(action==='ready'){ensure(i.user.id);const on=(prefs(i.user.id)?.ready_until||0)<=Date.now();db.prepare('UPDATE member_preferences SET ready_until=?,updated_at=? WHERE user_id=?').run(on?Date.now()+2*3600000:0,Date.now(),i.user.id);await reply({embeds:[dashboard(member)],components:rows(member)});return true;}
  if(action==='crew'){await reply(crew());return true;}
  if(action==='crewmode'||action==='crewpace'){const selected=i.values?.[0],other=i.customId.split(':')[2];const mode=action==='crewmode'?selected:other,pace=action==='crewpace'?selected:other;if((mode!=='ALL'&&!Object.hasOwn(MODES,mode))||(pace!=='ALL'&&!Object.hasOwn(PACES,pace))){await reply('Nieprawidłowy filtr. Otwórz Kto gra?');return true;}await reply(crew({mode,pace}));return true;}
  if(action==='saveavailability'){try{const a=parseAvailability(...['days','start','end','note'].map(k=>i.fields.getTextInputValue(k)));ensure(i.user.id);db.prepare('UPDATE member_preferences SET play_days=?,play_start=?,play_end=?,play_note=?,updated_at=? WHERE user_id=?').run(JSON.stringify(a.days),a.start,a.end,a.note,Date.now(),i.user.id);await reply({content:`Zapisano: ${availability(prefs(i.user.id))}`,components:[row(btn('v2:clearavailability','Wyczyść dostępność'),btn('v2:home','⬅️ Centrum gildii'))]});}catch(e){await reply(e.message);}return true;}
  if(action==='clearavailability'){ensure(i.user.id);db.prepare("UPDATE member_preferences SET play_days='[]',play_start=NULL,play_end=NULL,play_note='',ready_until=0,updated_at=? WHERE user_id=?").run(Date.now(),i.user.id);await reply('Dostępność i gotowość wyczyszczone.');return true;}
  if(['professions','crafters'].includes(action)){const chosen=json(prefs(i.user.id)?.professions);await reply({embeds:[card(action==='professions'?'🔨 WARSZTAT GILDII':'🧰 ZNAJDŹ FACHOWCA',action==='professions'?'Wybierz do 2 profesji głównych i do 3 dodatkowych. To deklaracja gracza; receptur i poziomu nie weryfikujemy.':'Wybierz profesję — pokażę członków, którzy ją zadeklarowali. Zlecenie uzgodnij bezpośrednio z graczem.')],components:[row(new StringSelectMenuBuilder().setCustomId(action==='professions'?'v2:saveprofessions':'v2:findprofession').setPlaceholder('Wybierz profesję').setMinValues(1).setMaxValues(action==='professions'?5:1).addOptions(Object.entries(PROFESSIONS).map(([value,label])=>({value,label,default:action==='professions'&&chosen.includes(value)})))),row(btn('v2:clearprofessions','Wyczyść moje profesje'),btn('v2:home','⬅️ Centrum gildii'))]});return true;}
  if(action==='saveprofessions'){const values=[...new Set(i.values)];if(values.some(v=>!PROFESSIONS[v])||values.filter(v=>!SECONDARY.includes(v)).length>2){await reply('Wybierz maksymalnie 2 profesje główne. Gotowanie, Wędkarstwo i Pierwsza pomoc są dodatkowe.');return true;}ensure(i.user.id);db.prepare('UPDATE member_preferences SET professions=?,updated_at=? WHERE user_id=?').run(JSON.stringify(values),Date.now(),i.user.id);await reply({content:`Zapisano: ${values.map(v=>PROFESSIONS[v]).join(', ')}`,components:[row(btn('v2:home','⬅️ Centrum gildii'))]});return true;}
  if(action==='clearprofessions'){ensure(i.user.id);db.prepare("UPDATE member_preferences SET professions='[]',updated_at=? WHERE user_id=?").run(Date.now(),i.user.id);await reply('Profesje wyczyszczone.');return true;}
  if(action==='findprofession'){const key=i.values[0];if(!PROFESSIONS[key]){await reply('Nieprawidłowa profesja.');return true;}const people=roster().filter(p=>json(p.professions).includes(key));await reply({embeds:[card(`🧰 ${PROFESSIONS[key]}`,people.slice(0,25).map(p=>`**${name(p)}** • <@${p.user_id}>${p.ready_until>Date.now()?' • 🟢 zgłosił gotowość':''}`).join('\n')||'Jeszcze nikt nie dodał tej profesji. Dodaj swoją w centrum gildii.')],components:[row(btn('v2:crafters','Inna profesja'),btn('v2:home','⬅️ Centrum gildii'))]});return true;}
  await reply('Ta opcja wygasła. Otwórz /bot.');return true;
 }
 return {handle,dashboard,rows,crew,ready,roster};
}
module.exports={createGuildHub,schema,PROFESSIONS,parseAvailability,isAvailableAt,parseSpecialization,specializationFor};
