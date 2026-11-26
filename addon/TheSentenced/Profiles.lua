-- Bounded, guild-visible snapshots. New users see defaults before any transmission.
local _,NS=...
local P={}; NS.Profiles=P
local cfg,queue,running={}, {},false
local pending={}
local pendingScope
local status='Włączone sekcje profilu synchronizują się automatycznie po zakończeniu konfiguracji.'
local autoStarted,autoScheduled,autoGeneration=false,false,0
local autoLastPublish,autoLastQueryResponse=nil,nil
local autoScope,autoIdentity=nil,nil
local scheduleAuto
local categories={S=true,G=true,B=true,E=true,P=true,A=true}
local function safe(v) return not (issecretvalue and issecretvalue(v)) end
local function whole(v,max)
  return safe(v) and type(v)=='number' and v==math.floor(v) and v>=0 and v<=max
end
local function opts()
  local d=cfg.db and cfg.db(); if not d then return nil end
  d.profileShare=d.profileShare or {}; return d.profileShare
end
local function records()
  local d=cfg.db and cfg.db(); local scope=cfg.scope and cfg.scope()
  if not d or not scope then return nil end
  d.profileRecords=d.profileRecords or {}; d.profileRecords[scope]=d.profileRecords[scope] or {}
  return d.profileRecords[scope]
end
local function nextVersion()
  local d=cfg.db(); local now=(GetServerTime and GetServerTime()) or (time and time()) or 0
  if not whole(now,9999999999) then now=0 end
  d.profileVersion=math.max((tonumber(d.profileVersion) or 0)+1,now*1000)
  return string.format('%.0f',d.profileVersion)
end
function P.init(options)
  cfg=options; autoGeneration=autoGeneration+1; autoStarted=false; autoScheduled=false; autoLastPublish=nil; autoLastQueryResponse=nil; autoScope=nil; autoIdentity=nil
  local d=cfg.db and cfg.db()
  if options.newInstall and d and d.profileShare==nil then
    d.profileShare={S=true,G=true,B=true,E=true,P=true}
    d.profileDefaultsPending=true
  end
  if C_ChatInfo and C_ChatInfo.RegisterAddonMessagePrefix then (NS.Diagnostics and NS.Diagnostics.register or C_ChatInfo.RegisterAddonMessagePrefix)('TSGuildProf') end
end
function P.enabled(cat) local o=opts(); return categories[cat] and o and o[cat]==true or false end
function P.finishSetup()
  local d=cfg.db and cfg.db(); if not d or not d.profileDefaultsPending then return end
  d.profileDefaultsPending=false
  if autoStarted and scheduleAuto then scheduleAuto(2,false) end
end
function P.get(name) local r=records(); return r and r[name] or nil end
-- A character may declare its own main; never infer that two characters
-- belong to the same person. This section is disabled until explicitly shared.
function P.main() local d=cfg.db and cfg.db(); return d and d.profileMain or '' end
function P.setMain(name)
  if type(name)~='string' then return false,'Podaj nazwę postaci.' end
  name=name:match('^%s*(.-)%s*$')
  if name=='' then
    local d=cfg.db and cfg.db(); if not d then return false,'Brak danych postaci.' end
    d.profileMain=nil
    if P.enabled('A') then P.toggle('A') end
    return true,'Usunięto deklarację z tej postaci.'
  end
  if #name>80 or name:find('[|%z\001-\031\127]') then return false,'Nieprawidłowa nazwa postaci.' end
  local resolved=cfg.member and cfg.member(name)
  if not resolved then return false,'Nie znaleziono jednoznacznie tej postaci w rosterze gildii.' end
  local d=cfg.db and cfg.db(); if not d then return false,'Brak danych postaci.' end
  d.profileMain=resolved
  if P.enabled('A') and autoStarted and scheduleAuto then scheduleAuto(2,false) end
  return true,'Zapisano deklarację. Włącz udostępnianie, aby widzieli ją inni.'
