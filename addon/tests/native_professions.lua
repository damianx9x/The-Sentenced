local ns={};assert(loadfile('TheSentenced/NativeProfessions.lua'))('TheSentenced',ns)
local people={
  [1]={name='Ala',profession1ID=186,profession2ID=164},
  [2]={name='Borek',profession1ID=999999,profession2ID=171},
  [3]={name='Dup',profession1ID=186}, [4]={name='DUP',profession1ID=164},
}
local api={GetGuildClubId=function() return 12 end,GetClubMembers=function() return {1,2,3,4,5} end,
  GetMemberInfo=function(_,id) if id==5 then error('unavailable') end return people[id] end}
local rows=ns.NativeProfessions.read(api)
assert(rows.ala=='Mining; Blacksmithing' and rows.borek=='Alchemy')
assert(rows.dup==nil,'ambiguous names are excluded')
assert(ns.NativeProfessions.read({})==nil,'unsupported API')
api.GetClubMembers=function() error('not ready') end
assert(ns.NativeProfessions.read(api)==nil,'API errors must not break the UI')
api.GetClubMembers=function() return {1} end
issecretvalue=function(value) return value==186 end
assert(ns.NativeProfessions.read(api).ala=='Blacksmithing','secret values are not exposed')
issecretvalue=nil
print('NATIVE_PROFESSIONS_OK')
local N=ns.NativeProfessions
people[1].profession1Name='Górnictwo'
people[1].profession1Rank=200
people[1].profession2Rank=125
people[1].guid='Player-100-001'
local profs,guid=N.member(api,'ALA')
assert(guid=='Player-100-001' and profs[1].name=='Górnictwo' and profs[1].rank==200)
local query
C_GuildInfo={QueryGuildMemberRecipes=function(guid,id) query={guid,id} end}
CanViewGuildRecipes=function() return false end -- The guild-wide recipe cache is still unloaded.
assert(N.browse(api,'Ala',164) and query[1]=='Player-100-001' and query[2]==164)
assert(not N.browse(api,'Ala',186),'gathering does not pretend to have shared recipes')
assert(not N.browse(api,'Inny',164),'only the selected guild member can be queried')
local rows={{name='Mining',id=186},{name='Alchemy',id=171}}
assert(N.noteDraft('',rows,'pl')=='[P] Mining/Alchemy')
assert(N.noteDraft('Alt / [P] Enchanting',rows,'pl')=='Alt / [P] Mining/Alchemy')
assert(N.noteDraft('Alt',rows,'pl')=='Alt / [P] Mining/Alchemy')
local long,replace=N.noteDraft('To jest długa notatka gracza',rows,'pl')
assert(long=='[P] Mining/Alchemy' and replace==true,'long note requires the native confirmation before replacing')
assert(#N.noteProfessions(long)==2 and N.noteProfessions(long)[2]=='Alchemy')
assert(not N.noteDraft('',{},'pl'),'unloaded professions do not erase notes')
local compact=N.noteDraft('',{{name='Blacksmithing',id=164},{name='Leatherworking',id=165}},'en')
assert(compact=='[P] Blacksmith/Leatherwork')
GetProfessions=function() return nil,2 end
GetProfessionInfo=function() return 'Mining',nil,200,300,0,0,186 end
api.GetMemberInfoForSelf=function()return {guid='Player-100-001',isSelf=true,memberNote='Alt'} end
api.GetClubPrivileges=function() return {canSetOwnMemberNote=true} end
local draft
StaticPopup_Show=function(dialog,_,_,data) assert(dialog=='SET_GUILDPLAYERNOTE');draft=data;return {} end
assert(N.editOwnNote(api,'pl') and draft.guid=='Player-100-001' and draft.currentNote=='Alt / [P] Mining')
api.GetMemberInfoForSelf=function()return {guid='Player-100-001',isSelf=false,memberNote='Alt'} end
assert(not N.editOwnNote(api,'pl'),'the note editor never targets another player')
api.GetMemberInfoForSelf=function()return {guid='Player-100-001',isSelf=true,memberNote='Alt'} end
api.GetClubPrivileges=function() return {canSetOwnMemberNote=false} end
assert(not N.editOwnNote(api,'pl'),'permissions block use')
print('PROFESSION_NOTE_AND_BROWSE_OK')
