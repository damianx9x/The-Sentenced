local ns={};assert(loadfile('TheSentenced/ResourceDirectory.lua'))('TheSentenced',ns)
local players={{name='Ala',online=true},{name='Borek',online=false},{name='Celina',online=true}}
local data={Ala={B={items={{id=101,count=3},{id=7,count=1}},received=123}},Borek={B={items={{id=101,count=8}},received=2}},Celina={}}
local profile=function(name)return data[name]end
local label=function(id)return ({[101]='Copper Ore',[7]='Copper Bar'})[id]end
local find=ns.ResourceDirectory.search
local rows,more=find(players,profile,'copper',label,false,200);assert(#rows==3 and not more,'only shared resources')
rows=find(players,profile,'COPPER',label,true,200);assert(#rows==2,'online filter and case-insensitive search')
rows=find(players,profile,'7',label,false,200);assert(#rows==1 and rows[1].id==7,'single-digit item ID')
rows,more=find(players,profile,'copper',label,false,1);assert(#rows==1 and more,'result cap')
data.Ala.B=nil;rows=find(players,profile,'copper',label,true,200);assert(#rows==0,'revocation removes results')
rows=find(players,profile,'',label,false,200);assert(#rows==0,'empty query')
print('RESOURCE_DIRECTORY_OK: shared bags, search, online, cap and revocation')
