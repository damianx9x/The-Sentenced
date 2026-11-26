'use strict';
// Owner SSH companion only; no HTTP endpoint or Discord user-token access.
const {exchangeWelcomes}=require('../recruitment/wow-welcome.cjs');
if(require.main===module){
 let input='',size=0;process.stdin.setEncoding('utf8');
 process.stdin.on('data',chunk=>{size+=Buffer.byteLength(chunk);if(size>4096){console.error('WELCOME_INPUT_TOO_LARGE');process.exit(2)}input+=chunk;});
 process.stdin.on('end',()=>{
  let db;
  try{
   const value=input.trim()?JSON.parse(input):{};
   const Database=require('better-sqlite3');db=new Database('/opt/sentencedbot/data/sentenced.db',{fileMustExist:true});db.pragma('busy_timeout = 10000');
   console.log(JSON.stringify(exchangeWelcomes(db,value)));
  }catch{console.error('WELCOME_EXCHANGE_FAILED');process.exitCode=1;}
  finally{if(db)db.close();}
 });
}
module.exports={exchangeWelcomes};
