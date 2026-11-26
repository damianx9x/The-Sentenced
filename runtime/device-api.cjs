'use strict';
const http=require('node:http');
const crypto=require('node:crypto');
const {hash}=require('./guild-actions.cjs');
const {version}=require('./system-version.json');
function createDevices({db,guild,service,key,now=Date.now}){
 if(typeof key!=='string'||key.length<32)throw Error('Device signing key unavailable');
 db.exec(`CREATE TABLE IF NOT EXISTS integration_devices(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,role TEXT NOT NULL,character TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,created_at INTEGER NOT NULL,revoked_at INTEGER);
 CREATE TABLE IF NOT EXISTS integration_device_codes(code_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,role TEXT NOT NULL,expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS integration_pair_receipts(code_hash TEXT NOT NULL,request_id TEXT NOT NULL,payload_hash TEXT NOT NULL,device_id TEXT NOT NULL,expires_at INTEGER NOT NULL,PRIMARY KEY(code_hash,request_id));`);
 const tokenFor=id=>'ts25_'+crypto.createHmac('sha256',key).update('device-v2.5:'+id).digest('base64url');
 async function issueCode(userId,role='client'){
  await service.member(userId);
  if(!['client','relay'].includes(role)||role==='relay'&&userId!==guild.ownerId)throw Error('Brama wymaga właściciela gildii');
  const code=crypto.randomBytes(9).toString('hex').toUpperCase();
  db.transaction(()=>{db.prepare('DELETE FROM integration_device_codes WHERE user_id=? AND role=? OR expires_at<?').run(userId,role,now());db.prepare('INSERT INTO integration_device_codes VALUES(?,?,?,?)').run(hash(code),userId,role,now()+600000)})();
  return code;
 }
 async function pair(input){
  if(!input||typeof input.code!=='string'||!input.code.match(/^[a-f0-9]{18}$/i)||!input.id?.match(/^[a-f0-9]{16}$/)||typeof input.character!=='string'||!input.character.match(/^[^\s|<>\x00-\x1f]{2,60}-[^\s|<>\x00-\x1f]{2,60}$/))throw Error('Nieprawidłowe parowanie');
  const codeHash=hash(input.code.toUpperCase()),payloadHash=hash(input);
  const receipt=db.prepare('SELECT * FROM integration_pair_receipts WHERE code_hash=? AND request_id=? AND expires_at>?').get(codeHash,input.id,now());
  if(receipt){if(receipt.payload_hash!==payloadHash)throw Error('Kod już użyty');const device=await authenticate(tokenFor(receipt.device_id));return {token:tokenFor(device.id),role:device.role,character:device.character,version}}
  const row=db.prepare('SELECT * FROM integration_device_codes WHERE code_hash=? AND expires_at>?').get(codeHash,now());
  if(!row)throw Error('Kod wygasł lub jest nieprawidłowy');
  await service.member(row.user_id);if(row.role==='relay'&&row.user_id!==guild.ownerId)throw Error('Brak uprawnień bramy');
  const id=crypto.randomBytes(16).toString('hex');
  return db.transaction(()=>{
   if(!db.prepare('SELECT code_hash FROM integration_device_codes WHERE code_hash=? AND expires_at>?').get(codeHash,now()))throw Error('Kod już użyty');
   const linked=db.prepare('SELECT user_id FROM addon_links WHERE character=?').get(input.character);
   if(linked&&linked.user_id!==row.user_id)throw Error('Postać ma inne powiązanie');
   db.prepare('DELETE FROM addon_links WHERE user_id=?').run(row.user_id);
   db.prepare('INSERT INTO addon_links VALUES(?,?,?) ON CONFLICT(character) DO UPDATE SET user_id=excluded.user_id,linked_at=excluded.linked_at').run(input.character,row.user_id,now());
   db.prepare('INSERT INTO integration_devices VALUES(?,?,?,?,?,?,NULL)').run(id,row.user_id,row.role,input.character,hash(tokenFor(id)),now());
   db.prepare('DELETE FROM integration_device_codes WHERE code_hash=?').run(codeHash);
   db.prepare('DELETE FROM integration_pair_receipts WHERE expires_at<?').run(now());
   db.prepare('INSERT INTO integration_pair_receipts VALUES(?,?,?,?,?)').run(codeHash,input.id,payloadHash,id,now()+600000);
   return {token:tokenFor(id),role:row.role,character:input.character,version};
  })();
 }
 async function authenticate(token){
  if(typeof token!=='string'||!/^ts25_[A-Za-z0-9_-]{43}$/.test(token))throw Error('Nieprawidłowa sesja');
  const device=db.prepare('SELECT * FROM integration_devices WHERE token_hash=? AND revoked_at IS NULL').get(hash(token));
  if(!device||!crypto.timingSafeEqual(Buffer.from(token),Buffer.from(tokenFor(device.id))))throw Error('Urządzenie odłączone');
  await service.member(device.user_id);
  if(device.role==='relay'&&device.user_id!==guild.ownerId)throw Error('Brama utraciła uprawnienia');
  // Character must still belong to this user after re-pairing from another device.
  if(db.prepare('SELECT user_id FROM addon_links WHERE character=?').get(device.character)?.user_id!==device.user_id)throw Error('Powiązanie postaci zmieniło się');
  return device;
 }
 async function perform(device,input){
  if(!input||typeof input!=='object')throw Error('Nieprawidłowe dane');
  const sender=device.role==='relay'?input.sender:device.character;
  if(device.role!=='relay'&&input.sender&&input.sender!==device.character)throw Error('Brak uprawnień relay');
  if(device.role==='relay'&&input.command?.operation?.startsWith('staff.'))throw Error('Kadra wymaga własnego sparowanego urządzenia');
  return service.perform(sender,input.command,device.role==='relay'?undefined:device.user_id);
 }
 function revoke(userId){db.prepare('UPDATE integration_devices SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL').run(now(),userId);db.prepare('DELETE FROM integration_device_codes WHERE user_id=?').run(userId);db.prepare('DELETE FROM addon_links WHERE user_id=?').run(userId)}
 return {issueCode,pair,authenticate,perform,revoke};
}
function startDeviceAPI({devices,port=8880,host='127.0.0.1'}){
 const attempts=new Map();
 function limit(key,max){const previous=attempts.get(key);const row=previous&&Date.now()-previous.start<60000?previous:{start:Date.now(),count:0};row.count++;attempts.set(key,row);if(attempts.size>2048){for(const [k,r]of attempts)if(Date.now()-r.start>60000)attempts.delete(k)}return row.count<=max}
 const server=http.createServer(async(req,res)=>{
  const reply=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data))};
  try{
   if(req.headers.origin)return reply(403,{error:'Ten endpoint jest dla programu, nie przeglądarki'});
   if(req.method==='GET'&&req.url==='/v2/health')return reply(200,{version,gameTransportVerified:false});
   if(req.method!=='POST'||!['/v2/pair','/v2/command','/v2/session'].includes(req.url))return reply(404,{error:'Brak operacji'});
   if(!req.headers['content-type']?.startsWith('application/json'))return reply(415,{error:'JSON wymagany'});
   const key=req.url==='/v2/pair'?'pair:'+req.socket.remoteAddress:'device:'+hash(req.headers.authorization||'');
   if(!limit(key,req.url==='/v2/pair'?10:120))return reply(429,{error:'Odczekaj minutę'});
   let body='';for await(const piece of req){body+=piece;if(Buffer.byteLength(body)>65536)return reply(413,{error:'Limit danych'})}
   let input;try{input=JSON.parse(body)}catch{return reply(400,{error:'Nieprawidłowy JSON'})}
   if(req.url==='/v2/pair')return reply(200,await devices.pair(input));
   const device=await devices.authenticate(req.headers.authorization?.replace(/^Bearer /,''));
   if(req.url==='/v2/session')return reply(200,{version,role:device.role,character:device.character,gameTransportVerified:false});
   const result=await devices.perform(device,input);
   if(Buffer.byteLength(JSON.stringify(result))>65536)return reply(413,{error:'Snapshot przekracza limit. Wybierz mniej danych'});
   return reply(200,result);
  }catch{return reply(403,{error:'Sprawdź parowanie, członkostwo i uprawnienia'})}
 });
 server.requestTimeout=15000;server.headersTimeout=10000;
 return server.listen(port,host);
}
module.exports={createDevices,startDeviceAPI};
