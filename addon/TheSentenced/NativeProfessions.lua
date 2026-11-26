local _, NS=...
local Native={}
NS.NativeProfessions=Native

local names={
  [164]={'Blacksmithing','Kowalstwo'}, [165]={'Leatherworking','Kaletnictwo'}, [171]={'Alchemy','Alchemia'},
  [182]={'Herbalism','Zielarstwo'}, [186]={'Mining','Górnictwo'}, [197]={'Tailoring','Krawiectwo'},
  [202]={'Engineering','Inżynieria'}, [333]={'Enchanting','Zaklinanie'}, [393]={'Skinning','Skórowanie'},
  [755]={'Jewelcrafting','Jubilerstwo'}, [773]={'Inscription','Inskrypcja'},
}
local shortEnglish={
  [164]='Blacksmith', [165]='Leatherwork', [171]='Alchemy', [182]='Herbalism',
  [186]='Mining', [197]='Tailoring', [202]='Engineering', [333]='Enchanting',
  [393]='Skinning', [755]='Jewelcraft', [773]='Inscription',
}

local function safe(value)
  return not (issecretvalue and issecretvalue(value))
end
local function call(api,name,...)
  local fn=api and api[name]
  if type(fn)~='function' then return end
  local ok,value=pcall(fn,...)
  if ok and safe(value) then return value end
end
local function validName(name)
  return safe(name) and type(name)=='string' and #name>0 and #name<=80 and not name:find('[|%z\001-\031\127]')
end
local function validID(id)
  return safe(id) and type(id)=='number' and id>0 and id==math.floor(id)
end
local function rank(value)
  if safe(value) and type(value)=='number' and value>=0 and value<=10000 and value==math.floor(value) then return value end
end

