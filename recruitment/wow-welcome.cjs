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
// Retained for compatibility with existing clients; no new or queued greetings
// are exported after the move to application-thread-only welcomes.
function enqueueMemberWelcome(){return false;}
function exchangeWelcomes(db,input={},now=Date.now()){
 if(!input||typeof input!=='object'||Array.isArray(input)||!Number.isSafeInteger(now)||now<0)throw Error('INVALID_WELCOME_EXCHANGE');
 const confirmed=input.confirmed??[];
 if(!Array.isArray(confirmed)||confirmed.length>20||confirmed.some(id=>!validId(id)))throw Error('INVALID_WELCOME_ACK');
 return {schema:1,generatedAt:Math.floor(now/1000),welcomes:[]};
}
module.exports={ensureQueue,welcomeText,enqueueMemberWelcome,exchangeWelcomes,MAX_AGE_SECONDS};
