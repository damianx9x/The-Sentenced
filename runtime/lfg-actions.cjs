'use strict';
function joinExpedition(db,e,userId,chosen){return db.transaction(()=>{e=db.prepare('SELECT * FROM expeditions WHERE id=?').get(e.id);if(!e||e.status!=='OPEN'||e.expires_at<=Date.now())return 'closed';const current=db.prepare('SELECT * FROM expedition_members WHERE expedition_id=? AND user_id=?').get(e.id,userId);if(e.mode==='DUNGEON'){if(!['TANK','HEAL','DPS'].includes(chosen))return 'role';const limit=chosen==='DPS'?3:1;if(db.prepare('SELECT count(*) n FROM expedition_members WHERE expedition_id=? AND wow_role=? AND user_id<>?').get(e.id,chosen,userId).n>=limit)return 'full'}if(!current&&db.prepare('SELECT count(*) n FROM expedition_members WHERE expedition_id=?').get(e.id).n>=e.capacity)return 'full';db.prepare('INSERT INTO expedition_members(expedition_id,user_id,wow_role) VALUES(?,?,?) ON CONFLICT(expedition_id,user_id) DO UPDATE SET wow_role=excluded.wow_role').run(e.id,userId,chosen);return current?'already':'joined'})()}
function createExpedition(db,userId,payload){return db.transaction(()=>{
 const {title,details,capacity,hours,mode}=payload;const role=db.prepare('SELECT wow_role FROM members WHERE user_id=?').get(userId)?.wow_role;
 if(typeof title!=='string'||!title.trim()||title.length>100||typeof details!=='string'||!details.trim()||details.length>1500||!Number.isInteger(capacity)||capacity<2||capacity>40||!Number.isInteger(hours)||hours<1||hours>72||!['DUNGEON','FREE'].includes(mode))return {error:'Cel, opis, 2–40 miejsc, 1–72 godzin, tryb dungeon lub luźny'};
 if(mode==='DUNGEON'&&(capacity!==5||!['TANK','HEAL','DPS'].includes(role)))return {error:'Dungeon: 5 miejsc i funkcja ustawiona w profilu'};
 if(db.prepare("SELECT count(*) n FROM expeditions WHERE owner_id=? AND status='OPEN' AND expires_at>?").get(userId,Date.now()).n>=3)return {error:'Masz już 3 otwarte wyprawy'};
 const result=db.prepare('INSERT INTO expeditions(owner_id,title,details,expires_at,capacity,created_at,mode,status) VALUES(?,?,?,?,?,?,?,\'OPEN\')').run(userId,title.trim().replace(/@/g,'＠'),details.trim().replace(/@/g,'＠'),Date.now()+hours*3600000,capacity,Date.now(),mode);const id=Number(result.lastInsertRowid);
 db.prepare('INSERT INTO expedition_members(expedition_id,user_id,wow_role) VALUES(?,?,?)').run(id,userId,role||null);return {id};
 })()}
async function publishExpedition({db,guild,channel,payload,id}){
 db.exec('CREATE TABLE IF NOT EXISTS expedition_publications(expedition_id INTEGER PRIMARY KEY,status TEXT NOT NULL)');
 const e=db.prepare('SELECT * FROM expeditions WHERE id=?').get(id);if(!e||!channel)throw Error('Tablica wypraw niedostępna');
 if(e.message_id){const message=await channel.messages.fetch(e.message_id);await message.edit(payload(e));return message}
 const receipt=db.prepare('SELECT * FROM expedition_publications WHERE expedition_id=?').get(id);
 if(receipt){const history=await channel.messages.fetch({limit:100});const existing=[...history.values()].find(m=>m.author.id===guild.members.me.id&&m.embeds.some(x=>x.title?.startsWith('⚔️ WYPRAWA #'+id+' •')));if(existing){db.prepare('UPDATE expeditions SET message_id=? WHERE id=?').run(existing.id,id);return existing}throw Error('Niepewny wynik publikacji wyprawy; sprawdź Discord. Bez automatycznej powtórki')}
 db.prepare("INSERT INTO expedition_publications VALUES(?,'uncertain')").run(id);
 const msg=await channel.send({...payload(e),allowedMentions:{parse:[]},nonce:'ts-lfg-'+id,enforceNonce:true});
 db.transaction(()=>{db.prepare('UPDATE expeditions SET message_id=? WHERE id=?').run(msg.id,id);db.prepare("UPDATE expedition_publications SET status='done' WHERE expedition_id=?").run(id)})();return msg;
}
module.exports={joinExpedition,createExpedition,publishExpedition};
