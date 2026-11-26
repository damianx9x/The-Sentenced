local addonName, NS = ...
-- Snapshot contains only public guild roster fields; no officer notes or secrets.
local C = {}
NS.RosterCapture = C
local classes={WARRIOR='Warrior',PALADIN='Paladin',HUNTER='Hunter',ROGUE='Rogue',PRIEST='Priest',SHAMAN='Shaman',MAGE='Mage',WARLOCK='Warlock',DRUID='Druid'}
local function hex(value)
  if type(value)~='string' or #value>120 then return nil end
  return (value:gsub('.',function(c) return string.format('%02X',string.byte(c)) end))
end
function C.encode(guild,stamp,rows)
  local g=hex(guild);if not g or g=='' or type(stamp)~='number' or stamp<1 or type(rows)~='table' or #rows<1 or #rows>5000 then return nil end
  local out={'TSR2',tostring(math.floor(stamp)),g,tostring(#rows)};local seen={}
  for _,r in ipairs(rows) do
    local name=hex(r.name);local class=classes[r.class];local rank=hex(r.rank or '');local level=r.level
    if not name or name=='' or not class or not rank or seen[name] or type(level)~='number' or level<1 or level>1000 or level~=math.floor(level) then return nil end
    seen[name]=true;out[#out+1]=name..':'..class..':'..level..':'..rank
  end
  return table.concat(out,'|')
end
function C.snapshot()
  if NS.GuildAccess and not NS.GuildAccess.isMember() then return false end
  if not IsInGuild or not IsInGuild() or not GetGuildInfo or not GetNumGuildMembers or not GetGuildRosterInfo then return false end
  local guild=GetGuildInfo('player');local count=GetNumGuildMembers() or 0
  if type(guild)~='string' or count<1 or count>5000 then return false end
  local rows={}
  for i=1,count do
    local name,rank,_,level,_,_,_,_,_,_,class=GetGuildRosterInfo(i)
    if issecretvalue and (issecretvalue(name) or issecretvalue(class) or issecretvalue(rank) or issecretvalue(level)) then return false end
    if type(name)~='string' or not classes[class] then return false end
    rows[#rows+1]={name=name,class=class,level=level,rank=rank}
  end
  local stamp=GetServerTime and GetServerTime() or time()
  local data=C.encode(guild,stamp,rows)
  if not data or type(TheSentencedGuildDB)~='table' then return false end
  TheSentencedGuildDB.rosterExportV1=data
  return true
end
if CreateFrame then
 local frame=CreateFrame('Frame');frame:RegisterEvent('GUILD_ROSTER_UPDATE');frame:RegisterEvent('PLAYER_ENTERING_WORLD')
 frame:SetScript('OnEvent',function(_,event)
  if event=='PLAYER_ENTERING_WORLD' and C_GuildInfo and C_GuildInfo.GuildRoster and IsInGuild and IsInGuild() then pcall(C_GuildInfo.GuildRoster) end
  if event=='GUILD_ROSTER_UPDATE' then pcall(C.snapshot) end
 end)
end
