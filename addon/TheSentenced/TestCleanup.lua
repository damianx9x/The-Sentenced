-- One-time cleanup of identified test records, scoped to the original guild.
-- IDs and authors are exact; player-entered text is never used as a filter.
local _,NS=...
local C={}; NS.TestCleanup=C
local scope='the sentenced@camwoweu5realm5pve'
local ids={
 ['Icex Jenkins']={['17940670040005']='F',['17941335660001']='E',['17941338060002']='E',['17941383790003']='E',['17944044640012']='R'},
 ['Icex Thebankier']={['17944050290001']='B'},

}
-- Repeated demonstration announcements and live QA records, identified before release.
for _,id in ipairs({'17940727440003','17940727460004','17940727460005','17940727470006','17940727470007','17940727470008','17940727480009','17940727480010','17940727480011'}) do ids['Icex Jenkins'][id]='B' end
ids['Icex Jenkins']['991111202601']='E'
ids['Icex Jenkins']['991111202602']='F'
ids['Icex Jenkins']['991111202603']='F'
ids['Icex Thebankier']['991111202604']='F'
local function scoped(s) return type(s)=='string' and s:lower():gsub('%s+','')==scope:gsub('%s+','') end
local function isTest(s,author,id,kind)
 return scoped(s) and ids[author] and ids[author][id]==kind or false
end
function C.block(s,prefix,msg,sender)
 if not scoped(s) or type(msg)~='string' then return false end
 local tag,id=msg:match('^(%u%d)|(%d+)|')
 if prefix=='TSGuildHall' then
  if tag=='B1' then return isTest(s,sender,id,'B') end
  local author,parent,reply=msg:match('^B2|([^|]+)|(%d+)|(%d+)|')
  return (author and isTest(s,author,parent,'B')) or (reply and isTest(s,sender,reply,'R')) or false
 elseif prefix=='TSGuildFinds' then return id and isTest(s,sender,id,'F') or false
 elseif prefix=='TSGuildEvent' then
  if tag=='E1' or tag=='D1' then return id and isTest(s,sender,id,'E') or false end
  local author,event=msg:match('^R[12]|([^|]+)|(%d+)|')
  return author and isTest(s,author,event,'E') or false
 end
 return false
end
function C.run(db)
 if type(db)~='table' then return end
 db._liveQA=nil; db._liveSend=nil
 for k,b in pairs(db.boards or {}) do if scoped(k) and type(b.items)=='table' then
  for i=#b.items,1,-1 do local e=b.items[i]
   if isTest(k,e.sender,e.id,'B') then table.remove(b.items,i)
   else for j=#(e.replies or {}),1,-1 do local r=e.replies[j]; local id=type(r.key)=='string' and r.key:match('|(%d+)$'); if isTest(k,r.sender,id,'R') then table.remove(e.replies,j) end end end
  end
 end end
 for k,p in pairs(db.planners or {}) do if scoped(k) and type(p.items)=='table' then for key,e in pairs(p.items) do if isTest(k,e.author,e.id,'E') then p.items[key]=nil end end end end
 for k,f in pairs(db.finds or {}) do if scoped(k) and type(f.items)=='table' then for key,e in pairs(f.items) do if isTest(k,e.author,e.id,'F') then f.items[key]=nil end end end end
 for _,list in ipairs({db.manualNodes or {},db.autoNodes or {}}) do for i=#list,1,-1 do local e=list[i]; if (e.scope==nil or scoped(e.scope)) and ids[e.author] and ids[e.author][e.id]=='F' then table.remove(list,i) end end end
 for k,a in pairs(db.archives or {}) do if scoped(k) and type(a.records)=='table' then for i=#a.records,1,-1 do local r=a.records[i]; local prefix=({B='TSGuildHall',E='TSGuildEvent',F='TSGuildFinds'})[r.tag]; if prefix and C.block(k,prefix,r.payload,r.origin) then table.remove(a.records,i) end end end end
end
