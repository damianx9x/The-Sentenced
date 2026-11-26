-- Best effort anti-entropy: re-emit only the player's own guild-scoped records.
-- The same bounded queue serves events, board entries and map markers.
local _, NS = ...
local S = {}; NS.EventSync = S
local config, generation, jobs, running = nil, 0, {}, false
local lastResponse, cursor, started = nil, 0, false
local descriptions = {}
local function after(delay, fn)
  if not C_Timer or type(C_Timer.After)~='function' then return false end
  return pcall(C_Timer.After, delay, fn)
end
local function safeCall(fn, ...)
  if type(fn)~='function' then return nil end
  local ok,result=pcall(fn,...); if ok then return result end
end
local function now() return safeCall(config and config.now) or (GetTime and GetTime()) or 0 end
local function scope() return safeCall(config and config.scope) end
local function same(a,b) return type(a)=='string' and type(b)=='string' and a:lower()==b:lower() end
local function descriptionId(id)
  return type(id)=='string' and #id>0 and #id<=22 and id:match('^%d+$')~=nil
end
local function descriptionBody(body)
  return type(body)=='string' and #body>0 and #body<=160 and not body:find('[|%z\001-\031\127]')
end
-- E1 remains unchanged for older versions; item links use BoardItems' safe tokens.
function S.encodeDescription(id,raw)
  if not descriptionId(id) or type(raw)~='string' or not NS.BoardItems then return nil,'Nieprawidłowy opis.' end
  local body=NS.BoardItems.encode(raw)
  if body=='' then return nil,'Opis jest pusty.' end
  if not descriptionBody(body) then return nil,'Opis może mieć maksymalnie 160 bajtów.' end
  return 'D1|'..id..'|'..body,body
end
function S.parseDescription(message)
  if type(message)~='string' or #message>230 then return end
  local id,body=message:match('^D1|(%d+)|(.+)$')
  if not descriptionId(id) or not descriptionBody(body) then return end
  return id,body
end
local function descriptionKey(sender,id)
  if type(sender)~='string' or #sender<1 or #sender>80 or sender:find('[|%z\001-\031\127]') or not descriptionId(id) then return end
  return sender:lower()..'|'..id
end
-- Caller authenticates sender from the guild roster. Never trust a sender in payload.
-- Descriptions that precede E1 are held briefly, fenced to the current guild.
function S.holdDescription(sender,message)
  local id,body=S.parseDescription(message)
  local key=id and descriptionKey(sender,id)
  local g=scope(); if not key or not g then return false end
  local t=now(); local count=0; local oldest,oldestTime
  for k,v in pairs(descriptions) do
    if v.scope~=g or t<v.time or t-v.time>120 then descriptions[k]=nil
    else count=count+1; if not oldestTime or v.time<oldestTime then oldest,oldestTime=k,v.time end end
  end
  if descriptions[key] then return descriptions[key].body==body end
  if count>=40 and oldest then descriptions[oldest]=nil end
  descriptions[key]={scope=g,time=t,body=body}
  return true
end
function S.takeDescription(sender,id)
  local key=descriptionKey(sender,id); if not key then return end
  local v=descriptions[key]; descriptions[key]=nil
  local t=now()
  if v and v.scope==scope() and t>=v.time and t-v.time<=120 then return v.body end
end
local function emit(payload, expectedScope, prefix)
  if not expectedScope or scope()~=expectedScope then return false end
  return safeCall(config and config.send, payload, prefix)==true
