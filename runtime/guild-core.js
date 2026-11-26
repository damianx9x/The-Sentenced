'use strict';
const PLAYERS=Object.freeze(['GM','Oficer','Raid Lider','Member']);
const STAFF=Object.freeze(['GM','Oficer','Raid Lider']);
const OFFICERS=Object.freeze(['GM','Oficer']);
function has(member,names=PLAYERS){
 if(!member?.id || member.pending===true)return false;
 if(member.id===member.guild?.ownerId)return true;
 const roles=member.roles?.cache;
 if(names===PLAYERS)return Boolean(roles?.some(role=>role.name==='Dostęp_zatwierdzony'||STAFF.includes(role.name)));
 return Boolean(roles?.some(role=>names.includes(role.name)));
}
function text(value,limit=1000){return String(value??'').replace(/@/g,'＠').replace(/([*_`~|\\])/g,'\\$1').slice(0,limit);}
function json(value,fallback=[]){try{const parsed=JSON.parse(value);return Array.isArray(parsed)?parsed:fallback;}catch{return fallback;}}
function roleKind(value){const role=String(value||'').toUpperCase();return role==='TANK'?'TANK':['HEAL','HEALER'].includes(role)?'HEAL':role==='DPS'?'DPS':null;}
function missingProfileFields(record){return [['game_nick','Nick','nick'],['wow_class','Klasa','class'],['wow_role','Funkcja','role'],['interests','Styl gry','style']].filter(([key])=>key==='interests'?!json(record?.[key],String(record?.[key]||'').split(',').filter(x=>x.trim())).length:!String(record?.[key]||'').trim());}
module.exports={PLAYERS,STAFF,OFFICERS,has,text,json,roleKind,missingProfileFields};
