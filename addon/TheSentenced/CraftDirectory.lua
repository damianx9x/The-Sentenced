-- Directory of voluntarily shared profession snapshots from current guild members.
local _, NS = ...
local Directory = {}
NS.CraftDirectory = Directory

-- Guildmates often use the English client while looking for a profession by
-- its Polish name. Normalise only for searching; keep the original display.
local accents={['ą']='a',['ć']='c',['ę']='e',['ł']='l',['ń']='n',['ó']='o',['ś']='s',['ź']='z',['ż']='z',
  ['Ą']='a',['Ć']='c',['Ę']='e',['Ł']='l',['Ń']='n',['Ó']='o',['Ś']='s',['Ź']='z',['Ż']='z'}
local function fold(value)
  value=tostring(value or '')
  for char,replacement in pairs(accents) do value=value:gsub(char,replacement) end
  return value:lower()
end
local professions={
  {'mining','gornictwo'}, {'blacksmithing','kowalstwo'}, {'herbalism','zielarstwo'},
  {'alchemy','alchemia'}, {'skinning','skornictwo'}, {'leatherworking','kaletnictwo'},
  {'tailoring','krawiectwo'}, {'enchanting','zaklinanie'}, {'engineering','inzynieria'},
  {'fishing','wedkarstwo'}, {'cooking','gotowanie'}, {'first aid','pierwsza pomoc'},
  {'jewelcrafting','jubilerstwo'}, {'inscription','inskrypcja'},
}
local function searchText(member,profession)
  local text=fold(tostring(member.name or '')..' '..profession)
  local result=text
  for _,names in ipairs(professions) do
    if text:find(names[1],1,true) or text:find(names[2],1,true) then result=result..' '..names[1]..' '..names[2] end
  end
  return result
end
function Directory.search(members, profiles, query, onlineOnly, native)
  local rows = {}
  query = type(query) == 'string' and fold(query) or ''
  for _, member in ipairs(members or {}) do
    local record = profiles and profiles(member.name)
    local data = record and record.P
    local matched = false
    if (not onlineOnly or member.online) and data and type(data.professions) == 'table' then
      for _, profession in ipairs(data.professions) do
        if type(profession) == 'string' and profession ~= '' then
          local haystack = searchText(member,profession)
          if query == '' or haystack:find(query, 1, true) then
            rows[#rows + 1] = { member = member, profession = profession, received = data.received }
            matched = true
          end
        end
      end
    end
    if not matched and (not onlineOnly or member.online) and native and type(member.name) == 'string' then
      local profession = native[member.name:lower()]
      if type(profession) == 'string' and (query == '' or searchText(member,profession):find(query,1,true)) then
        rows[#rows + 1] = { member = member, profession = profession, source = 'game' }
      end
    end
  end
  return rows
end
