'use strict';
const {version:SYSTEM_VERSION}=require('./system-version.json');
const {EmbedBuilder,ActionRowBuilder,ButtonBuilder,ButtonStyle,StringSelectMenuBuilder,MessageFlags}=require('discord.js');
const {has,text,json,missingProfileFields}=require('./guild-core');
const MODES=Object.freeze({PVE:'PvE / questy i dungeony',PVP:'PvP / pola bitew',RAIDY:'Raidy / wspólny progres',RP:'RP / klimat i opowieści'});
const PACES=Object.freeze({PROGRESS:'Progres / zaangażowany (hardcore)',REGULAR:'Regularnie / swoim rytmem',CASUAL:'Casual / luźne granie'});
function modes(value){return [...new Set(json(value,String(value||'').split(',')).map(v=>String(v).trim().toUpperCase()).filter(v=>Object.hasOwn(MODES,v)))];}
const row=(...components)=>new ActionRowBuilder().addComponents(...components);
const button=(id,label)=>new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(ButtonStyle.Secondary);
function createGuildIdentity({db,guild,getChannel=()=>null,refreshGuildState=async()=>{}}){
 db.exec("CREATE TABLE IF NOT EXISTS member_preferences(user_id TEXT PRIMARY KEY,ready_until INTEGER NOT NULL DEFAULT 0,play_days TEXT NOT NULL DEFAULT '[]',play_start INTEGER,play_end INTEGER,play_note TEXT NOT NULL DEFAULT '',professions TEXT NOT NULL DEFAULT '[]',updated_at INTEGER NOT NULL)");
 if(!db.prepare('PRAGMA table_info(member_preferences)').all().some(c=>c.name==='play_pace'))db.exec("ALTER TABLE member_preferences ADD COLUMN play_pace TEXT NOT NULL DEFAULT ''");
 const record=id=>db.prepare('SELECT * FROM members WHERE user_id=? AND left_at IS NULL').get(id);
 const prefs=id=>db.prepare('SELECT * FROM member_preferences WHERE user_id=?').get(id);
 function badgeSummary(id){const r=record(id);if(!r)return 'Brak aktywnego profilu gildii.';const p=prefs(id);const badges=[];if(!missingProfileFields(r).length)badges.push('📋 Profil kompletny');if(json(p?.professions).length)badges.push('🔨 Profesje zadeklarowane');return badges.join('\n')||'Uzupełnij profil i opcjonalne deklaracje — tu pojawią się ich oznaczenia.';}
 const card=(title,description)=>new EmbedBuilder().setColor(0xA8202A).setTitle(title).setDescription(description.slice(0,4000)).setFooter({text:'THE SENTENCED • HORDA • v'+SYSTEM_VERSION+' • dobrowolne deklaracje'});
 function overview(member){const r=record(member.id);const p=prefs(member.id);return {embeds:[card('⚔️ TWÓJ SZTANDAR W THE SENTENCED',`**${text(r?.game_nick||r?.display_name||'Gracz',80)}**\n\n**Kierunki gry**\n${modes(r?.interests).map(v=>MODES[v]).join(' • ')||'Jeszcze nie wybrane'}\n**Tempo**\n${Object.hasOwn(PACES,p?.play_pace)?PACES[p.play_pace]:'Nie ustawiono — wybierz swój rytm'}\n\n**Oznaczenia profilu**\n${badgeSummary(member.id)}\n\nKażdy styl jest mile widziany. PvE, PvP i RP mogą się łączyć; tempo nie przyznaje rang ani dostępu. „Hardcore” oznacza tu zaangażowany progres, **nie tryb permanentnej śmierci**. ${p?.ready_until>Date.now()?'🟢 Masz aktywne zgłoszenie „Gram teraz”.':''}`)],components:[row(button('identity:styles','🧭 Kierunki gry'),button('identity:pace','🔥 Tempo gry'),button('identity:badges','🏅 Moje oznaczenia'),button('identity:help','📖 Jak korzystać?')),row(button('v2:home','⬅️ Centrum gildii'))],allowedMentions:{parse:[]}};}
 const back=()=>[row(button('identity:home','⬅️ Mój sztandar'),button('v2:home','Centrum gildii'))];
 async function handle(i){
  if(!i.customId?.startsWith('identity:'))return false;
  await i.deferReply({flags:MessageFlags.Ephemeral});
  const reply=p=>i.editReply(typeof p==='string'?{content:p,components:back(),allowedMentions:{parse:[]}}:{...p,allowedMentions:{parse:[]}});
  if(i.guildId!==guild.id){await reply('Ta opcja działa tylko na serwerze THE SENTENCED.');return true;}
  const member=guild.members.cache.get(i.user.id)||await guild.members.fetch(i.user.id).catch(()=>null);
  if(!member||member.user?.bot||!has(member)||!record(i.user.id)){await reply('Potrzebujesz aktywnego profilu i rangi gracza. Zacznij w #start.');return true;}
  const action=i.customId.split(':')[1];
  if(action==='styles'){
   try {
    const prepared=await require('./profile-discord.cjs').prepareClassEdit({db,guild,userId:i.user.id});
    if(prepared.error){await reply(prepared.error);return true;}
    if(!record(i.user.id)){await reply('Brak aktywnego profilu gildii.');return true;}
    const chosen=modes(record(i.user.id).interests),rev=prepared.revision;
    await reply({embeds:[card('🧭 KIERUNKI GRY','Wybierz wszystko, co Cię interesuje. To ten sam styl gry, który widzisz w profilu i onboardingu — bez drugiej kopii danych.')],components:[row(new StringSelectMenuBuilder().setCustomId('identity:savestyles:'+rev).setPlaceholder('PvE, PvP, raidy, RP — można łączyć').setMinValues(1).setMaxValues(4).addOptions(Object.entries(MODES).map(([value,label])=>({value,label,default:chosen.includes(value)})))),row(button('identity:clearstyles:'+rev,'Wyczyść kierunki'),button('identity:home','⬅️ Mój sztandar'))]});
   }catch(e){console.error('[identity] styles menu failed:',e.message);await reply('Nie udało się otworzyć edycji. Spróbuj ponownie.');}
   return true;
  }
  if(action==='pace'){const p=prefs(i.user.id);await reply({embeds:[card('🔥 TEMPO GRY','Progres, regularne granie i casual są równorzędne. Wybór nie przyznaje uprawnień, rang ani potwierdzonego doświadczenia.')],components:[row(new StringSelectMenuBuilder().setCustomId('identity:savepace').setPlaceholder('Wybierz swój rytm').setMinValues(1).setMaxValues(1).addOptions(Object.entries(PACES).map(([value,label])=>({value,label,default:p?.play_pace===value})))),row(button('identity:clearpace','Wyczyść tempo'),button('identity:home','⬅️ Mój sztandar'))]});return true;}
  if(['savestyles','clearstyles'].includes(action)){
   const values=[...new Set(i.values||[])],revision=i.customId.split(':')[2]||'';let result;
   try {result=await require('./profile-discord.cjs').saveProfileEdit({db,guild,userId:i.user.id,revision,field:'interests',value:action==='clearstyles'?[]:values,allowClear:action==='clearstyles',requireActive:true});}
   catch(e){console.error('[identity] styles save not confirmed:',e.message);await reply('Nie udało się potwierdzić zapisu. Sprawdź profil przed ponowieniem.');return true;}
   if(result.error){await reply(result.error);return true;}
   let notice='';try{await refreshGuildState();}catch(e){console.error('[identity] state refresh failed:',e.message);notice='✅ Kierunki zapisano, ale nie udało się odświeżyć widoku gildii.';}
   try{const result=overview(member);if(notice)result.content=notice;await reply(result);}catch(e){console.error('[identity] styles render failed:',e.message);await i.editReply({content:'✅ Kierunki zapisano, ale nie udało się wyświetlić profilu.',allowedMentions:{parse:[]}});}
   return true;
  }
  if(['savepace','clearpace'].includes(action)){
   const values=[...new Set(i.values||[])];
   if(action==='savepace'&&(values.length!==1||!Object.hasOwn(PACES,values[0]))){await reply('Nieprawidłowy wybór. Otwórz ponownie tę sekcję.');return true;}
   db.transaction(()=>{db.prepare('INSERT OR IGNORE INTO member_preferences(user_id,updated_at) VALUES(?,?)').run(i.user.id,Date.now());db.prepare('UPDATE member_preferences SET play_pace=?,updated_at=? WHERE user_id=?').run(action==='clearpace'?'':values[0],Date.now(),i.user.id);})();
   await reply(overview(member));await Promise.resolve().then(()=>refreshGuildState()).catch(e=>console.error('[identity] state refresh failed:',e.message));return true;
  }
  if(action==='badges'){await reply({embeds:[card('🏅 OZNACZENIA — BEZ FARMY XP',`${badgeSummary(i.user.id)}\n\nOznaczenia pokazują kompletność profilu i zadeklarowane profesje.`)],components:back()});return true;}
  if(action==='help'){const links=[['start','Start / dołączenie'],['wyprawy','Wyprawy / dungeon'],['stan-gildii','Skład gildii']].map(([name,label])=>{const c=getChannel(guild,name);return c?new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(label).setURL(`https://discord.com/channels/${guild.id}/${c.id}`):null;}).filter(Boolean);await reply({embeds:[card('📖 JEDNA GILDIA, RÓŻNE STYLE','**/bot** jest centrum dowodzenia.\n1. Uzupełnij profil — nick, klasa, funkcja, kierunki.\n2. Wybierz tempo, dostępność i opcjonalnie profesje.\n3. Gdy faktycznie grasz, włącz „Gram teraz” (2 godziny).\n4. Zbierz dungeon lub zapisz się na przyszły raid.\n\nPvE, PvP, casual i RP nie tworzą osobnych rang ani zamkniętych klik. Szczegóły wydarzenia uzgadniajcie w ekipie. Horda i WoW Forever — bez udawania integracji z Retail.')],components:[...(links.length?[row(...links)]:[]),...back()]});return true;}
  if(action==='home'){await reply(overview(member));return true;}await reply('Ta opcja wygasła. Wróć do /bot.');return true;
 }
 return {handle,overview,badgeSummary};
}
module.exports={createGuildIdentity,MODES,PACES,modes};
