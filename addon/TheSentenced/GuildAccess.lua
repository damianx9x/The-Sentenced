local _, NS = ...

-- This ID is assigned by WoW to the Forever guild, independent of its display name.
local SENTENCED_CLUB = 215750322
local Access = {}
NS.GuildAccess = Access

function Access.isMember()
  if not C_Club or type(C_Club.GetGuildClubId) ~= 'function' then return false end
  local ok, id = pcall(C_Club.GetGuildClubId)
  return ok and type(id) == 'number' and not (issecretvalue and issecretvalue(id)) and id == SENTENCED_CLUB
end

function Access.scopeId()
  if Access.isMember() then return SENTENCED_CLUB end
end

function Access.snapshot()
  if not Access.isMember() then return nil end
  if type(TheSentencedDB) == 'table' and TheSentencedDB.autoDiscord == false then return nil end
  local value = NS.CompanionSnapshot
  if type(value) ~= 'table' or value.schema ~= 1 or type(value.generatedAt) ~= 'number' or value.generatedAt <= 0 then return nil end
  local now = GetServerTime and GetServerTime() or 0
  if type(now) ~= 'number' or now <= 0 or value.generatedAt > now + 300 or value.generatedAt < now - 86400 then return nil end
  return value
end
