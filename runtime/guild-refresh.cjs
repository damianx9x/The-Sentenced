'use strict';

const {randomBytes} = require('node:crypto');
const {ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags,
    ModalBuilder, TextInputBuilder, TextInputStyle} = require('discord.js');
const {has, missingProfileFields, roleKind, text} = require('./guild-core');
const {version} = require('./system-version.json');

const ABOUT_CHANNEL = '1573062971100364942';
const SITE = 'https://thesentenced.pl/';
const GAME = Object.freeze({
    build: '1.60.1.70959',
    hotfix: '19 listopada 2026',
    notes: 'https://worldofwarcraft.blizzard.com/en-us/news/24315281/wow-forever-hotfixes-november-10-2026',
    summary: 'Poprawki m.in. dla paladyna Retribution, City of Dalaran, Shaper’s Terrace i Skyborne.',
});
const noMentions = {parse: []};
const row = (...components) => new ActionRowBuilder().addComponents(...components);
const action = (id, label, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
const link = (url,label) => new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(label).setURL(url);
const statusComponents=()=>[row(...[['roster','Skład'],['raids','Rajdy'],['dungeons','Dungeony'],['professions','Profesje']].map(([view,label])=>action(`v2:table:${view}:0:ALL`,label,view==='roster'?ButtonStyle.Primary:ButtonStyle.Secondary)))];

function statusEmbeds(db,guild,now=Math.floor(Date.now()/1000)) {
    const players = [...guild.members.cache.values()].filter(m=>!m.user.bot && has(m));
    const ids = new Set(players.map(m=>m.id));
    const records = db.prepare('SELECT user_id,game_nick,wow_class,wow_role,interests FROM members WHERE left_at IS NULL').all()
        .filter(m=>ids.has(m.user_id));
    const ready = records.filter(m=>!missingProfileFields(m).length).length;
    const raid = db.prepare("SELECT name,scheduled_ts,status FROM raids WHERE scheduled_ts>? AND status IN ('ACTIVE','CLOSED') ORDER BY scheduled_ts LIMIT 1").get(now);
    const {readRoster,declarations,composition}=require('./guild-composition.cjs');
    const roster=readRoster(db), game=composition(roster,declarations(db,records));
    const source=roster.observedAt?`<t:${roster.observedAt}:f> · <t:${roster.observedAt}:R>`:'brak odczytu';
    const classText=game.classes.map(c=>`${c.emoji} ${c.label}: **${c.count}**`).join('\n')+(game.unknownClass?`\nNieznana klasa: **${game.unknownClass}**`:'');
    const classesByName=new Map(game.classes.map(c=>[c.name,c.label]));
    const specText=game.specs.map(s=>`${classesByName.get(s.klass)||s.klass} · ${text(s.name,60)}: **${s.count}**`).join('\n');
    const levels=[['1–19',1,19],['20–39',20,39],['40–49',40,49],['50–59',50,59],['60+',60,1000]].map(([label,min,max])=>`${label}: **${roster.rows.filter(r=>Number.isInteger(r.level)&&r.level>=min&&r.level<=max).length}**`).join(' · ');
    const headline=roster.current?`**${game.total} postacie w gildii w WoW**`:'**Czekamy na aktualny odczyt rosteru z gry**';
    const result=new EmbedBuilder().setColor(0x9e2a2b)
        .setTitle('The Sentenced · Stan gildii')
        .setURL(SITE)
        .setDescription(headline+`\n${roster.current?'Stan z gry':'Ostatnie zapisane dane'}: ${source}\nLiczba postaci obejmuje także alty.`)
        .addFields(
            {name:'Klasy · '+game.total+' postaci',value:game.total?classText:'Brak danych klas z gry.',inline:true},
            {name:'Role zadeklarowane dla postaci',value:`🛡️ Tank: **${game.roles.TANK}**\n💚 Heal: **${game.roles.HEAL}**\n⚔️ DPS: **${game.roles.DPS}**\nBez deklaracji: **${game.roleUnknown}**\nRole podane przez graczy; znane dla ${game.roleKnown}/${game.total} postaci.`,inline:true},
            {name:`Specjalizacje · ${game.specKnown}/${game.total} podanych`,value:(specText?specText.slice(0,700)+'\n':'')+`Bez deklaracji: **${game.specUnknown}**.\nDodaj lub zmień: **/bot → Mój profil → Specjalizacja**. Klasa nie wyznacza specjalizacji.`,inline:false},
            {name:'Poziomy postaci',value:game.total?levels:'Brak danych poziomów.',inline:false},
            {name:'Społeczność na Discordzie',value:`**${players.length}** kont z dostępem · **${ready}/${players.length}** uzupełnionych profili\nDiscord i roster WoW to różne liczniki.\n👥 **/bot → Gildia → Ludzie i profesje**`,inline:false},
            {name:'Najbliższy rajd',value:raid?`**${text(raid.name,90)}**\n<t:${raid.scheduled_ts}:f>\n${raid.status==='ACTIVE'?'Zapisy otwarte':'Zapisy zamknięte'}`:'Brak zaplanowanego rajdu. Wyprawy i wydarzenia znajdziesz w **/bot**.',inline:false})
        .setFooter({text:`SentencedBot ${version} · roster gry i deklaracje członków`}).setTimestamp(new Date(now*1000));
    return [result];
}

const fields = [
    ['character','Postać i specjalizacja','np. Ragnok · Tauren Druid · Restoration',100,false],
    ['play','Co grasz lub czego szukasz?','np. Dungeony, PvP, ekipa na rajdy',150,false],
    ['professions','Profesje (opcjonalnie)','np. Górnictwo 225, Inżynieria 200',150,false],
    ['about','Kilka słów o sobie','Napisz tyle, ile chcesz pokazać gildii',420,true],
];

function createIntroductions({guild, db, getSetting, setSetting}) {
    db.exec('CREATE TABLE IF NOT EXISTS member_introductions (user_id TEXT PRIMARY KEY, message_id TEXT NOT NULL, profile TEXT NOT NULL)');
    const get = db.prepare('SELECT message_id, profile FROM member_introductions WHERE user_id=?');
    const save = db.prepare('INSERT INTO member_introductions VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET message_id=excluded.message_id,profile=excluded.profile');
    const remove = db.prepare('DELETE FROM member_introductions WHERE user_id=?');
    const drafts = new Map();
    const busy = new Set();
    const expired = ()=>{for(const [id,item] of drafts)if(item.until<=Date.now())drafts.delete(id);};
    const render = (userId,data)=> new EmbedBuilder().setColor(0x9e2a2b).setTitle('Gracz The Sentenced')
        .setDescription(`<@${userId}>\n**${text(data.character,120)}**`)
        .addFields({name:'Co gram / czego szukam',value:text(data.play,240)||'—'},
                   {name:'Profesje',value:text(data.professions,150)||'—'},
                   {name:'O mnie',value:text(data.about,640)||'—'});
    async function channel() {
        const target=await guild.channels.fetch(ABOUT_CHANNEL);
        if(target?.type!==0)throw Error('INTRO_CHANNEL_UNAVAILABLE');
        return target;
    }
    async function fetchBotMessage(target,id) {
        const message=await target.messages.fetch(id).catch(error=>{if(error.code===10008)return null;throw error;});
        if(message && message.author.id!==guild.client.user.id)throw Error('INTRO_MESSAGE_AUTHOR');
        return message;
    }
    async function ensurePanel() {
        const target=await channel();
        const payload={embeds:[new EmbedBuilder().setColor(0x9e2a2b).setTitle('Poznajmy się')
            .setDescription('Przedstaw postać i napisz, czego szukasz w gildii. Najpierw zobaczysz prywatny podgląd. Wizytówkę możesz później edytować albo wycofać.')],
            components:[row(action('intro:edit','Utwórz lub edytuj',ButtonStyle.Primary),action('intro:withdraw','Wycofaj wizytówkę'))],allowedMentions:noMentions};
        const id=getSetting('member_intro_panel');
        const existing=id?await fetchBotMessage(target,id):null;
        if(existing)await existing.edit(payload);
        else setSetting('member_intro_panel',(await target.send(payload)).id);
    }
    async function handle(i) {
        if(!i.customId?.startsWith('intro:'))return false;
        const [,op,nonce]=i.customId.split(':');
        const member=i.member;
        const response=(content)=>i.reply({content,flags:MessageFlags.Ephemeral,allowedMentions:noMentions});
        if(i.guildId!==guild.id||!has(member)) {await response('Wizytówki są dostępne po przyjęciu do gildii.');return true;}
        const old=get.get(i.user.id);
        if(op==='edit'){
            const values=old?JSON.parse(old.profile):{};
            const modal=new ModalBuilder().setCustomId('intro:preview').setTitle('Twoja wizytówka');
            for(const [key,label,placeholder,max,long] of fields){
                const input=new TextInputBuilder().setCustomId(key).setLabel(label).setMaxLength(max)
                    .setPlaceholder(placeholder).setStyle(long?TextInputStyle.Paragraph:TextInputStyle.Short).setRequired(key==='character');
                if(values[key])input.setValue(values[key]);
                modal.addComponents(row(input));
            }
            await i.showModal(modal);
            return true;
        }
        if(op==='preview'){
            expired();
            const data=Object.fromEntries(fields.map(([key,,,max])=>[key,i.fields.getTextInputValue(key).trim().slice(0,max)]));
            if(!data.character){await response('Podaj przynajmniej postać.');return true;}
            const key=randomBytes(10).toString('hex');
            drafts.set(i.user.id,{key,data,until:Date.now()+600000});
            await i.reply({content:'To prywatny podgląd. „Opublikuj” pokaże wizytówkę w kanale gildii.',
                embeds:[render(i.user.id,data)],components:[row(action('intro:publish:'+key,'Opublikuj',ButtonStyle.Success))],
                flags:MessageFlags.Ephemeral,allowedMentions:noMentions});
            return true;
        }
        if(!['publish','withdraw'].includes(op))return true;
        if(busy.has(i.user.id)){await response('Trwa jeszcze zapis.');return true;}
        busy.add(i.user.id);
        try{
            await i.deferReply({flags:MessageFlags.Ephemeral});
            const target=await channel();
            if(op==='withdraw'){
                const existing=old?await fetchBotMessage(target,old.message_id):null;
                if(existing)await existing.delete();
                remove.run(i.user.id);
                drafts.delete(i.user.id);
                await i.editReply(old?'Wizytówka została wycofana.':'Nie masz opublikowanej wizytówki.');
            }else{
                expired();
                const draft=drafts.get(i.user.id);
                if(!draft||draft.key!==nonce){await i.editReply('Podgląd wygasł. Otwórz formularz ponownie.');return true;}
                const payload={embeds:[render(i.user.id,draft.data)],allowedMentions:noMentions};
                const existing=old?await fetchBotMessage(target,old.message_id):null;
                const message=existing?await existing.edit(payload):await target.send({...payload,nonce:i.id,enforceNonce:true});
                save.run(i.user.id,message.id,JSON.stringify(draft.data));
                drafts.delete(i.user.id);
                await i.editReply('Wizytówka jest gotowa: '+message.url);
            }
        }catch(error){
            console.error('[introduction]',error.code||error.name);
            if(i.deferred)await i.editReply('Nie udało się potwierdzić zmiany. Sprawdź kanał przed ponowną próbą.');
        }finally{busy.delete(i.user.id);}
        return true;
    }
    return {ensurePanel,handle};
}
module.exports={ABOUT_CHANNEL,SITE,GAME,statusEmbeds,statusComponents,createIntroductions};
