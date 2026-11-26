'use strict';
const {createHash}=require('node:crypto');
const {createImporter}=require('./import.cjs');
function receive(db,input,now=Date.now()){
 if(!input||input.schema!==1||typeof input.guild!=='string'||input.guild.trim().toLowerCase()!=='the sentenced'||!Number.isSafeInteger(input.timestamp)||!Array.isArray(input.rows)||input.rows.length<1||input.rows.length>5000)throw Error('INVALID_SNAPSHOT');
 if(input.timestamp*1000>now+300000||input.timestamp*1000<now-7*86400000)throw Error('SNAPSHOT_OUT_OF_DATE');
 const rows=input.rows.map(r=>({name:r.name,wowClass:r.wowClass,level:r.level??null,rank:r.rank??null}));
 const requestId=createHash('sha256').update(JSON.stringify({guild:input.guild,timestamp:input.timestamp,rows})).digest('hex');
 const importer=createImporter(db),plan=importer.preview(rows,{});
 return importer.apply(plan,{actorId:'mac-roster-sync',now,source:'mac-the-sentenced',sourceTimestamp:input.timestamp,requestId});
}
if(require.main===module){
 let input='',size=0;process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>{size+=Buffer.byteLength(chunk);if(size>524288){console.error('INPUT_TOO_LARGE');process.exit(2)}input+=chunk;});
 process.stdin.on('end',()=>{try{const Database=require('better-sqlite3');const db=new Database('/opt/sentencedbot/data/sentenced.db');db.pragma('busy_timeout = 10000');const result=receive(db,JSON.parse(input));db.close();console.log(JSON.stringify({ok:true,duplicate:!!result.duplicate,characters:result.characters??0,profiles:result.profiles??0}));}catch(e){console.error('ROSTER_SYNC_FAILED',String(e.message).slice(0,100));process.exitCode=1;}});
}
module.exports={receive};
