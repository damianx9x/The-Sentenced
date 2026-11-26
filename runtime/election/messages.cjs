'use strict';
function clean(s,max=700){return String(s??'').replace(/@/g,'＠').replace(/[`*_~|\\]/g,'\\$&').slice(0,max);}
function createMessageRenderer(db,electionId){
 const nomination=db.prepare('SELECT character_class,availability,motivation,balance FROM election_nominations WHERE election_id=? AND user_id=?');
 const name=id=>{const r=nomination.get(electionId,id);return r?clean(r.character_class,100):'Kandydatura';};
 const safe={allowedMentions:{parse:[]}};
 return function render(row) {
  const p=JSON.parse(row.payload);const kind=row.kind;
  if(kind==='INITIAL')return {...safe,content:'⚔️ **WYBORY THE SENTENCED**\nZgłoszenia przyjmujemy do 25 listopada 2026 o 23:59. Napisz o swojej postaci, czasie dla gildii i pomyśle na wspólną grę.',components:[{type:1,components:[{type:2,style:1,custom_id:'elect:nominate',label:'Zgłoś kandydaturę'}]}]};
  if(kind==='NOMINATION') {
   const n=nomination.get(electionId,p.userId);if(!n)throw new Error('MISSING_NOMINATION');
   // Each answer is at most 1000 characters at the persistence boundary and
   // fits its own Discord field. Preserve the complete submitted text; the
   // allowed-mentions policy prevents notifications from user-entered content.
   const field=(name,value)=>({name,value:String(value||'—')});
   return {...safe,embeds:[{title:'⚔️ Kandydatura na GM The Sentenced',fields:[
    field('Kandydat',`<@${p.userId}>`),field('Postać i klasa',n.character_class),
    field('Czas dla gildii',n.availability),field('Dlaczego warto mnie wybrać?',n.motivation),
    field('Casual i PvE / rajdy — jak je pogodzisz?',n.balance)
   ],footer:{text:'Kandydatura gildyjna'}}]};
  }
  if(kind==='OPEN_VOTE'||kind==='OPEN_RUNOFF')return {...safe,content:`🗳️ **${kind==='OPEN_RUNOFF'?'Dogrywka':'Głosowanie na władze gildii'}**\nLiczba kandydatów: ${p.candidates.length}\nGłosują członkowie od Member wzwyż. Zamknięcie: <t:${Math.floor(p.closesAt/1000)}:F>.`,components:[{type:1,components:[{type:2,style:1,custom_id:'elect:ballot',label:'Oddaj głos'}]}]};
  if(kind==='WINNER'||kind==='WINNER_GENERAL')return {...safe,content:`🏆 **Głos gildii rozbrzmiał!**\nChwała ${name(p.candidateId)} — zwycięzcy wyborów The Sentenced! Niech nowy rozdział naszej opowieści rozpocznie się pod sztandarem Hordy. ⚔️`};
  if(kind==='REMINDER')return {...safe,content:'⚔️ Jutro wielki dzień! Widzimy się **29 listopada o 18:00 pod bramą Orgrimmaru**. Zbierzmy się pod wspólnym sztandarem The Sentenced!'};
  if(kind==='NO_CANDIDATES')return {...safe,content:'Zgłoszenia zakończone. Nie wpłynęła żadna kandydatura — dalsze kroki ustali kadra.'};
  if(kind==='NO_VOTES')return {...safe,content:'Głosowanie zakończone bez oddanych głosów. Kadra ustali dalsze kroki; nie ogłoszono zwycięzcy.'};
  if(kind==='MISSED_VOTE_WINDOW')return {...safe,content:'Nie udało się uruchomić głosowania w zaplanowanym czasie. Kadra ustali nowy termin.'};
  throw new Error('UNKNOWN_EVENT');
 };
}
module.exports={createMessageRenderer};
