local _, NS=...
local J={}
NS.LootJournal=J

local function safe(value)
  return not (issecretvalue and issecretvalue(value))
end
local function escape(value)
  return (value:gsub('([%%%^%$%(%)%.%[%]%*%+%-%?])','%%%1'))
end
local function formatPattern(template)
  if type(template)~='string' or not safe(template) then return end
  local chunks,keys,position={}, {}, 1
  while position<=#template do
    local nextToken=template:find('%',position,true)
    if not nextToken then chunks[#chunks+1]=escape(template:sub(position)); break end
    chunks[#chunks+1]=escape(template:sub(position,nextToken-1))
    local tail=template:sub(nextToken)
    local index,kind=tail:match('^%%(%d+)%$([sd])')
    if not kind then kind=tail:match('^%%([sd])') end
    if kind then
      keys[#keys+1]=kind
      chunks[#chunks+1]=kind=='s' and '(.+)' or '(%d+)'
      position=nextToken+(index and #index+3 or 2)
    else
      chunks[#chunks+1]='%%'
      position=nextToken+(tail:sub(1,2)=='%%' and 2 or 1)
    end
  end
  return '^'..table.concat(chunks)..'$',keys
end
local function fields(text,template)
  local matcher,keys=formatPattern(template)
  if not matcher then return end
  local captures={text:match(matcher)}
  local link,count
  for i,key in ipairs(keys) do
    if key=='s' then link=captures[i] else count=captures[i] end
  end
  return link,count
end
function J.parse(text,single,multiple)
  if not safe(text) or type(text)~='string' or #text>1024 then return end
  local link,count=fields(text,multiple)
  if not link then link=fields(text,single) end
  if not link then return end
  local data=link:match('|H(item:%d+[:%d%-]*)|h')
  local id=data and tonumber(data:match('^item:(%d+)'))
  count=tonumber(count) or 1
  if id and id>=1 and id<=100000000 and count>=1 and count<=1000000 then return id,count end
end
local function quality(item)
  local api=C_Item
  if api and type(api.GetItemQualityByID)=='function' then
    local ok,value=pcall(api.GetItemQualityByID,item)
    if ok and safe(value) and type(value)=='number' and value>=0 then return value end
  end
  local getInfo=(api and api.GetItemInfo) or GetItemInfo
  if type(getInfo)=='function' then
    local ok,_,_,value=pcall(getInfo,item)
    if ok and safe(value) and type(value)=='number' and value>=0 then return value end
  end
end
function J.enabled()
  return type(TheSentencedDB)=='table' and TheSentencedDB.lootJournalEnabled~=false
end
local function history()
  local rows=type(TheSentencedDB)=='table' and TheSentencedDB.lootJournal
  return type(rows)=='table' and rows or {}
end
local uncommon=Enum and Enum.ItemQuality and Enum.ItemQuality.Uncommon or 2
function J.entries()
  local visible={}
  for _,entry in ipairs(history()) do
    if type(entry)=='table' and type(entry.item)=='number' and type(entry.time)=='number' and type(entry.count)=='number' then
      local itemQuality=type(entry.quality)=='number' and entry.quality or quality(entry.item)
      if itemQuality and itemQuality>=uncommon then
        visible[#visible+1]={item=entry.item,count=entry.count,time=entry.time,quality=itemQuality}
      end
    end
  end
  return visible
end
function J.wishlist()
  local list=type(TheSentencedDB)=='table' and TheSentencedDB.lootWishlist
  return type(list)=='table' and list or {}
end
function J.toggleWish(item)
  if type(TheSentencedDB)~='table' or type(item)~='number' or item<1 or item>100000000 or item~=math.floor(item) then return nil end
  local list=J.wishlist()
  for i,id in ipairs(list) do
    if id==item then table.remove(list,i); return false end
  end
  if #list>=30 then return nil end
  list[#list+1]=item
  TheSentencedDB.lootWishlist=list
  return true
end

local frame
local pending,seen={},{}
local function save(item,count,t,itemQuality)
  if itemQuality<uncommon or not J.enabled() then return end
  local rows=history()
  local index=1
  while rows[index] and type(rows[index])=='table' and type(rows[index].time)=='number' and rows[index].time>t do index=index+1 end
  table.insert(rows,index,{item=item,count=count,time=t,quality=itemQuality})
  while #rows>100 do table.remove(rows) end
  TheSentencedDB.lootJournal=rows
  if J.onChanged then pcall(J.onChanged) end
end
local function loaded(item,success)
  if not safe(item) or not safe(success) or type(item)~='number' then return end
  local rows=pending[item]
  if not rows then return end
  pending[item]=nil
  if success~=true then return end
  local itemQuality=quality(item)
  local now=GetServerTime and GetServerTime()
  if not itemQuality or not safe(now) or type(now)~='number' then return end
  for _,entry in ipairs(rows) do
    if now-entry.time<=30 then save(item,entry.count,entry.time,itemQuality) end
  end
end
local function loot(text,...)
  local item,count=J.parse(text,LOOT_ITEM_SELF,LOOT_ITEM_SELF_MULTIPLE)
  local now=GetServerTime and GetServerTime()
  if not item or not safe(now) or type(now)~='number' or now<=0 then return end
  local lineID=select(10,...)
  if safe(lineID) and type(lineID)=='number' and lineID>0 then
    for id,t in pairs(seen) do if now-t>30 then seen[id]=nil end end
    if seen[lineID] then return end
    seen[lineID]=now
  end
  local itemQuality=quality(item)
  if itemQuality then save(item,count,now,itemQuality); return end
  if not (C_Item and type(C_Item.RequestLoadItemDataByID)=='function') then return end
  local size=0
  for id,rows in pairs(pending) do
    if now-rows[#rows].time>30 then pending[id]=nil else size=size+#rows end
  end
  if size>=64 then return end
  local rows=pending[item]
  if not rows then rows={}; pending[item]=rows end
  rows[#rows+1]={count=count,time=now}
  if #rows==1 and not pcall(C_Item.RequestLoadItemDataByID,item) then pending[item]=nil end
end
function J.configure()
  if not J.enabled() then
    if frame then
      frame:UnregisterEvent('CHAT_MSG_LOOT')
      frame:UnregisterEvent('ITEM_DATA_LOAD_RESULT')
    end
    pending,seen={},{}
    return
  end
  if not frame then
    frame=CreateFrame('Frame')
    frame:SetScript('OnEvent',function(_,event,...)
      if not J.enabled() then return end
      if event=='CHAT_MSG_LOOT' then loot(...) else loaded(...) end
    end)
  end
  frame:RegisterEvent('CHAT_MSG_LOOT')
  frame:RegisterEvent('ITEM_DATA_LOAD_RESULT')
end
function J.setEnabled(value)
  if type(TheSentencedDB)~='table' then return end
  TheSentencedDB.lootJournalEnabled=value==true
  J.configure()
end
