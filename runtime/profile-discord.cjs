'use strict';
const {has}=require('./guild-core');
const {profile,updateProfile}=require('./guild-actions.cjs');
const CLASS_OPTIONS=new Set(['Warrior','Paladin','Hunter','Rogue','Priest','Shaman','Mage','Warlock','Druid']);
async function currentPlayer(guild,userId){
 try{const member=await guild.members.fetch({user:userId,force:true});return member&&!member.user?.bot&&has(member)?{}:{error:'Najpierw zakończ rekrutację The Sentenced.'};}catch{return {error:'Nie udało się sprawdzić dostępu. Spróbuj ponownie.'};}
}
async function prepareClassEdit({db,guild,userId}){
 const access=await currentPlayer(guild,userId);if(access.error)return access;
 try{return {revision:profile(db,userId).revision};}catch(e){if(e.message==='Brak profilu')return {error:'Brak profilu. Otwórz ponownie /bot.'};throw e;}
}
async function saveProfileEdit({db,guild,userId,revision,field,value,allowClear=false,requireActive=false}){
 const access=await currentPlayer(guild,userId);if(access.error)return access;
 if(typeof revision!=='string'||!/^[a-f0-9]{64}$/.test(revision))return {error:'To menu wygasło. Otwórz edycję ponownie.'};
 if(field==='wow_class'&&!CLASS_OPTIONS.has(value))return {error:'Nieprawidłowy wybór klasy.'};
 if(field==='wow_role'&&!['TANK','HEAL','DPS'].includes(value))return {error:'Nieprawidłowy wybór funkcji.'};
 if(field==='interests'){
  if(!Array.isArray(value)||(value.length<1&&!allowClear)||value.length>4||new Set(value).size!==value.length||value.some(v=>!['PVE','PVP','RAIDY','RP'].includes(v)))return {error:'Nieprawidłowy wybór stylu gry.'};
  value=value.join(',');
 }
 if(field==='game_nick'&&(typeof value!=='string'||!value.trim()||value.length>60))return {error:'Podaj nick (1–60 znaków).'};
 if(field==='plans_forever'&&!['TAK','NIE'].includes(value))return {error:'Nieprawidłowa odpowiedź.'};
 if(!['wow_class','wow_role','interests','game_nick','plans_forever'].includes(field))return {error:'Nieprawidłowe pole profilu.'};
 try{if(requireActive)return db.transaction(()=>{if(!db.prepare('SELECT 1 FROM members WHERE user_id=? AND left_at IS NULL').get(userId))return {error:'Brak aktywnego profilu gildii.'};return updateProfile(db,userId,revision,{[field]:value});})();return updateProfile(db,userId,revision,{[field]:value});}catch(e){if(e.message==='Brak profilu')return {error:'Brak profilu. Otwórz ponownie /bot.'};throw e;}
}
async function saveClassEdit(args){return saveProfileEdit({...args,field:'wow_class'});}
module.exports={prepareClassEdit,saveClassEdit,saveProfileEdit};