function Native.own()
  if type(GetProfessions)~='function' or type(GetProfessionInfo)~='function' then return {} end
  local ok,a,b=pcall(GetProfessions)
  if not ok or not safe(a) or not safe(b) then return {} end
  local rows={}
  for _,index in ipairs({a or false,b or false}) do
    if validID(index) then
      local got,name,_,skill,max,_,_,id=pcall(GetProfessionInfo,index)
      if got and validName(name) then
        local known=validID(id) and id or nil
        rows[#rows+1]={name=name,id=known,rank=rank(skill),max=rank(max)}
      end
    end
  end
  return rows
end

local function players(api)
  local club=call(api,'GetGuildClubId')
  if club==nil then return end
  local ids=call(api,'GetClubMembers',club)
  if type(ids)~='table' then return end
  local result={}
  for _,id in ipairs(ids) do
    if safe(id) then
      local info=call(api,'GetMemberInfo',club,id)
      if type(info)=='table' and validName(info.name) then
        local key=info.name:lower()
        if result[key]~=nil then result[key]=false else result[key]=info end
      end
    end
  end
  return result
end
local function professions(info)
  local found={}
  for i=1,2 do
    local field='profession'..i
    local id=info[field..'ID']
    if validID(id) then
      local name=info[field..'Name']
      if not validName(name) then name=names[id] and names[id][1] end
      if name then found[#found+1]={id=id,name=name,rank=rank(info[field..'Rank'])} end
    end
  end
  return found
end
function Native.read(api)
  local result,roster={},players(api)
  if not roster then return end
  for key,info in pairs(roster) do
    if info then
      local labels={}
      for _,entry in ipairs(professions(info)) do labels[#labels+1]=entry.name end
      if #labels>0 then result[key]=table.concat(labels,'; ') end
    end
  end
  return result
end
function Native.member(api,name)
  if not validName(name) then return end
  local roster=players(api)
  local info=roster and roster[name:lower()]
  if not info then return end
  return professions(info),info.guid
end

-- The native roster limit is 31. The tag lets later updates replace only this
-- section. When there is no space, keep the old note until the player accepts
-- the profession-only text in the native note editor.
local marker='[P] '
local function parts(note)
  if not safe(note) or type(note)~='string' then return end
  if note:sub(1,#marker)==marker then return '',note:sub(#marker+1) end
  local manual,tag=note:match('^(.-) / %[P%] (.+)$')
  return manual or note,tag
end
function Native.noteProfessions(note)
  local _,tag=parts(note)
  local rows={}
  if tag then
    for name in tag:gmatch('[^/]+') do
      if validName(name) then rows[#rows+1]=name end
    end
  end
  return rows
end
function Native.noteDraft(note,rows,language)
  local manual=parts(note)
  if manual==nil then return nil,'Klient nie udostępnia obecnej notatki.' end
  local full,compact={},{}
  for _,entry in ipairs(rows) do
    if validName(entry.name) and not entry.name:find('/',1,true) then
      full[#full+1]=entry.name
      local translations=entry.id and names[entry.id]
      compact[#compact+1]=(language=='en' and shortEnglish[entry.id]) or (translations and translations[2]) or entry.name
    end
  end
  if #full==0 then return nil,'Gra nie zwróciła profesji głównych tej postaci.' end
  local tag=marker..table.concat(full,'/')
  if #tag>31 then tag=marker..table.concat(compact,'/') end
  if #tag>31 then return nil,'Nazwy profesji nie mieszczą się w 31 znakach notatki.' end
  if manual=='' then return tag,false end
  local merged=manual..' / '..tag
  if #merged<=31 then return merged,false end
  return tag,true
end

function Native.editOwnNote(api,language)
  local club=call(api,'GetGuildClubId')
  if not club or type(StaticPopup_Show)~='function' then return false,'Edytor notatki gildyjnej jest niedostępny.' end
  local own=call(api,'GetMemberInfoForSelf',club)
  if type(own)~='table' or not safe(own.isSelf) or own.isSelf~=true or not validName(own.guid) then
    return false,'Odśwież roster gildii i spróbuj ponownie.'
  end
  local privileges=call(api,'GetClubPrivileges',club)
  local ownAllowed=type(privileges)=='table' and safe(privileges.canSetOwnMemberNote) and privileges.canSetOwnMemberNote==true
  local publicAllowed=call(_G,'CanEditPublicNote')
  if not ownAllowed and (publicAllowed==false or type(privileges)=='table') and publicAllowed~=true then
    return false,'Ranga w gildii nie pozwala edytować publicznej notatki.'
  end
  if not safe(own.memberNote) then return false,'Gra nie udostępnia obecnej notatki.' end
  local current=own.memberNote or ''
  local draft,replaces=Native.noteDraft(current,Native.own(),language)
  if not draft then return false,replaces end
  if draft==current then return false,'Notatka ma już aktualne profesje.' end
  local ok,dialog=pcall(StaticPopup_Show,'SET_GUILDPLAYERNOTE',nil,nil,{guid=own.guid,currentNote=draft})
  if not ok or not dialog then return false,'Nie udało się otworzyć edytora notatki WoW.' end
  if replaces then return true,'Limit 31 znaków. Akceptacja zastąpi dotychczasową notatkę listą profesji.' end
  return true
end
function Native.canBrowse(guid,id)
  if not validName(guid) or not validID(id) or not (C_GuildInfo and C_GuildInfo.QueryGuildMemberRecipes) then return false end
  -- Follow the game roster: the query starts the request for this member.
  -- CanViewGuildRecipes checks the separate, already-loaded guild recipe list.
  return id~=182 and id~=186 and id~=393
end
function Native.browse(api,name,id)
  local rows,guid=Native.member(api,name)
  for _,entry in ipairs(rows or {}) do
    if entry.id==id and Native.canBrowse(guid,id) then
      local called,result=pcall(C_GuildInfo.QueryGuildMemberRecipes,guid,id)
      return called and (safe(result) and result~=false)
    end
  end
  return false
end
