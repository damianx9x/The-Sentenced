'use strict';
// Called inside the existing approval transaction. Authoritative roster wins.
function projectApplication(db,userId,app,now){
 if(!app||typeof app!=='object')throw Error('INVALID_APPLICATION');
 const current=db.prepare('SELECT game_nick,wow_class,old_ts_nick,first_name,age,interests,played_before_ts FROM members WHERE user_id=?').get(userId);if(!current)throw Error('MEMBER_NOT_FOUND');
 const hasRoster=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='guild_roster_characters'").get();
 const roster=hasRoster?db.prepare('SELECT name,wow_class FROM guild_roster_characters WHERE discord_id=?').get(userId):null;
 const existing=x=>typeof x==='string'&&x.trim()?x:null;
 const modes=[];if(app.playstyles?.includes('Raidowanie'))modes.push('RAIDY');if(app.playstyles?.includes('PvP'))modes.push('PVP');
 const values={nick:roster?.name||existing(current.game_nick)||existing(app.gameNick),class:roster?.wow_class||existing(current.wow_class)||existing(app.wowClass),old:existing(current.old_ts_nick)||existing(app.oldNick),first:existing(current.first_name)||existing(app.firstName),age:current.age??(Number.isInteger(app.age)?app.age:null),interests:existing(current.interests)||(modes.length?modes.join(','):null),played:existing(current.played_before_ts)||(app.wasMember==='TAK'?'TAK':app.wasMember==='NIE'?'NIE':null)};
 db.prepare('UPDATE members SET game_nick=?,wow_class=?,old_ts_nick=?,first_name=?,age=?,interests=?,played_before_ts=? WHERE user_id=?').run(values.nick,values.class,values.old,values.first,values.age,values.interests,values.played,userId);
 const table=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='member_preferences'").get();
 if(table){
  const allowed=new Set(['Alchemy','Blacksmithing','Enchanting','Engineering','Herbalism','Leatherworking','Mining','Skinning','Tailoring','Cooking','Fishing','FirstAid']);
  const professions=Array.isArray(app.professions)?app.professions.filter(x=>allowed.has(x)):[];
  db.prepare('INSERT OR IGNORE INTO member_preferences(user_id,updated_at) VALUES(?,?)').run(userId,now);
  const pref=db.prepare('SELECT play_pace,professions FROM member_preferences WHERE user_id=?').get(userId);
  let oldProf=[];try{oldProf=JSON.parse(pref.professions||'[]');if(!Array.isArray(oldProf))oldProf=[];}catch{}
  db.prepare('UPDATE member_preferences SET play_pace=?,professions=?,updated_at=? WHERE user_id=?').run(existing(pref.play_pace)||(app.playstyles?.includes('Casual')?'CASUAL':''),JSON.stringify(oldProf.length?oldProf:professions),now,userId);
 }
}
module.exports={projectApplication};
