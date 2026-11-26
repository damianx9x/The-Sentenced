-- Explicit copy/paste bridge: the game cannot contact Discord over HTTP.
local _,NS=...
local T={};NS.TransferSync=T
local serial=0
local staffSnapshot,staffTransfer=nil,{}
local staffOp={['staff.review.list']=true,['staff.review.decide']=true,['staff.post']=true}
local function split(s,delimiter)
 local out={};local start=1
 while true do local a,b=s:find(delimiter,start,true);if not a then out[#out+1]=s:sub(start);break end;out[#out+1]=s:sub(start,a-1);start=b+1 end
 return out
end
local function hex(s)return (s:gsub('.',function(c)return string.format('%02x',c:byte())end))end
local function unhex(s)
 if type(s)~='string' or #s%2~=0 or #s>3200 or s:find('[^%da-fA-F]')then return end
 local v=s:gsub('..',function(c)return string.char(tonumber(c,16))end)
 if v:find('[|%z\001-\031\127]')then return end
 return v
end
local function store()
 TheSentencedDB=TheSentencedDB or {};TheSentencedDB.memberTransfer=TheSentencedDB.memberTransfer or {};return TheSentencedDB.memberTransfer
end
function T.character()
 local name,realm
 if UnitFullName then name,realm=UnitFullName('player') elseif UnitName then name,realm=UnitName('player')end
 if not realm or realm==''then realm=GetNormalizedRealmName and GetNormalizedRealmName()end
 if type(name)~='string' or type(realm)~='string' or name=='' or realm==''then return end
 return name..'-'..realm
end
function T.request(operation,payload)
 if NS.GuildAccess and not NS.GuildAccess.isMember() then return nil,'Połączenie wymaga członkostwa w The Sentenced.' end
 local character=T.character();if not character then return nil,'Nie można odczytać postaci i krainy.'end
 if operation~='snapshot' and operation~='pair' and operation~='raid.signup' and not staffOp[operation] then return nil,'Nieznana operacja.'end
 payload=payload or ''
 if #payload>(operation=='staff.post' and 780 or 200) or payload:find('[|%z\001-\031\127]')then return nil,'Nieprawidłowe dane.'end
 if operation=='pair' and not payload:match('^%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x%x$')then return nil,'Kod parowania ma 18 znaków.'end
 local s=staffOp[operation] and staffTransfer or store();serial=serial+1
 local stamp=GetServerTime and GetServerTime()or time()
 local id=string.format('%08x%08x',stamp%4294967296,(math.random(1,16777215)+serial)%2147483647)
 s.pending={id=id,character=character,operation=operation}
 s.code='TSB1|Q|'..id..'|'..hex(character)..'|'..operation..'|'..payload
 return s.code
end
function T.code(staff) return (staff and staffTransfer or store()).code or '' end
function T.snapshot()
 if NS.GuildAccess and not NS.GuildAccess.isMember() then return nil end
 local snapshot=store().snapshot
 return snapshot and snapshot.character==T.character() and snapshot or nil
end
local function clock()
 return GetServerTime and GetServerTime() or time()
end
function T.staffSnapshot()
 if NS.GuildAccess and not NS.GuildAccess.isMember() then return nil end
 if staffSnapshot and (staffSnapshot.character~=T.character() or clock()-staffSnapshot.generatedAt>600) then staffSnapshot=nil end
 return staffSnapshot
end
local function readStaff(p,character,stamp)
 local page=tonumber(p[6]); local decision=p[8]
 if #p<8 or #p>11 or not page or page<1 or page>1000 or page~=math.floor(page) or
    (p[7]~='0' and p[7]~='1') or (decision~='-' and decision~='APPROVED' and decision~='REJECTED') then return end
 local applications,seen={},{}
 for i=9,#p do
  local wire=split(p[i],':'); local id=wire[1]; local revision=tonumber(wire[2])
  if #id<17 or #id>20 or id:find('%D') or seen[id] or not revision or revision<1 or revision>9999999999 or
     revision~=math.floor(revision) or #wire<4 or #wire>52 or #wire%2~=0 then return end
  seen[id]=true
  local fields={}
  for index=3,#wire,2 do
   local label,value=unhex(wire[index]),unhex(wire[index+1])
   if not label or #label==0 or not value then return end
   fields[#fields+1]={label=label,value=value:gsub('[<>]','')}
  end
  applications[#applications+1]={id=id,revision=revision,name=fields[1].value,fields=fields}
 end
 return {page=page,character=character,generatedAt=stamp,hasMore=p[7]=='1',applications=applications,decision=decision}
end
local function localWire(code)
 if type(code)~='string' or #code>16384 then return end
 local p=split(code,'|')
 if p[1]~='TSB1' then return end
 if p[2]=='E' and #p==4 then return {id=p[3],error=unhex(p[4])} end
 local stamp=tonumber(p[4])
 local character=unhex(p[5])
 local now=clock()
 if not stamp or stamp>now+60 or stamp<now-600 or not character or character~=T.character() then return end
 if p[2]=='P' and #p==6 and #p[6]>=17 and #p[6]<=20 and p[6]:match('^%d+$') then return {id=p[3],posted=p[6]} end
 if p[2]=='K' then return {id=p[3],queue=readStaff(p,character,stamp)} end
end
function T.localStaff()
 if not TheSentencedDB or TheSentencedDB.autoDiscord==false or
    (NS.GuildAccess and not NS.GuildAccess.isMember()) then return end
 local value=NS.CompanionSnapshot and NS.CompanionSnapshot.staff
 if type(value)~='table' then return end
 local snapshot=localWire(value.queue)
 if not snapshot or not snapshot.queue then return end
 local id=T.waitingForStaffBridge()
 local acknowledgement=localWire(value.ack)
 if id and acknowledgement and acknowledgement.id==id then
  TheSentencedDB.staffReviewOutboxV1=nil
  local outcome=acknowledgement.queue and acknowledgement.queue.decision
  staffTransfer.localStatus=outcome=='APPROVED' and 'Bot potwierdził przyjęcie do gildii.'
    or outcome=='REJECTED' and 'Bot potwierdził odrzucenie wniosku.'
    or acknowledgement.posted and 'Bot opublikował wiadomość na Discordzie.'
    or acknowledgement.error or 'Bot zwrócił nieznany stan operacji.'
 end
 return snapshot.queue,staffTransfer.localStatus
end
function T.staffOutboxStatus()
 local outbox=TheSentencedDB and TheSentencedDB.staffReviewOutboxV1
 if type(outbox)~='string' then return end
 local stamp,id=outbox:match('^TSA1|(%d+)|TSB1|Q|(%x+)|')
 if not stamp or #stamp~=10 or #id~=16 then return 'invalid' end
 local age=clock()-tonumber(stamp)
 if age< -60 or age>900 then return 'expired',id end
 return 'waiting',id
end
function T.waitingForStaffBridge()
 local status,id=T.staffOutboxStatus()
 if status=='waiting' then return id end
end
function T.discardStaffOutbox()
 local status=T.staffOutboxStatus()
 if status~='expired' and status~='invalid' then return false end
 TheSentencedDB.staffReviewOutboxV1=nil
 return true
end
local function queueStaffWrite(operation,payload)
 local status=T.staffOutboxStatus()
 if status=='waiting' then return false,'Poprzednia operacja czeka na synchronizator.' end
 if status then return false,'Sprawdź wynik poprzedniej operacji na Discordzie i usuń jej stare żądanie.' end
 local code,errorMessage=T.request(operation,payload)
 if not code then return false,errorMessage end
 TheSentencedDB.staffReviewOutboxV1='TSA1|'..clock()..'|'..code
 return true,'Zapisz i przeładuj grę, aby synchronizator przekazał żądanie.'
end
function T.queueLocalDecision(payload)
 return queueStaffWrite('staff.review.decide',payload)
end
function T.staffPostPayload(channel,body)
 if type(channel)~='string' or not channel:match('^[a-z]+$') or #channel>16 then return nil,'Wybierz kanał Discord.' end
 body=type(body)=='string' and body:match('^%s*(.-)%s*$') or ''
 if body=='' or #body>380 or body:find('[%z\001-\031\127]') then return nil,'Wpisz do 380 bajtów tekstu w jednym wierszu.' end
 return channel..':'..hex(body)
end
function T.queueLocalPost(payload)
 return queueStaffWrite('staff.post',payload)
end
function T.accept(code,staff)
 if NS.GuildAccess and not NS.GuildAccess.isMember() then return false,'Połączenie wymaga członkostwa w The Sentenced.' end
 if type(code)~='string' or #code>16384 then return false,'Kod jest za długi.'end
 code=code:match('^%s*(.-)%s*$'):gsub('||','|');local p=split(code,'|');local s=staff and staffTransfer or store();local pending=s.pending
 if not pending or p[1]~='TSB1' or p[3]~=pending.id then return false,'To nie jest odpowiedź na bieżące żądanie tej postaci.'end
 if p[2]=='E' and #p==4 then
  if staff then staffSnapshot=nil end
  return false,unhex(p[4])or 'Nieprawidłowa odpowiedź.'
 end
 if staff then
  local character,stamp,now=unhex(p[5]),tonumber(p[4]),clock()
  if pending.operation=='staff.post' and p[2]=='P' then
   local publication=localWire(code)
   if not publication or not publication.posted then return false,'Nieprawidłowe potwierdzenie publikacji.' end
   s.pending=nil;s.code=''
   return true,'Bot opublikował wiadomość na Discordzie.'
  end
  if p[2]~='K' or character~=pending.character or character~=T.character() or not stamp or stamp>now+60 or stamp<now-600 then
   return false,'Odpowiedź kadry wygasła albo dotyczy innej postaci.'
  end
  local value=readStaff(p,character,stamp)
  if not value then return false,'Nieprawidłowe dane kadry.' end
  staffSnapshot=value;s.pending=nil;s.code=''
  local status=value.decision=='APPROVED' and 'Bot potwierdził przyjęcie do gildii.' or value.decision=='REJECTED' and 'Bot potwierdził odrzucenie wniosku.' or 'Odczytano aktualną kolejkę wniosków.'
  return true,status
 end
 if p[2]~='S' or #p<7 or #p>17 then return false,'Nieprawidłowy format odpowiedzi.'end
 local stamp=tonumber(p[4]);local character=unhex(p[5]);local label=unhex(p[6]);local now=GetServerTime and GetServerTime()or time()
 if character~=pending.character or character~=T.character()or not label or not stamp or stamp>now+300 or stamp<now-86400 then return false,'Odpowiedź wygasła albo dotyczy innej postaci.'end
 if p[7]~='snapshot' and p[7]~='accepted' and p[7]~='refresh_pending'then return false,'Zmiana nie została potwierdzona przez bota.'end
 local raids={};local ids={}
 for i=8,#p do
  local r=split(p[i],':');local id,when,limit=tonumber(r[1]),tonumber(r[2]),tonumber(r[3]);local title=unhex(r[7]);local revision=r[5]or ''
  if #r~=7 or not id or id<1 or id>100000000 or id~=math.floor(id) or ids[id]or not when or when~=math.floor(when) or when<now-86400 or when>now+5*366*86400 or not limit or limit~=math.floor(limit) or limit<0 or limit>1000 or not title or title=='' or #revision~=64 or revision:find('[^a-f0-9]')or (r[4]~='ACTIVE' and r[4]~='CLOSED')or (r[6]~='' and r[6]~='YES' and r[6]~='MAYBE' and r[6]~='NO')then return false,'Nieprawidłowe dane raidu.'end
  raids[#raids+1]={id=id,when=when,capacity=limit,title=title,status=r[4],revision=revision,ownStatus=r[6]};ids[id]=true
 end
 s.snapshot={generatedAt=stamp,character=character,label=label,raids=raids,status=p[7]};s.pending=nil;s.code='';return true,p[7]=='refresh_pending' and 'Zapisano. Panel Discord czeka na odświeżenie.' or 'Dane i wynik operacji potwierdzone przez bota.'
end
