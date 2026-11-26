local ns={};assert(loadfile('TheSentenced/CraftDirectory.lua'))('TheSentenced',ns)
local roster={{name='Ala',online=true},{name='Borek',online=false},{name='Celina',online=true}}
local records={Ala={P={professions={'Alchemy 125/300; Herbalism 150/300'},received=17}},Borek={P={professions={'Blacksmithing 200/300'},received=3}},Celina={}}
local get=function(name) return records[name] end
local find=ns.CraftDirectory.search
assert(#find(roster,get,'',false)==2,'only shared professions are listed')
assert(#find(roster,get,'ALCHEMY',true)==1,'search is case insensitive and finds online crafter')
assert(#find(roster,get,'ALCHEMIA',true)==1,'Polish query finds an English-client profession')
assert(#find(roster,get,'ZIELARSTWO',true)==1,'second profession is searchable by Polish name')
assert(#find(roster,get,'KOWALSTWO',false)==1,'offline English profession has a Polish alias')
records.Celina={P={professions={'Górnictwo 150/300'},received=18}}
assert(#find(roster,get,'MINING',true)==1,'English query finds a Polish-client profession')
assert(#find(roster,get,'GÓRNICTWO',true)==1,'uppercase Polish characters are folded')
records.Celina={}
assert(#find(roster,get,'Borek',true)==0,'online filter excludes offline members')
assert(#find(roster,get,'Borek',false)==1,'search includes name')
records.Ala.P=nil
assert(#find(roster,get,'Alchemy',false)==0,'revoked data disappears')
assert(#find({},get,'',false)==0,'empty roster')
local native={ala='Mining; Blacksmithing',borek='Alchemy',celina='Mining'}
local fromGame=find(roster,get,'górnictwo',false,native)
assert(#fromGame==2 and fromGame[1].source=='game','native professions and Polish query')
assert(#find(roster,get,'Borek',true,native)==0,'online filter applies to native data')
records.Ala.P={professions={'Alchemy 10/300'},received=19}
assert(find(roster,get,'Ala',false,native)[1].received==19,'shared snapshot takes priority')
assert(find(roster,get,'kowalstwo',false,native)[1].source=='game','native search still finds newer profession')
print('CRAFT_DIRECTORY_OK: shared data, search, online filter and revocation')
