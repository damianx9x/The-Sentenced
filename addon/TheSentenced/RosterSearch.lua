-- Search the game's public guild roster; officer-only notes are never used.
local _,NS=...
local Search={};NS.RosterSearch=Search
local accents={['ą']='a',['ć']='c',['ę']='e',['ł']='l',['ń']='n',['ó']='o',['ś']='s',['ź']='z',['ż']='z',
 ['Ą']='a',['Ć']='c',['Ę']='e',['Ł']='l',['Ń']='n',['Ó']='o',['Ś']='s',['Ź']='z',['Ż']='z'}
local function fold(s)
 if issecretvalue and issecretvalue(s) then return '' end
 s=tostring(s or '')
 for a,b in pairs(accents) do s=s:gsub(a,b) end
 return s:lower()
end
function Search.matches(member,raw)
 if type(member)~='table' then return false end
 if issecretvalue and issecretvalue(raw) then return false end
 local q=fold(raw):match('^%s*(.-)%s*$')
 if q=='' then return true end
 local lo,hi=q:match('^(%d+)%s*%-%s*(%d+)$')
 local min=q:match('^>=%s*(%d+)$')
 local max=q:match('^<=%s*(%d+)$')
 local exact=q:match('^(%d+)$')
 if lo or min or max or exact then
  if issecretvalue and issecretvalue(member.level) then return false end
  local level=tonumber(member.level)
  if not level then return false end
  if lo then return level>=tonumber(lo) and level<=tonumber(hi) end
  if min then return level>=tonumber(min) end
  if max then return level<=tonumber(max) end
  return level==tonumber(exact)
 end
 local fields={member.name,member.className,member.zone,member.rank,member.note}
 for i=1,5 do if fold(fields[i]):find(q,1,true) then return true end end
 return false
end
