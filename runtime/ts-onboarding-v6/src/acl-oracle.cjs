'use strict';
/** Deterministic Discord guild-channel permission oracle for read-only snapshots.
 * Does not make Discord API requests. Member-specific overwrites evaluated when memberId provided.
 * Disclaimer: actual runtime/member.pending/client UI must be verified on a controlled account.
 */
const FLAGS=Object.freeze({ADMINISTRATOR:1n<<3n,VIEW_CHANNEL:1n<<10n,CONNECT:1n<<20n,SEND_MESSAGES:1n<<11n,SPEAK:1n<<21n});
const ALL=(1n<<63n)-1n;
function n(v){return BigInt(v||0);}
function apply(bits,deny,allow){return (bits &~ deny) | allow;}
function calculate(guild,channel,roleIds=[],memberId=null){
  if(!guild||!channel||!Array.isArray(guild.roles)||!Array.isArray(channel.permission_overwrites))throw Error('INSUFFICIENT_SNAPSHOT');
  const everyoneId=String(guild.id||guild.guildId||guild.guild_id||'');
  if(!everyoneId)throw Error('UNKNOWN_GUILD');
  const ids=new Set([everyoneId,...roleIds.map(String)]);
  let base=0n;
  for(const role of guild.roles){if(ids.has(String(role.id)))base|=n(role.permissions);}
  if((base&FLAGS.ADMINISTRATOR)!==0n)return ALL;
  const over=channel.permission_overwrites;
  const ev=over.find(x=>String(x.id)===everyoneId&&Number(x.type)===0);
  if(ev)base=apply(base,n(ev.deny),n(ev.allow));
  let deny=0n,allow=0n;
  for(const x of over){if(Number(x.type)!==0||String(x.id)===everyoneId||!ids.has(String(x.id)))continue;deny|=n(x.deny);allow|=n(x.allow);}
  base=apply(base,deny,allow); // role ALLOW wins over other role DENY by design
  if(memberId){const x=over.find(y=>Number(y.type)===1&&String(y.id)===String(memberId));if(x)base=apply(base,n(x.deny),n(x.allow));}
  return base;
}
function ability(bits,name){return (bits&FLAGS[name])!==0n;}
function audit(guild,channel,roleIds=[],memberId=null){const b=calculate(guild,channel,roleIds,memberId);return Object.fromEntries(Object.keys(FLAGS).map(k=>[k,ability(b,k)]));}
function snapshotReport(snapshot,roleNames=[]){
 const {guild,roles,channels}=snapshot;
 if(!guild||!Array.isArray(roles)||!Array.isArray(channels))throw Error('INVALID_SNAPSHOT');
 const ids=roleNames.map(name=>{const r=roles.find(r=>r.name===name);if(!r)throw Error(`MISSING_ROLE_${name}`);return r.id;});
 const base={id:guild.id,roles};
 return channels.filter(c=>c.type===0||c.type===2).map(ch=>({channel:ch.name,id:ch.id,type:ch.type,...audit(base,ch,ids)}));
}
module.exports={FLAGS,calculate,ability,audit,snapshotReport};
