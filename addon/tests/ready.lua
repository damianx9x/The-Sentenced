local now=1800000000;GetServerTime=function()return now end
local sent={};C_ChatInfo={RegisterAddonMessagePrefix=function()return 0 end,SendAddonMessageLogged=function(prefix,msg,channel)sent[#sent+1]={prefix,msg,channel};return 0 end}
local ns={};assert(loadfile('TheSentenced/Ready.lua'))('TheSentenced',ns)
local scope='guild';local db={};local members={Ala={name='Ala'},Borek={name='Borek'}}
ns.Ready.init({scope=function()return scope end,db=function()return db end,member=function(name)return members[name]end,me=function()return members.Ala end})
local ok=ns.Ready.set(true);assert(ok and #sent==1 and sent[1][1]=='TSGuildReady' and sent[1][3]=='GUILD')
assert(#ns.Ready.list()==1 and ns.Ready.list()[1].name=='Ala')
assert(ns.Ready.receive('R1|1800000000000|1','Borek'));assert(#ns.Ready.list()==2)
assert(not ns.Ready.receive('R1|1800000000000|0','Borek'),'replay must not overwrite')
assert(not ns.Ready.receive('R1|1800000000001|1','Intruder'),'not a guild member')
assert(not ns.Ready.receive('R1|1800000400000|1','Borek'),'future packet')
assert(ns.Ready.set(false));assert(#ns.Ready.list()==1 and ns.Ready.list()[1].name=='Borek')
now=now+7201;assert(#ns.Ready.list()==0,'ready status expires')
assert(not ns.Ready.receive('R1|1800000000002|1','Borek'),'stale packet')
scope='other';assert(#ns.Ready.list()==0,'guild change clears in-memory statuses')
C_ChatInfo.SendAddonMessageLogged=function()return 11 end;assert(not ns.Ready.set(true),'failed send is not reported as success')
print('READY_OK: voluntary status, membership, replay, expiry, guild scope and send failures')