end
local function notify(who,cat,revoked)
  if cfg.changed then cfg.changed(who,cat,revoked) end
end
local function parse(cat,body)
  if cat=='G' then
    local n=tonumber(body); if not whole(n,10000000000000) then return end
    return {copper=n}
  elseif cat=='S' then
    local a,b,c,d,e,h=body:match('^(%d+),(%d+),(%d+),(%d+),(%d+),(%d+)$')
    local values={tonumber(a),tonumber(b),tonumber(c),tonumber(d),tonumber(e),tonumber(h)}
    for i=1,6 do if not whole(values[i],1000000000) then return end end
    return {values=values}
  elseif cat=='E' or cat=='B' then
    local items={}
    if body=='-' then return {items=items} end
    if #body>2400 or body:find('[^%d,:]') then return end
    local count=0
    for pair in body:gmatch('[^,]+') do
      local a,b=pair:match('^(%d+):(%d+)$'); a,b=tonumber(a),tonumber(b)
      if cat=='E' then
        if not whole(a,19) or a<1 or not whole(b,100000000) or b<1 then return end
      else
        if not whole(a,100000000) or a<1 or not whole(b,1000000) or b<1 then return end
      end
      count=count+1; if count>120 then return end
      items[#items+1]={id=(cat=='E' and b or a),count=(cat=='B' and b or nil),slot=(cat=='E' and a or nil)}
    end
    if count==0 then return end
    return {items=items}
  elseif cat=='A' then
    if #body<1 or #body>80 or body:find('[|%z\001-\031\127]') then return end
    return {main=body}
  elseif cat=='P' then
    if body=='-' then return {professions={}} end
    if #body>180 or body:find('[|%z\001-\031\127]') then return end
    return {professions={body}}
  end
end
function P.receive(msg,sender)
  if type(msg)~='string' or #msg>230 or not cfg.member then return end
  local who=cfg.member(sender); local store=records()
  if not who or not store then if NS.Diagnostics then pcall(NS.Diagnostics.mark,'drop.profile.member_or_scope') end; return end
  local scope=cfg.scope()
  if pendingScope~=scope then pending={}; pendingScope=scope end
  if msg=='Q1|1' then
    local me=cfg.me and cfg.me()
    if autoStarted and me and type(who)=='string' and who:lower()~=me:lower() then
      local t=(GetTime and GetTime()) or 0
      if type(t)=='number' and (not autoLastQueryResponse or t<autoLastQueryResponse or t-autoLastQueryResponse>=90) then
        autoLastQueryResponse=t
        if scheduleAuto then scheduleAuto(5+(math.random and math.random(0,15) or 0),true) end
      end
    end
    return
  end
  local cat,ver=msg:match('^P0|([SGBEPA])|(%d+)$')
  if cat then
    ver=tonumber(ver); if not whole(ver,99999999999999) then return end
    local person=store[who] or {versions={}}; store[who]=person; person.versions=person.versions or {}
    if ver>(person.versions[cat] or 0) then person[cat]=nil; person.versions[cat]=ver; person[cat..'_revoked']=true; if NS.Diagnostics then pcall(NS.Diagnostics.mark,'accept.profile.revoke.'..cat) end; notify(who,cat,true) end
    return
  end
  local part,total,body
  cat,ver,part,total,body=msg:match('^P1|([SGBEPA])|(%d+)|(%d+)|(%d+)|(.+)$')
  ver,part,total=tonumber(ver),tonumber(part),tonumber(total)
  if not cat or not whole(ver,99999999999999) or not whole(part,16) or not whole(total,16) or part<1 or total<1 or part>total or #body>150 then return end
  local person=store[who] or {versions={}}; store[who]=person; person.versions=person.versions or {}
  if ver<=(person.versions[cat] or 0) then return end
  pending[who]=pending[who] or {}
  local p=pending[who][cat]
  if not p or ver>p.ver then p={ver=ver,total=total,parts={}}; pending[who][cat]=p end
  if ver~=p.ver or total~=p.total or (p.parts[part] and p.parts[part]~=body) then return end
  p.parts[part]=body
  for i=1,total do if not p.parts[i] then return end end
  local data=parse(cat,table.concat(p.parts))
  pending[who][cat]=nil
  if not data then return end
  person[cat]=data; person[cat].received=(GetServerTime and GetServerTime()) or 0
  person.versions[cat]=ver; person[cat..'_revoked']=nil; if NS.Diagnostics then pcall(NS.Diagnostics.mark,'accept.profile.'..cat) end; notify(who,cat,false)
end
local pump
local function push(cat,message,urgent)
  local scope=cfg.scope and cfg.scope()
  if not scope or #queue>=120 or not C_Timer or not C_Timer.After or not C_ChatInfo or not C_ChatInfo.SendAddonMessageLogged or #message>230 then return false end
  local item={cat=cat,msg=message,scope=scope,tries=0,revoked=message:sub(1,2)=='P0'}
  if urgent then table.insert(queue,1,item) else queue[#queue+1]=item end
  if not running then running=true; pump() end
  return true
end
pump=function()
  if #queue==0 then running=false; return end
  local item=queue[1]
  if cfg.scope()~=item.scope or (not item.revoked and (not P.enabled(item.cat) or
    (NS.FeatureEnabled and not NS.FeatureEnabled('autoProfile')))) then table.remove(queue,1)
  else
    -- The restriction flag is not a delivery result for logged guild messages.
    local ok,result=pcall(NS.Diagnostics and NS.Diagnostics.send or C_ChatInfo.SendAddonMessageLogged,'TSGuildProf',item.msg,'GUILD')
    if ok and type(result)=='number' and result==0 then
      table.remove(queue,1)
      local who=cfg.me and cfg.me(); if who then P.receive(item.msg,who) end
      status='Wysłano część profilu. Doręczenie nie jest potwierdzone.'
    else
      item.tries=item.tries+1
      if item.tries>=3 then table.remove(queue,1); status='Nie udało się wysłać części profilu po 3 próbach.' end
    end
  end
  if C_Timer and C_Timer.After then C_Timer.After(1.3,pump) else queue={}; running=false; status='Brak zegara; kolejka przerwana.' end
end
function P.toggle(cat)
  local o=opts(); if not o or not categories[cat] then return false end
  o[cat]=not o[cat]
  if not o[cat] then
    for i=#queue,1,-1 do if queue[i].cat==cat and not queue[i].revoked then table.remove(queue,i) end end
    local d=cfg.db and cfg.db(); if d and d.profileDefaultsPending then return false end
    local version=nextVersion(); local d=cfg.db(); d.profileRevocations=d.profileRevocations or {}; d.profileRevocations[cat]=version
    local msg='P0|'..cat..'|'..version
    local who=cfg.me and cfg.me(); if who then P.receive(msg,who) end
    if not push(cat,msg,true) then status='Sekcja wyłączona lokalnie; nie udało się wysłać prośby o usunięcie kopii.' end
  elseif autoStarted and scheduleAuto then
    scheduleAuto(2,false)
  end
  return o[cat]
end
local function capture(cat)
  if cat=='G' then
    if not GetMoney then return nil end
    local ok,n=pcall(GetMoney); if not ok or not whole(n,10000000000000) then return nil end
    return tostring(n)
  elseif cat=='S' then
    if not UnitStat or not UnitHealthMax then return nil end
    local a={}
    for i=1,5 do
      local ok,base,effective=pcall(UnitStat,'player',i)
      if not ok or not safe(base) or not safe(effective) then return nil end
      local n=effective or base; if not whole(n,1000000000) then return nil end; a[#a+1]=n
    end
    local ok,h=pcall(UnitHealthMax,'player'); if not ok or not whole(h,1000000000) then return nil end; a[#a+1]=h
    return table.concat(a,',')
  elseif cat=='E' then
    if not GetInventoryItemID then return nil end
    local a={}; for slot=1,19 do local ok,id=pcall(GetInventoryItemID,'player',slot); if not ok or not safe(id) then return nil end; if id then if not whole(id,100000000) or id<1 then return nil end; a[#a+1]=slot..':'..id end end
    return #a>0 and table.concat(a,',') or '-'
  elseif cat=='B' then
    if not C_Container or not C_Container.GetContainerNumSlots or not C_Container.GetContainerItemInfo then return nil end
    local sums={}; local count=0
    for bag=0,math.min(NUM_BAG_SLOTS or 4,5) do
      local ok,n=pcall(C_Container.GetContainerNumSlots,bag); if not ok or not whole(n,100) then return nil end
      for slot=1,n do
        local good,info=pcall(C_Container.GetContainerItemInfo,bag,slot)
        if not good or not safe(info) then return nil end
        if info then
          local id,qty=info.itemID,info.stackCount
          if not whole(id,100000000) or id<1 or not whole(qty,1000000) or qty<1 then return nil end
          if not sums[id] then count=count+1; if count>120 then return nil end; sums[id]=0 end
          sums[id]=sums[id]+qty; if sums[id]>1000000 then return nil end
        end
      end
    end
    local ids={}; for id in pairs(sums) do ids[#ids+1]=id end; table.sort(ids)
    local a={}; for _,id in ipairs(ids) do a[#a+1]=id..':'..sums[id] end
    return #a>0 and table.concat(a,',') or '-'
  elseif cat=='A' then
    local value=P.main()
    if type(value)~='string' or #value<1 or #value>80 or value:find('[|%z\001-\031\127]') then return nil end
    return value
  elseif cat=='P' then
    if not GetProfessions or not GetProfessionInfo then return nil end
    local ok,a,b=pcall(GetProfessions); if not ok or not safe(a) or not safe(b) then return nil end
    local lines={}
    for _,index in ipairs({a or false,b or false}) do
      if index then
        local success,name,_,skill,max=pcall(GetProfessionInfo,index)
        if not success or not safe(name) or type(name)~='string' or name:find('[|%z\001-\031\127]') or not whole(skill,10000) or not whole(max,10000) then return nil end
        lines[#lines+1]=name..' '..skill..'/'..max
      end
    end
    local value=#lines>0 and table.concat(lines,'; ') or '-'
    if #value>150 then return nil end
    return value
  end
end
local function split(body)
  local parts={}; local start=1
  while start<=#body do
    local last=math.min(#body,start+149)
    while last<#body and last>=start and body:byte(last+1)>=128 and body:byte(last+1)<=191 do last=last-1 end
    if last<start then return nil end
    parts[#parts+1]=body:sub(start,last); start=last+1
  end
  return parts
end
function P.publish()
  local d=cfg.db and cfg.db()
  if d and d.profileDefaultsPending then return false,'Zakończ konfigurację prywatności.' end
  if not cfg.scope or not cfg.scope() or not cfg.me or not cfg.me() then return false,'Dołącz do gildii i odśwież roster.' end
  local n,skipped=0,0
  for _,cat in ipairs({'S','G','B','E','P','A'}) do
    if P.enabled(cat) then
      local body=capture(cat); local parts=body and split(body)
      if not parts or #parts>16 or #queue+#parts>120 then skipped=skipped+1
      else
        local version=nextVersion(); local sent=true
        for i,part in ipairs(parts) do if not push(cat,table.concat({'P1',cat,version,i,#parts,part},'|'),false) then sent=false; break end end
        if sent then n=n+1 else skipped=skipped+1 end
      end
    end
  end
  if n==0 then return false,skipped>0 and 'Nie udało się odczytać lub wysłać wybranych danych.' or 'Najpierw włącz przynajmniej jedną sekcję.' end
  status='W kolejce: '..n..' sekcji. Pominięte: '..skipped..'. Doręczenie nie jest potwierdzone.'
  return true,status
end
-- Timers and queued sends are fenced by guild. Never read a disabled section.
local function autoNow()
  local t=(GetTime and GetTime()) or 0
  return type(t)=='number' and t or 0
end
scheduleAuto=function(delay,forQuery)
  if NS.FeatureEnabled and not NS.FeatureEnabled('autoProfile') then return false end
  if not autoStarted or autoScheduled or not (C_Timer and C_Timer.After) then return false end
  local guild=cfg.scope and cfg.scope(); if not guild then return false end
  local current=autoNow()
  if not forQuery and autoLastPublish and current>=autoLastPublish then delay=math.max(delay,60-(current-autoLastPublish)) end
  local generation=autoGeneration; autoScheduled=true
  C_Timer.After(math.max(1,delay),function()
    if generation~=autoGeneration then return end
    autoScheduled=false
    if not autoStarted or not cfg.scope or cfg.scope()~=guild then return end
    if NS.FeatureEnabled and not NS.FeatureEnabled('autoProfile') then return end
    local who=cfg.me and cfg.me(); if not who then return end
    -- Repeat opt-out tombstones so a later online peer can remove old snapshots.
    local d=cfg.db and cfg.db(); local revocations=d and d.profileRevocations or {}
    for cat,version in pairs(revocations) do
      if categories[cat] and not P.enabled(cat) and type(version)=='string' and version:match('^%d+$') then
        push(cat,'P0|'..cat..'|'..version,true)
      end
    end
    P.publish(); autoLastPublish=autoNow()
  end)
  return true
end
function P.startAuto()
  if autoStarted or not (C_Timer and C_Timer.After) then return false end
  autoStarted=true; autoScope=cfg.scope and cfg.scope(); autoIdentity=cfg.me and cfg.me(); local generation=autoGeneration
  scheduleAuto(8+(math.random and math.random(0,12) or 0),true)
  local function query()
    if generation~=autoGeneration or not autoStarted then return end
    local guild=cfg.scope and cfg.scope(); local who=cfg.me and cfg.me()
    if (not NS.FeatureEnabled or NS.FeatureEnabled('autoProfile')) and guild and who and C_ChatInfo and C_ChatInfo.SendAddonMessageLogged then
      local ok,result=pcall(NS.Diagnostics and NS.Diagnostics.send or C_ChatInfo.SendAddonMessageLogged,'TSGuildProf','Q1|1','GUILD')
      if not ok or type(result)~='number' or result~=0 then status='Gra nie przyjęła pytania o profile; ponowimy je automatycznie.' end
    end
    C_Timer.After(300,query)
  end
  C_Timer.After(12+(math.random and math.random(0,20) or 0),query)
  return true
end
function P.resumeAuto()
  if autoStarted then return scheduleAuto(2,true) end
  return P.startAuto()
end
-- Restart both automatic timers when the guild or resolved character identity changes.
function P.guildChanged()
  if not autoStarted then return P.startAuto() end
  local guild=cfg.scope and cfg.scope(); local who=cfg.me and cfg.me()
  if guild==autoScope and who==autoIdentity then return false end
  autoGeneration=autoGeneration+1; autoStarted=false; autoScheduled=false
  autoLastPublish=nil; autoLastQueryResponse=nil
  return P.startAuto()
end
function P.changedLocal(event,unit)
  if not autoStarted then return end
  local cats={BAG_UPDATE_DELAYED='B',PLAYER_EQUIPMENT_CHANGED='E',PLAYER_MONEY='G',UNIT_STATS='S',UNIT_MAXHEALTH='S',SKILL_LINES_CHANGED='P'}
  local cat=cats[event]; if not cat or ((event=='UNIT_STATS' or event=='UNIT_MAXHEALTH') and unit~='player') then return end
  if P.enabled(cat) then scheduleAuto(10,false) end
end
function P.status() return status..' W kolejce wiadomości: '..#queue end
