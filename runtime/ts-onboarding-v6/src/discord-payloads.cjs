'use strict';
const {inviteContacts}=require('../../recruitment/invite-contacts.cjs');
/** Valid Discord API message/component payload objects, not effectful send functions.
 * An integration adapter may pass these to Discord.js. Never trust custom_id as auth.
 */
const {safeText}=require('./wizard.cjs');
const {termsHash}=require('./gate-store.cjs');
const MAX_DESCRIPTION=4096;
const BUTTON={PRIMARY:1,SECONDARY:2,SUCCESS:3,DANGER:4,LINK:5};
function customId(kind,subject){const s=`ts:${kind}:${subject}`;if(s.length>100)throw Error('CUSTOM_ID_TOO_LONG');return s;}
function button(label,style,idOrUrl){const b={type:2,style,label};if(style===BUTTON.LINK)b.url=idOrUrl;else b.custom_id=idOrUrl;return b;}
function row(...items){if(items.length<1||items.length>5)throw Error('INVALID_ROW');return {type:1,components:items};}
function termsCard(text,version,url){
 if(typeof text!=='string'||!text.trim()||text.length>MAX_DESCRIPTION)throw Error('TERMS_NOT_DISCORD_CARD_COMPATIBLE');
 if(typeof version!=='string'||version.length>40||!version.trim())throw Error('INVALID_VERSION');
 if(url && (typeof url!=='string'||!url.startsWith('https://')||url.length>300))throw Error('INVALID_URL');
 const hash=termsHash(text);const components=[button('Akceptuję',BUTTON.SUCCESS,customId('terms:accept',hash.slice(0,16))),button('Odrzucam',BUTTON.DANGER,customId('terms:decline',hash.slice(0,16)))];
 if(url)components.push(button('Regulamin na stronie',BUTTON.LINK,url));
 return {hash,payload:{allowedMentions:{parse:[]},embeds:[{title:'REGULAMIN — The Sentenced',description:text,color:0x226daa,footer:{text:`Wersja ${version} • SHA256 ${hash.slice(0,16)}`}}],components:[row(...components)]}};
}
function startPanel(rulesId){return {allowedMentions:{parse:[]},embeds:[{title:'Witaj w The Sentenced',description:`Najpierw zaakceptuj regulamin ${rulesId ? 'na <#'+rulesId+'>' : 'w osobnej karcie'}. Po wysłaniu wniosku poczekaj na decyzję kadry w #poczekalnia. Członkowie gildii zobaczą wszystkie odpowiedzi z wniosku na forum zgłoszeń.\n\n**Zaproszenia do gildii w grze:** ${inviteContacts()}.\n[Strona The Sentenced](https://thesentenced.pl/)`}],components:[row(button('Dołącz do The Sentenced',BUTTON.PRIMARY,customId('apply:start','v1')))]};}
function branchCard(){return {allowedMentions:{parse:[]},embeds:[{title:'Zgłoszenie do The Sentenced',description:'Czy jesteś starym członkiem The Sentenced?\nTAK → podaj dawny nick. NIE → wypełnij szczegółowy formularz WoW Forever.'}],components:[row(button('TAK — stary członek',BUTTON.SUCCESS,customId('apply:branch','yes')),button('NIE — nowy gracz',BUTTON.SECONDARY,customId('apply:branch','no')))]};}
function staffReview({userId,wasMember,application,revision}){
 if(!/^\d{17,20}$/.test(String(userId))||!Number.isSafeInteger(revision)||revision<0)throw Error('INVALID_REVIEW_ID');
 if(!['TAK','NIE'].includes(wasMember))throw Error('INVALID_REVIEW_BRANCH');
 if(!application||typeof application!=='object')throw Error('INVALID_REVIEW_APP');
 let fields=application.gameNick?[{name:'Nick w grze',value:safeText(application.gameNick).slice(0,1024),inline:true}]:[];
 if(wasMember==='TAK')fields.push({name:'Dawny nick',value:safeText(application.oldNick)||'—'});
 else {for(const [title,k] of [['Imię','firstName'],['Wiek','age'],['Klasa','wowClass'],['Rasa','race'],['Spec','spec'],['Profesje','professions'],['Style','playstyles'],['Raidy','raidPlan'],['Godziny/tydzień','raidHoursWeek'],['Dni','raidDays']]){
   if(k==='raidHoursWeek'||k==='raidDays')if(application.raidPlan!==true)continue;
   const v=application[k];let x=Array.isArray(v)?v.join(', '):k==='raidPlan'?(v===true?'Tak':'Nie'):String(v??'—');
   fields.push({name:title,value:safeText(x).slice(0,1024)||'—',inline:true});
 }}
 if(application.referralSource)fields.push({name:'Skąd dowiedziałeś się o gildii?',value:safeText(application.referralSource),inline:false});
 if(application.about)fields.push({name:'O sobie',value:safeText(application.about).slice(0,1024),inline:false});
 if(application.playFocus)fields.push({name:'Casual czy PvE? Jak to pogodzisz?',value:safeText(application.playFocus).slice(0,400),inline:false});
 const idBase=`${userId}:${revision}`;
 return {allowedMentions:{parse:[]},embeds:[{title:'Wniosek rekrutacyjny · OCZEKUJE',description:`Konto Discord: ${userId}\nGałąź: ${wasMember==='TAK'?'Dawny członek':'Nowa osoba'}\nKontroluj stan w bazie przed decyzją.`,fields:fields.slice(0,25)}],components:[row(button('Akceptuj',BUTTON.SUCCESS,customId('review:approve',idBase)),button('Odrzuć',BUTTON.DANGER,customId('review:reject',idBase)))]};
}
module.exports={termsCard,startPanel,branchCard,staffReview,BUTTON};
