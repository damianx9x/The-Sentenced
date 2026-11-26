-- Voluntary, short-lived guild readiness. Checklist contents never leave the client.
local _,NS=...
local R={};NS.Ready=R
local cfg,scope,seen={},nil,{}
local TTL=7200
local function now() local n=GetServerTime and GetServerTime() or (time and time()) or 0;return type(n)=='number' and math.floor(n) or 0 end
local function scoped()
 local current=cfg.scope and cfg.scope()
 if current~=scope then scope=current;seen={} end
 return current
end
function R.init(options)
 cfg=options or {};scope=nil;seen={}
 if C_ChatInfo and C_ChatInfo.RegisterAddonMessagePrefix then pcall(NS.Diagnostics and NS.Diagnostics.register or C_ChatInfo.RegisterAddonMessagePrefix,'TSGuildReady') end
end
function R.receive(message,sender)
 if not scoped() or type(message)~='string' or #message>48 or not cfg.member then return false end
 local member=cfg.member(sender);local canonical=member and member.name
 if type(canonical)~='string' then return false end
 local v,state=message:match('^R1|(%d+)|([01])$');v=tonumber(v)
 if not v or v>99999999999999 or v~=math.floor(v) then return false end
 local seconds=math.floor(v/1000);local clock=now()
 if clock<=0 or seconds>clock+300 or seconds<clock-TTL then return false end
 local old=seen[canonical];if old and v<=old.version then return false end
 seen[canonical]={version=v,ready=state=='1',expires=seconds+TTL};return true
end
function R.set(ready)
 if not scoped() or not cfg.me or not cfg.db then return false,'Brak aktualnego rosteru gildii.' end
 local member=cfg.me();local d=cfg.db();local clock=now()
 if not member or type(member.name)~='string' or not d or clock<=0 then return false,'Brak danych postaci lub czasu serwera.' end
 if not C_ChatInfo or not C_ChatInfo.SendAddonMessageLogged then return false,'Wysyłanie dodatku jest niedostępne.' end
 local version=math.max((tonumber(d.readyVersion) or 0)+1,clock*1000);d.readyVersion=version
 local message='R1|'..string.format('%.0f',version)..'|'..(ready and '1' or '0')
 local ok,result=pcall(NS.Diagnostics and NS.Diagnostics.send or C_ChatInfo.SendAddonMessageLogged,'TSGuildReady',message,'GUILD')
 if not ok or type(result)~='number' or result~=0 then return false,'Nie wysłano statusu gotowości.' end
 R.receive(message,member.name)
 return true,'Wysłano status; odbiór przez innych nie jest potwierdzony.'
end
function R.list()
 if not scoped() then return {} end
 local out={};local clock=now()
 for name,value in pairs(seen) do
  if value.ready and value.expires>clock and cfg.member and cfg.member(name) then out[#out+1]={name=name,expires=value.expires} end
 end
 table.sort(out,function(a,b)return a.name:lower()<b.name:lower()end);return out
end
