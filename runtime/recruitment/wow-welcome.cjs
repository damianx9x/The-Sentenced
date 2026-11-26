'use strict';
const MAX_AGE_SECONDS=24*60*60;
function ensureQueue(db){
 db.exec(`CREATE TABLE IF NOT EXISTS wow_welcome_outbox (
  user_id TEXT PRIMARY KEY, text TEXT NOT NULL, created_at INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','confirmed')),
  confirmed_at INTEGER
 );`);
}
function validId(id){return typeof id==='string'&&/^[0-9]{1,20}$/.test(id);}
function welcomeText(nick){
 // Preserve the accepted nickname exactly; never infer or transliterate an identity.
 if(typeof nick!=='string')return null;
 nick=nick.trim();
 if(!/^[\p{L}][\p{L}\p{M}' -]{1,59}$/u.test(nick)||/[|\x00-\x1f\x7f]/.test(nick))return null;
 const text=`Witaj w The Sentenced, ${nick}! Po zaproszenie do gildii w grze zglos sie do Icex Jenkins lub kadry. Za Horde!`;
 return Buffer.byteLength(text,'utf8')<=240?text:null;
}
function enqueueMemberWelcome(db,userId,now=Date.now()){
 ensureQueue(db);
 if(!validId(userId)||!Number.isSafeInteger(now)||now<0)return false;
 const columns=db.prepare('PRAGMA table_info(members)').all();
 if(!columns.some(c=>c.name==='game_nick'))return false;
 const member=db.prepare('SELECT game_nick FROM members WHERE user_id=?').get(userId);
 const text=welcomeText(member?.game_nick);if(!text)return false;
 const result=db.prepare('INSERT OR IGNORE INTO wow_welcome_outbox(user_id,text,created_at) VALUES(?,?,?)').run(userId,text,Math.floor(now/1000));
 return Number(result.changes)===1;
}
function exchangeWelcomes(db,input={},now=Date.now()){
 if(!input||typeof input!=='object'||Array.isArray(input)||!Number.isSafeInteger(now)||now<0)throw Error('INVALID_WELCOME_EXCHANGE');
 const confirmed=input.confirmed??[];
 if(!Array.isArray(confirmed)||confirmed.length>20||confirmed.some(id=>!validId(id)))throw Error('INVALID_WELCOME_ACK');
 ensureQueue(db);const seconds=Math.floor(now/1000);
 db.exec('BEGIN IMMEDIATE');
 try{
  const ack=db.prepare("UPDATE wow_welcome_outbox SET state='confirmed',confirmed_at=? WHERE user_id=? AND state='pending' AND created_at<=? AND created_at>=?");
  for(const id of new Set(confirmed))ack.run(seconds,id,seconds,seconds-MAX_AGE_SECONDS);
  const welcomes=db.prepare("SELECT user_id AS id,text,created_at AS createdAt FROM wow_welcome_outbox WHERE state='pending' AND created_at<=? AND created_at>=? ORDER BY created_at,user_id LIMIT 20").all(seconds,seconds-MAX_AGE_SECONDS);
  db.exec('COMMIT');return {schema:1,generatedAt:seconds,welcomes};
 }catch(error){db.exec('ROLLBACK');throw error;}
}
module.exports={ensureQueue,welcomeText,enqueueMemberWelcome,exchangeWelcomes,MAX_AGE_SECONDS};