end
local function listOwned()
  local me=safeCall(config and config.selfName)
  local snapshot=safeCall(config and config.snapshot)
  if type(me)~='string' or type(snapshot)~='table' then return {} end
  local rows, seen = {}, {}
  for _,r in ipairs(snapshot) do
    if type(r)=='table' and type(r.key)=='string' and #r.key<=160 and not seen[r.key] and same(r.owner,me)
      and type(r.payload)=='string' and #r.payload<=230 and not r.payload:find('[%z\001-\031\127]') then
      local prefix=r.prefix or 'TSGuildEvent'
      local valid=(prefix=='TSGuildEvent' and (r.payload:match('^E1|%d+|%d+|[^|]+|[^|]+$') or r.payload:match('^R2|[^|]+|%d+|%d+|[A-Z]+$') or r.payload:match('^X1|[^|]+|%d+$') or S.parseDescription(r.payload)))
        or (prefix=='TSGuildHall' and #r.payload<=200 and (r.payload:match('^B1|%d+|[^|]+|[^|]+$') or r.payload:match('^B2|[^|]+|%d+|%d+|[^|]+$') or r.payload:match('^B3|[^|]+|%d+$')))
        or (prefix=='TSGuildFinds' and #r.payload<=200 and r.payload:match('^M2|%d+|%d+|%d+|%d+|%d+|[^|]+$'))
      if valid then rows[#rows+1]={key=r.key,payload=r.payload,prefix=prefix}; seen[r.key]=true end
    end
  end
  table.sort(rows,function(a,b)return a.key<b.key end)
  return rows
end
local pump
pump=function(token, expectedScope)
  if token~=generation then return end
  if scope()~=expectedScope then jobs={}; running=false; return end
  local key=table.remove(jobs,1)
  if not key then running=false; return end
  -- Read the current record just before sending; a newer signup supersedes a queued one.
  for _,r in ipairs(listOwned()) do if r.key==key then emit(r.payload,expectedScope,r.prefix); break end end
  if not after(2,function() pump(token,expectedScope) end) then jobs={}; running=false end
end
function S.init(opts)
  generation=generation+1; config=opts; jobs={}; running=false; lastResponse=nil; cursor=0; started=false; descriptions={}
end
-- Call after roster is ready; no automatic repeated timers are created by this method.
function S.request()
  local g=scope(); if not g then return false end
  return emit('Q1|1',g)
end
-- Start after world entry. One startup request plus a bounded periodic request.
-- When offline or outside a guild, the next tick retries without claiming success.
function S.start()
  if started or not config then return false end
  local token=generation
  local jitter=safeCall(config.jitter) or 0
  if type(jitter)~='number' or jitter<0 or jitter>20 then jitter=0 end
  local function tick()
    if token~=generation then return end
    S.request()
    if not after(300,tick) then started=false end
  end
  if not after(12+jitter,tick) then return false end
  started=true; return true
end
-- Sender must already be resolved to a current guild member by the caller.
function S.receiveQuery(sender)
  local me=safeCall(config and config.selfName); local g=scope(); local t=now()
  if type(sender)~='string' or not me or same(sender,me) or not g or running
    or (lastResponse and t-lastResponse<120) then return false end
  local rows=listOwned(); if #rows==0 then return false end
  local n=math.min(#rows,12); jobs={}
  for i=1,n do local index=(cursor+i-1)%#rows+1; jobs[#jobs+1]=rows[index].key end
  cursor=(cursor+n)%#rows
  running=true; lastResponse=t
  local token=generation
  local jitter=safeCall(config and config.jitter) or 0
  if type(jitter)~='number' or jitter<0 or jitter>20 then jitter=0 end
  if not after(5+jitter,function() pump(token,g) end) then jobs={};running=false;return false end
  return true
end
-- Version check for R2: equal revision/different role is a conflict; never roll back.
function S.mergeRole(previous,role,revision)
  if role~='TANK' and role~='HEAL' and role~='DPS' and role~='NIE' then return nil,'invalid' end
  if type(revision)~='number' or revision~=math.floor(revision) or revision<1 or revision>9007199254740991 then return nil,'invalid' end
  if previous then
    if type(previous.revision)~='number' then return nil,'invalid' end
    if revision<previous.revision then return previous,'stale' end
    if revision==previous.revision then return previous, previous.role==role and 'duplicate' or 'conflict' end
  end
  return {role=role,revision=revision},'accepted'
end
