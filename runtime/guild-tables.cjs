'use strict';
const {EmbedBuilder,ActionRowBuilder,ButtonBuilder,ButtonStyle,StringSelectMenuBuilder}=require('discord.js');
const {readRoster,declarations,CLASSES}=require('./guild-composition.cjs');
const {has,json,roleKind}=require('./guild-core');
const {modes}=require('./guild-identity');
const VIEWS={roster:'Skład',raids:'Rajdy',dungeons:'Dungeony / PvE',professions:'Profesje'};
const ROLES={TANK:'Tank',HEAL:'Heal',DPS:'DPS'};
const PAGE_SIZE=8;
const clean=(value,max=120)=>Array.from(String(value??'').replace(/[\x00-\x1f\x7f`@<>|*_~\\]/g,' ').replace(/\s+/g,' ').trim()).slice(0,max).join('');
const key=value=>String(value||'').normalize('NFKC').trim().toLocaleLowerCase('en-US');
const fit=(value,width)=>{const chars=Array.from(clean(value,100));return (chars.length>width?chars.slice(0,width-1).join('')+'…':chars.join('')).padEnd(width,' ')};
const exists=(db,name)=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
const row=(...items)=>new ActionRowBuilder().addComponents(...items);
const button=(id,label,active=false)=>new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(active?ButtonStyle.Primary:ButtonStyle.Secondary);
function createGuildTables({db,guild,professions={}}){
 const catalog=Object.fromEntries(Object.entries(professions).filter(([id,label])=>/^[A-Za-z]{1,30}$/.test(id)&&typeof label==='string').map(([id,label])=>[id,clean(label,50)]));
 const labels=new Map(CLASSES.map(([id,label])=>[id,label]));
 function data(){
  const roster=readRoster(db);
  const records=db.prepare('SELECT user_id,game_nick,wow_class,wow_role,interests FROM members WHERE left_at IS NULL').all().filter(record=>{
   const member=guild.members.cache.get(record.user_id);return member&&!member.user?.bot&&has(member);
  });
  const declared=declarations(db,records),byId=new Map(declared.map(r=>[String(r.user_id),r])),byName=new Map();
  for(const r of declared){const name=key(r.game_nick);if(name)byName.set(name,byName.has(name)?null:r)}
  const prefs=new Map(exists(db,'member_preferences')?db.prepare('SELECT user_id,professions FROM member_preferences').all().map(r=>[r.user_id,r]):[]);
  const intros=new Map(exists(db,'member_introductions')?db.prepare('SELECT user_id,profile FROM member_introductions').all().map(r=>[r.user_id,r]):[]);
  const person=character=>{
   const record=character.discord_id?byId.get(String(character.discord_id)):byName.get(key(character.name));
   return record&&key(record.game_nick)===key(character.name)&&key(record.wow_class)===key(character.wow_class)?record:null;
  };
  const spec=(r,name,klass)=>{
   const p=r?.specialization;
   return p&&Number.isSafeInteger(p.specialization_updated_at)&&key(p.specialization_character)===key(name)&&key(p.specialization_class)===key(klass)?clean(p.specialization,60):'';
  };
  const characters=roster.rows.map(c=>{const r=person(c);return {name:clean(c.name,60)||'Nieznana postać',klass:c.wow_class,level:Number.isInteger(c.level)?c.level:null,record:r,role:roleKind(r?.wow_role),spec:spec(r,c.name,c.wow_class)}});
  const crafters=declared.map(r=>{
   const chosen=json(prefs.get(r.user_id)?.professions).filter(p=>Object.hasOwn(catalog,p));let intro={};try{const v=JSON.parse(intros.get(r.user_id)?.profile||'{}');if(v&&typeof v==='object'&&!Array.isArray(v))intro=v}catch{}
   const publicText=clean(intro.professions,160),names=chosen.map(p=>catalog[p]);
   const found=new Set(chosen); // Free-form text may negate a profession; never classify it.
   const sources=[];if(names.length)sources.push('profil');if(publicText)sources.push('tekst publicznej wizytówki');
   const matched=characters.find(c=>c.record?.user_id===r.user_id),member=guild.members.cache.get(r.user_id);
   if(!matched)sources.unshift('profil Discord / postać niepowiązana');
   return {name:matched?matched.name:(clean(member?.displayName||member?.user?.username,60)||'Użytkownik Discord'),klass:matched?.klass,profession:[...new Set([...names,...(publicText?[publicText]:[])])].join(' · '),professionIds:found,source:sources.join(' + '),userId:r.user_id};
  }).filter(r=>r.profession);
  return {roster,characters,crafters};
 }
 function render({view='roster',page=0,filter='ALL'}={}){
  if(!Object.hasOwn(VIEWS,view))view='roster';
  const state=data();let items,options,description,heading;
  if(view==='roster'){
   options=[{label:'Wszystkie klasy',value:'ALL'},...CLASSES.map(([value,label])=>({label,value}))];
   if(!options.some(x=>x.value===filter))filter='ALL';
   items=state.characters.filter(x=>filter==='ALL'||x.klass===filter);
   heading=['#','Postać','Klasa','Lvl'];
   description='Ostatni odczyt rosteru gry; obejmuje alty. Role i specjalizacje są deklaracjami, nie pomiarem talentów.';
  }else if(view==='raids'||view==='dungeons'){
   options=[{label:'Wszystkie role',value:'ALL'},...Object.entries(ROLES).map(([value,label])=>({label,value})),{label:'Rola niepodana',value:'UNKNOWN'}];
   if(!options.some(x=>x.value===filter))filter='ALL';
   items=state.characters.filter(x=>x.record&&modes(x.record.interests).includes(view==='raids'?'RAIDY':'PVE')).filter(x=>filter==='ALL'||(filter==='UNKNOWN'?!x.role:x.role===filter));
   heading=['#','Postać','Klasa','Rola'];
   description=view==='raids'?'Postacie z dokładnie dopasowanym profilem i wybranym kierunkiem RAIDY. To zainteresowanie rajdami, nie lista zapisanych na konkretny raid.':'Postacie z dokładnie dopasowanym profilem i wybranym PvE (questy i dungeony). Deklaracja nie potwierdza gotowości ani konkretnego zapisu.';
  }else{
   options=[{label:'Wszystkie profesje',value:'ALL'},...Object.entries(catalog).slice(0,24).map(([value,label])=>({label,value}))];
   if(!options.some(x=>x.value===filter))filter='ALL';
   items=state.crafters.filter(x=>filter==='ALL'||x.professionIds.has(filter));
   heading=['#','Postać','Profesje'];
   description='Dobrowolne profile i publiczne wizytówki aktywnych członków Discorda. Niepowiązane postacie pokazujemy jako profile Discorda. Poziomy i receptury wymagają potwierdzenia; dane profesji z klienta gry nie są jeszcze przesyłane do bota.';
  }
  items.sort((a,b)=>a.name.localeCompare(b.name,'pl')||String(a.klass||'').localeCompare(String(b.klass||''))||String(a.userId||'').localeCompare(String(b.userId||'')));
  const pages=Math.max(1,Math.ceil(items.length/PAGE_SIZE));page=Math.min(pages-1,Math.max(0,Number.isSafeInteger(page)?page:0));const shown=items.slice(page*PAGE_SIZE,page*PAGE_SIZE+PAGE_SIZE);
  const lines=[],details=[];
  if(view==='professions'){
   lines.push(`${fit('#',3)} ${fit(heading[1],16)} ${fit(heading[2],15)}`,'─'.repeat(36));
   shown.forEach((p,i)=>{const n=page*PAGE_SIZE+i+1;lines.push(`${fit(n,3)} ${fit(p.name,16)} ${fit(p.profession,15)}`);details.push(`**${n}.** ${Array.from(p.name).length>16?clean(p.name,60)+' · ':''}${clean(p.profession,160)} · źródło: ${p.source}`)});
  }else{
   lines.push(`${fit('#',3)} ${fit(heading[1],17)} ${fit(heading[2],8)} ${fit(heading[3],5)}`,'─'.repeat(36));
   shown.forEach((p,i)=>{const n=page*PAGE_SIZE+i+1;lines.push(`${fit(n,3)} ${fit(p.name,17)} ${fit(labels.get(p.klass)||'?',8)} ${fit(view==='roster'?(p.level??'—'):(ROLES[p.role]||'—'),5)}`);if(p.spec||p.role||Array.from(p.name).length>17)details.push(`**${n}.** ${Array.from(p.name).length>17?clean(p.name,60)+' · ':''}${p.role?ROLES[p.role]:'rola —'} · spec: ${p.spec||'brak deklaracji'}`)});
  }
  const freshness=state.roster.observedAt?`${state.roster.current?'Odczyt gry':'Historyczne dane; czekamy na pełny odczyt'}: <t:${state.roster.observedAt}:f>.`:'Brak odczytu gry.';
  const body=description+'\n\n'+(shown.length?'```text\n'+lines.join('\n')+'\n```':'Brak pasujących danych. Uzupełnij profil lub zmień filtr.')+(details.length?'\n'+details.join('\n'):'')+`\n\n${freshness}\n**${items.length}** wyników · strona **${page+1}/${pages}**. „—” oznacza brak danych.`;
  const embed=new EmbedBuilder().setColor(0xA8202A).setTitle('THE SENTENCED · '+VIEWS[view]).setDescription(body.slice(0,4096)).setFooter({text:'Tabele gildii · role i profesje są deklarowane przez graczy'});
  if(view==='raids'){
   const raid=exists(db,'raids')?db.prepare("SELECT id,name,scheduled_ts,status FROM raids WHERE scheduled_ts>? AND status IN ('ACTIVE','CLOSED') ORDER BY scheduled_ts,id LIMIT 1").get(Math.floor(Date.now()/1000)):null;
   let value='Brak przyszłego rajdu w kalendarzu.';
   if(raid){
    const counts={YES:0,MAYBE:0,NO:0};
    if(exists(db,'raid_signups'))for(const r of db.prepare('SELECT status,COUNT(*) AS n FROM raid_signups WHERE raid_id=? GROUP BY status').all(raid.id))if(Object.hasOwn(counts,r.status))counts[r.status]=r.n;
    value=`**${clean(raid.name,90)||'Rajd'}** · <t:${raid.scheduled_ts}:f>\nBędę: **${counts.YES}** · Może: **${counts.MAYBE}** · Nie: **${counts.NO}**\n${raid.status==='ACTIVE'?'Zapisy otwarte':'Zapisy zamknięte'}. To zapisy na ten rajd, niezależne od tabeli kierunków gry.`;
   }
   embed.addFields({name:'Najbliższy rajd · rzeczywiste zapisy',value,inline:false});
  }
  if(view==='dungeons'){
   let count=0;
   if(exists(db,'expeditions')){
    const columns=new Set(db.prepare('PRAGMA table_info(expeditions)').all().map(c=>c.name));
    const mode=columns.has('mode')?" AND mode='DUNGEON'":'';
    count=db.prepare("SELECT COUNT(*) AS n FROM expeditions WHERE status='OPEN' AND expires_at>?"+mode).get(Date.now()).n;
   }
   embed.addFields({name:'Otwarte wyprawy dungeon',value:`**${count}** niewygasłych wypraw. Aktualne miejsca i konkretne zapisy sprawdzisz w **Wyprawach**. Tabela powyżej pokazuje deklarowane PvE.`,inline:false});
  }
  const tabs=row(...Object.entries(VIEWS).map(([id,label])=>button(`v2:table:${id}:0:ALL`,label,id===view)));
  const select=new StringSelectMenuBuilder().setCustomId(`v2:tablefilter:${view}`).setPlaceholder(view==='roster'?'Filtr klasy':view==='professions'?'Filtr profesji':'Filtr roli').setMinValues(1).setMaxValues(1).addOptions(options.map(o=>({...o,default:o.value===filter})));
  const previous=button(`v2:table:${view}:${Math.max(0,page-1)}:${filter}:prev`,'← Poprzednia').setDisabled(page===0);
  const next=button(`v2:table:${view}:${Math.min(pages-1,page+1)}:${filter}:next`,'Następna →').setDisabled(page===pages-1);
  return {embeds:[embed],components:[tabs,row(select),row(previous,next)],allowedMentions:{parse:[]}};
 }
 return {render};
}
module.exports={createGuildTables};
