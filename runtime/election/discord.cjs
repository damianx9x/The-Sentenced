'use strict';
const {canVote}=require('./access.cjs');
const {randomUUID}=require('node:crypto');
const EPHEMERAL=64;
function createDiscordAdapter({db,guildId,channelId,electionId,allowedRoleIds,ownerId,nominations,ballots,clock=Date.now}) {
 const current=db.prepare('SELECT status,current_round FROM election_state WHERE election_id=?');
 const options=db.prepare(`SELECT c.candidate_id,n.character_class FROM election_candidates c
 JOIN election_nominations n ON n.user_id=c.candidate_id AND n.election_id=? WHERE c.round_id=? ORDER BY n.submitted_at,n.user_id`);
 const queue=db.prepare(`INSERT INTO election_outbox(event_id,election_id,kind,payload) VALUES(?,?,?,?)
 ON CONFLICT(event_id) DO UPDATE SET payload=excluded.payload,delivery_state=CASE WHEN election_outbox.delivery_state IN ('INFLIGHT','UNCERTAIN') THEN election_outbox.delivery_state ELSE 'PENDING' END`);
 async function member(i){return i.guild.members.fetch({user:i.user.id,force:true});}
 async function handle(i) {
  if(!i.customId?.startsWith('elect:')) return false;
  if(i.guildId!==guildId || i.channelId!==channelId){await i.reply({content:'Ten panel działa tylko w kanale wyborów.',flags:EPHEMERAL});return true;}
  const action=i.customId.split(':')[1];
  try {
   const m=await member(i);
   if(m.user?.bot || m.pending!==false) throw new Error('NOT_ELIGIBLE');
   if(action==='nominate') {
    const s=current.get(electionId);if(!s || s.status!=='NOMINATIONS')throw new Error('NOMINATIONS_CLOSED');
    await i.showModal({custom_id:'elect:submit',title:'Kandydatura do władz gildii',components:[
     ['character','Nick postaci i klasa'],['availability','Ile czasu możesz poświęcić gildii?'],
     ['motivation','Dlaczego powinniśmy Cię wybrać?'],['balance','Casual czy PvE — jak pogodzisz?']
    ].map(([id,label])=>({type:1,components:[{type:4,custom_id:id,label,style:id==='character'?1:2,required:true,max_length:id==='character'?100:700}]}))});
   } else if(action==='submit') {
    await i.deferReply({flags:EPHEMERAL});
    const data={electionId,userId:i.user.id,characterClass:i.fields.getTextInputValue('character'),availability:i.fields.getTextInputValue('availability'),motivation:i.fields.getTextInputValue('motivation'),balance:i.fields.getTextInputValue('balance'),now:clock(),eligible:true};
    db.exec('BEGIN IMMEDIATE');try {
     nominations.submit(data);
     queue.run(`${electionId}:nomination:${i.user.id}`,electionId,'NOMINATION',JSON.stringify({userId:i.user.id,revision:randomUUID()}));
     db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
    await i.editReply({content:'Zgłoszenie zapisane. Zostanie opublikowane w kanale wyborów.'});
   } else if(action==='ballot' || action==='page') {
    if(!canVote(m,allowedRoleIds,ownerId))throw new Error('NOT_ELIGIBLE');
    const s=current.get(electionId);if(!s||s.status!=='VOTING')throw new Error('VOTING_CLOSED');
    const candidates=options.all(electionId,`${electionId}:${s.current_round}`);
    const page=action==='page'?Number(i.customId.split(':')[2]):0;
    if(!Number.isSafeInteger(page)||page<0||page>=Math.ceil(candidates.length/25))throw new Error('INVALID_PAGE');
    const chunk=candidates.slice(page*25,(page+1)*25);
    const components=[{type:1,components:[{type:3,custom_id:`elect:vote:${s.current_round}`,placeholder:'Wybierz jedną kandydaturę',min_values:1,max_values:1,options:chunk.map(c=>({label:c.character_class.slice(0,100),value:c.candidate_id}))}]}];
    const buttons=[];if(page>0)buttons.push({type:2,style:2,label:'Poprzednia',custom_id:`elect:page:${page-1}`});
    if((page+1)*25<candidates.length)buttons.push({type:2,style:2,label:'Następna',custom_id:`elect:page:${page+1}`});
    if(buttons.length)components.push({type:1,components:buttons});
    await i.reply({content:`Wybierz kandydata. Głos można oddać tylko raz. Strona ${page+1}/${Math.ceil(candidates.length/25)}.`,components,flags:EPHEMERAL});
   } else if(action==='vote') {
    if(!canVote(m,allowedRoleIds,ownerId))throw new Error('NOT_ELIGIBLE');
    const s=current.get(electionId);const id=Number(i.customId.split(':')[2]);
    if(!s||s.status!=='VOTING'||id!==s.current_round)throw new Error('VOTING_CLOSED');
    if(!Array.isArray(i.values)||i.values.length!==1)throw new Error('INVALID_BALLOT');
    ballots.vote({roundId:`${electionId}:${id}`,voterId:i.user.id,candidateId:i.values[0],now:clock()});
    await i.update({content:'Twój głos został zapisany. Dziękujemy!',components:[]});
   } else throw new Error('INVALID_ACTION');
  } catch(error) {
   const messages={NOT_ELIGIBLE:'Głosować mogą członkowie od roli Member wzwyż.',NOMINATIONS_CLOSED:'Zgłoszenia są już zamknięte.',VOTING_CLOSED:'Głosowanie jest zamknięte lub ten panel jest nieaktualny.',ALREADY_VOTED:'Głos w tej rundzie został już oddany.',UNKNOWN_CANDIDATE:'Ta kandydatura jest niedostępna.'};
   const content=messages[error.message]||'Nie udało się wykonać operacji. Spróbuj ponownie lub skontaktuj się z oficerem.';
   if(i.deferred||i.replied) await i.editReply({content,components:[]});else await i.reply({content,flags:EPHEMERAL});
  }
  return true;
 }
 return {handle};
}
module.exports={createDiscordAdapter};
