'use strict';

const {createServer}=require('node:http');
const {randomBytes}=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {parseRequest,runTransfer}=require('./transfer-sync.cjs');
const {maintenance}=require('./maintenance.cjs');
const {hash}=require('./guild-actions.cjs');

const staffList='staff.review.list';
const staffWrites=new Set(['staff.review.decide','staff.post']);
const requestId=()=>randomBytes(8).toString('hex');

function createStaffExchange({db,guild,service,clock=Date.now}){
 const linked=db.prepare('SELECT character FROM addon_links WHERE user_id=?');
 function postReceipt(cmd){
  const receipt=db.prepare('SELECT payload_hash, status, result_json FROM addon_requests WHERE user_id=? AND request_id=?').get(guild.ownerId,cmd.id);
  return receipt?.payload_hash===hash(cmd)?receipt:undefined;
 }
 return async function exchange(input){
  if(maintenance(db))return {status:'maintenance'};
  const character=linked.get(guild.ownerId)?.character;
  if(!character)return {status:'unlinked'};
  const requestIdForList=requestId();
  const encodedName=Buffer.from(character,'utf8').toString('hex');
  const listWire=['TSB1','Q',requestIdForList,encodedName,staffList,'1'].join('|');
  let acknowledgement,staleRequest;
  if(input.decision!==undefined){
   const decision=input.decision;
   const now=Math.floor(clock()/1000);
   if(!decision||!Number.isSafeInteger(decision.createdAt)||
      decision.createdAt<now-30*86400||decision.createdAt>now+60)
    throw Error('STAFF_REQUEST_EXPIRED');
   const request=parseRequest(decision.wire);
   if(request.character!==character||!staffWrites.has(request.cmd.operation))throw Error('STAFF_REQUEST_INVALID');
   if(decision.createdAt<now-900){
    staleRequest=request;
   }else{
    acknowledgement=await runTransfer({service,db,userId:guild.ownerId,wire:decision.wire,now:clock()});
    // The request may already have reached Discord without a response. Keep
    // its original ID queued and do not let an uncertain error invite a resend.
    if(request.cmd.operation==='staff.post'&&postReceipt(request.cmd)?.status==='uncertain')acknowledgement=undefined;
   }
  }
  const queue=await runTransfer({service,db,userId:guild.ownerId,wire:listWire,now:clock()});
  if(!queue.startsWith('TSB1|K|'))return {status:'denied'};
  // Recover confirmed results after a reload or extended network outage. Older
  // operations are never sent again, even if they have no recorded outcome.
  if(staleRequest?.cmd.operation==='staff.review.decide'){
   const {user_id,revision,action}=staleRequest.cmd.payload;
   const row=db.prepare('SELECT state,submitted_revision,decision_actor FROM ts_onboarding_gate WHERE guild_id=? AND user_id=?').get(guild.id,user_id);
   const expected=action==='approve'?'APPROVED':'REJECTED';
   if(row?.state===expected&&row.submitted_revision===revision&&row.decision_actor===guild.ownerId){
    const fields=queue.split('|');
    fields[2]=staleRequest.cmd.id;
    fields[7]=expected;
    acknowledgement=fields.join('|');
   }
  }else if(staleRequest?.cmd.operation==='staff.post'){
   const {cmd}=staleRequest;
   const receipt=postReceipt(cmd);
   if(receipt?.status==='done'){
    let messageId;
    try{messageId=JSON.parse(receipt.result_json)?.message_id;}catch{}
    if(typeof messageId==='string'&&/^\d{17,20}$/.test(messageId)){
     acknowledgement=['TSB1','P',cmd.id,Math.floor(clock()/1000),encodedName,messageId].join('|');
    }
   }
  }
  return {status:'ready',queue,acknowledgement,character};
 };
}

function startStaffLocalBridge({db,guild,service,directory}){
 const exchange=createStaffExchange({db,guild,service});
 fs.mkdirSync(directory,{recursive:true,mode:0o700});
 const info=fs.lstatSync(directory);
 if(!info.isDirectory()||(info.mode&0o077)!==0||info.uid!==process.getuid())throw Error('Unsafe staff bridge directory');
 const socket=path.join(directory,'staff.sock');
 if(fs.existsSync(socket)){
  const previous=fs.lstatSync(socket);
  if(!previous.isSocket()||previous.uid!==process.getuid())throw Error('Unsafe staff bridge socket');
  fs.unlinkSync(socket);
 }
 const server=createServer(async(req,res)=>{
  res.setHeader('content-type','application/json; charset=utf-8');
  res.setHeader('cache-control','no-store');
  const respond=(status,result)=>{res.statusCode=status;res.end(JSON.stringify(result))};
  if(req.method!=='POST'||req.url!=='/review'||req.headers.origin)return respond(404,{status:'unsupported'});
  let data='';
  try{
   for await(const chunk of req){data+=chunk;if(Buffer.byteLength(data)>1600)return respond(413,{status:'invalid'});}
   const input=JSON.parse(data);
   if(!input||typeof input!=='object'||Array.isArray(input))return respond(400,{status:'invalid'});
   return respond(200,await exchange(input));
  }catch{return respond(400,{status:'invalid'});}
 });
 server.requestTimeout=12000;
 server.on('error',error=>console.error('[staff-bridge] socket '+(error.code||error.name)));
 server.listen(socket,()=>{fs.chmodSync(socket,0o600);console.log('[staff-bridge] ready')});
 return server;
}

module.exports={createStaffExchange,startStaffLocalBridge};
