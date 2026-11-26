-- Best-effort, untrusted peer archive. It never changes planner, map or loot state.
local _,NS=...
local A={}
NS.Archive=A
local prefix='TSGuildArc'
local config
local outgoing={}
local pumping=false
local pending
local counter=0
local lastRequest={}
local state='Archiwum lokalne. Kopia od innej osoby nie potwierdza autora.'
local tags={TSGuildHall='B',TSGuildEvent='E',TSGuildFinds='F'}
local validTags={B=true,E=true,F=true}
local function now() return (GetTime and GetTime()) or 0 end
local function store() return config and config.store and config.store() end
local function validString(s,max)
  return type(s)=='string' and #s>0 and #s<=max and not s:find('[%z\001-\031\127]')
end
local function safeOrigin(s) return validString(s,80) and not s:find('|',1,true) end
local function put(tag,origin,payload,via,direct)
  local db=store()
  local channel=({B='TSGuildHall',E='TSGuildEvent',F='TSGuildFinds'})[tag]
  if channel and NS.TestCleanup and NS.TestCleanup.block(config and config.scope(),channel,payload,origin) then return false end
  if not db or not validTags[tag] or not safeOrigin(origin) or not validString(payload,230) then return false end
  db.records=db.records or {}
  for _,record in ipairs(db.records) do
    if record.tag==tag and record.origin==origin and record.payload==payload then
      if direct then record.direct=true; record.via=nil end
      return false
    end
  end
  db.records[#db.records+1]={tag=tag,origin=origin,payload=payload,via=direct and nil or via,direct=direct and true or false}
  while #db.records>150 do table.remove(db.records,1) end
  return true
end
function A.init(opts)
  config=opts
  if C_ChatInfo and C_ChatInfo.RegisterAddonMessagePrefix then (NS.Diagnostics and NS.Diagnostics.register or C_ChatInfo.RegisterAddonMessagePrefix)(prefix) end
end
function A.recordDirect(channel,payload,origin)
  local tag=tags[channel]
  if tag then put(tag,origin,payload,nil,true) end
end
-- Do not split a UTF-8 sequence between protocol fragments.
local function chunks(s)
  local result={}; local start=1
  while start<=#s do
    local last=math.min(#s,start+94)
    while last<#s and last>=start and s:byte(last+1)>=128 and s:byte(last+1)<=191 do last=last-1 end
    if last<start then return nil end
    result[#result+1]=s:sub(start,last); start=last+1
  end
  return result
end
local pump
local function sendRaw(msg)
  if not C_ChatInfo or not C_ChatInfo.SendAddonMessageLogged then return false end
  -- Trust the logged API's result; the restriction flag is not a delivery result.
  local ok,result=pcall(NS.Diagnostics and NS.Diagnostics.send or C_ChatInfo.SendAddonMessageLogged,prefix,msg,'GUILD')
  return ok and type(result)=='number' and result==0
end
pump=function()
  if #outgoing==0 then pumping=false; return end
  local e=outgoing[1]
  if not config or config.scope()~=e.scope then
    outgoing={}; pumping=false; state='Gildia zmieniona — przerwano wysyłanie archiwum.'; return
  end
  if sendRaw(e.message) then table.remove(outgoing,1)
  else
    e.attempts=e.attempts+1
    if e.attempts>=3 then table.remove(outgoing,1); state='Nie udało się wysłać części archiwum; odbiorca może mieć braki.' end
  end
  if not C_Timer or not C_Timer.After then
    outgoing={}; pumping=false; state='Brak zegara — przerwano wysyłanie archiwum.'; return
  end
  C_Timer.After(1.3,pump)
end
function A.request(target)
  if not config then return false,'Archiwum nie jest gotowe.' end
  local who=config.member(target)
  local self=config.selfName()
  if not who or not self then return false,'Wybierz nick z wczytanego rosteru.' end
  if who:lower()==self:lower() then return false,'Wskaż inną osobę z gildii.' end
  local scope=config.scope(); if not scope then return false,'Brak gildii.' end
  if pending and pending.deadline>now() then return false,'Poprzednia prośba jeszcze trwa. Wybierz WYCZYŚĆ PROŚBĘ, aby ją przerwać.' end
  counter=counter+1
  local stamp=(GetServerTime and GetServerTime()) or (time and time()) or 0
  local id=tostring(stamp)..string.format('%04d',counter%10000)
  pending={id=id,peer=who,scope=scope,deadline=now()+900,parts={},done={},received=0}
  if not sendRaw('R|'..id..'|'..who) then pending=nil; return false,'Nie wysłano prośby. Spróbuj poza instancją.' end
  state='Prośba wysłana do '..who..'. Odbiór może potrwać kilka minut; autorzy nie są zweryfikowani.'
  return true
end
function A.cancel() pending=nil; state='Prośba anulowana lokalnie. Wysyłający może nadal wysyłać swoją kolejkę.' end
local function respond(id,requester)
  if pumping or #outgoing>0 then return end
  local t=now()
  if lastRequest[requester] and t-lastRequest[requester]<60 then return end
  local db=store(); local self=config.selfName(); local scope=config.scope()
  if not db or not self or not scope then return end
  if not C_Timer or not C_Timer.After then state='Brak zegara do wysłania archiwum.'; return end
  lastRequest[requester]=t
  local n=0
  for _,r in ipairs(db.records or {}) do
    local pieces=chunks(r.payload)
    if pieces and #pieces<=3 and safeOrigin(r.origin) and validTags[r.tag] and validString(r.payload,230) then
      n=n+1
      for i,part in ipairs(pieces) do
        local message=table.concat({'D',id,n,i,#pieces,r.tag,r.origin,part},'|')
        if #message<=230 then outgoing[#outgoing+1]={scope=scope,message=message,attempts=0} end
      end
    end
  end
  outgoing[#outgoing+1]={scope=scope,message=table.concat({'Z',id,n},'|'),attempts=0}
  state='Wysyłanie kopii do '..requester..': '..n..' zapisów. Kolejka znika po /reload.'
  pumping=true; pump()
end
function A.event(p,msg,channel,sender)
  if p~=prefix or channel~='GUILD' or not config or type(msg)~='string' or #msg>230 then return end
  local source=config.member(sender); if not source then return end
  local id,target=msg:match('^R|(%d+)|([^|]+)$')
  if id then
    local self=config.selfName()
    if #id<=22 and self and target:lower()==self:lower() and source:lower()~=self:lower() then respond(id,source) end
    return
  end
  if not pending or pending.deadline<now() or pending.scope~=config.scope() or source:lower()~=pending.peer:lower() then return end
  local doneId,total=msg:match('^Z|(%d+)|(%d+)$')
  if doneId then
    total=tonumber(total)
    if doneId==pending.id and total and total<=150 then
      pending.total=total
      state='Odebrano '..pending.received..' z '..total..' zapisów zadeklarowanych przez '..source..'. To nie potwierdza autorów.'
      if pending.received>=total then pending=nil end
    end
    return
  end
  local rid,index,part,parts,tag,origin,body=msg:match('^D|(%d+)|(%d+)|(%d+)|(%d+)|([BEF])|([^|]+)|(.+)$')
  index,part,parts=tonumber(index),tonumber(part),tonumber(parts)
  if not rid or rid~=pending.id or not index or index<1 or index>150 or not part or not parts or parts<1 or parts>3 or part<1 or part>parts or not safeOrigin(origin) or not validString(body,95) then return end
  if pending.done[index] then return end
  local bucket=pending.parts[index]
  if not bucket then bucket={tag=tag,origin=origin,total=parts,chunks={}}; pending.parts[index]=bucket end
  if bucket.tag~=tag or bucket.origin~=origin or bucket.total~=parts then pending.parts[index]=nil; return end
  if bucket.chunks[part] and bucket.chunks[part]~=body then pending.parts[index]=nil; return end
  bucket.chunks[part]=body
  for i=1,parts do if not bucket.chunks[i] then return end end
  local payload=table.concat(bucket.chunks)
  if validString(payload,230) then
    put(tag,origin,payload,source,false)
    pending.done[index]=true; pending.received=pending.received+1
    if pending.total then
      state='Odebrano '..pending.received..' z '..pending.total..' zapisów zadeklarowanych przez '..source..'. To nie potwierdza autorów.'
      if pending.received>=pending.total then pending=nil; return end
    end
  end
  pending.parts[index]=nil
end
function A.status()
  if pending and pending.deadline<now() then
    state='Czas oczekiwania minął. Otrzymano '..pending.received..' zapisów; możliwe braki. Możesz ponowić prośbę.'
    pending=nil
  end
  return state
end
function A.records() local db=store(); return db and db.records or {} end
