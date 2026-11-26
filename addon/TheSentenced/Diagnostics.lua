-- Local, bounded diagnostics. Never stores packet bodies, bag contents, gold or guild chat.
local addonName,NS=...
local D={}; NS.Diagnostics=D
local unpackArgs=unpack or table.unpack
local metadata=C_AddOns and C_AddOns.GetAddOnMetadata or GetAddOnMetadata
local version=metadata and metadata(addonName,'Version') or '0.6.39-alpha'
local wireVersion=version:match('^%d+%.%d+%.%d+') or '0.6.39'
local ring,counts,peers,peerOrder={}, {}, {}, {}
local keyCount=0
local snapshot,selfName,window
local lastErrors={}
local epoch=(GetTime and GetTime()) or 0
local probeId,lastProbe,lastReply=nil,nil,{}
local probePeers={}
local lastProbeResponse
local function safe(v) return not (issecretvalue and issecretvalue(v)) end
local function number(v) return safe(v) and type(v)=='number' and v==v and v or nil end
local function clock() return number(GetTime and GetTime()) or 0 end
local function code(v) return safe(v) and type(v)=='string' and v:gsub('[^%w_.:-]','_'):sub(1,100) or 'unknown' end
local function scalar(v)
 if not safe(v) then return 'protected' end
 if type(v)=='number' or type(v)=='boolean' then return tostring(v) end
 if v==nil then return 'nil' end
 return type(v)
end
local function label(sender)
 if type(sender)~='string' or not safe(sender) then return 'unknown' end
 local own=selfName and selfName()
 if own and sender:lower()==own:lower() then return 'self' end
 if not peers[sender] then
  if #peerOrder>=40 then return 'other' end
  peerOrder[#peerOrder+1]=sender; peers[sender]='peer'..#peerOrder
 end
 return peers[sender]
end
function D.mark(key,value)
 key=code(key)
 if not counts[key] then if keyCount>=240 then key='diagnostics.other' else keyCount=keyCount+1 end end
 counts[key]=(counts[key] or 0)+1
 ring[#ring+1]=string.format('%.1f %s %s',math.max(0,clock()-epoch),key,type(value)=='string' and code(value) or scalar(value))
 if #ring>100 then table.remove(ring,1) end
end
function D.error(where,err)
 if not safe(err) then err=nil end
 -- Keep file/line and error class, not arbitrary error text which can contain user data.
 local line=type(err)=='string' and err:match('%.lua:(%d+):') or nil
 local kind='runtime'
 if type(err)=='string' then
  if err:find('nil value',1,true) then kind='nil_value' elseif err:find('function value',1,true) then kind='function_value'
  elseif err:find('bad argument',1,true) then kind='bad_argument' elseif err:find('protected',1,true) then kind='protected'
  elseif err:find('arithmetic',1,true) then kind='arithmetic' end
 end
 local key='error.'..code(where);local value=kind..':line:'..(line or '?')
 if lastErrors[key]==value then counts[key]=(counts[key] or 0)+1;return end
 lastErrors[key]=value;D.mark(key,value)
end
function D.run(where,fn,...)
 local result={pcall(fn,...)}
 if not result[1] then pcall(D.error,where,result[2]); error(result[2],0) end
 return unpackArgs(result,2)
end
function D.send(prefix,payload,channel,...)
 if channel=='GUILD' and NS.GuildAccess and not NS.GuildAccess.isMember() then return 10 end
 local key='tx.protected'
 pcall(function()
  if safe(prefix) and safe(payload) then
   local tag=type(payload)=='string' and payload:match('^(%u%d)|') or nil
   key='tx.'..code(prefix)..'.'..code(tag or 'other')
   D.mark(key..'.try',type(payload)=='string' and #payload or -1)
  else D.mark(key..'.try') end
 end)
 local api=C_ChatInfo and C_ChatInfo.SendAddonMessageLogged
 if type(api)~='function' then D.mark(key..'.unavailable'); error('Addon message API unavailable',0) end
 local frames=NS.Wire and NS.Wire.encode(payload)
 if not frames then error('Invalid or oversized addon message',0) end
 local result
 for _,wire in ipairs(frames) do
  result={pcall(api,prefix,wire,channel,...)}
  if not result[1] then pcall(D.error,key,result[2]); error(result[2],0) end
  pcall(D.mark,key..'.result',scalar(result[2]))
  if type(result[2])~='number' or result[2]~=0 then return unpackArgs(result,2) end
 end
 return unpackArgs(result,2)
end
function D.register(prefix)
 local api=C_ChatInfo and C_ChatInfo.RegisterAddonMessagePrefix
 if type(api)~='function' then pcall(D.mark,'prefix.'..code(prefix)..'.unavailable'); return end
 local ok,result=pcall(api,prefix); pcall(D.mark,'prefix.'..code(prefix),ok and scalar(result) or 'error')
 if not ok then D.error('prefix.'..code(prefix),result); error(result,0) end
 return result
end
function D.rx(event,prefix,payload,channel,sender,known)
 if not safe(prefix) or type(prefix)~='string' or not prefix:match('^TSGuild') then return end
 if not safe(payload) or not safe(sender) or not safe(channel) then D.mark('rx.protected');return end
 local tag=type(payload)=='string' and payload:match('^(%u%d)|') or 'other'
 D.mark('rx.'..code(event)..'.'..code(prefix)..'.'..code(tag or 'other'),label(sender)..':'..code(channel)..':'..(known and 'member' or 'unknown_member'))
end
function D.init(getSnapshot,getSelf)
 snapshot,selfName=getSnapshot,getSelf
 pcall(D.register,'TSGuildDiag')
 pcall(D.mark,'session.ready')
end
function D.probe()
 if lastProbe and clock()-lastProbe<30 then return false,'Poczekaj 30 sekund przed kolejnym testem.' end
 if not (IsInGuild and IsInGuild()) then return false,'Brak gildii.' end
 if not (selfName and selfName()) then return false,'Tożsamość nie jest jeszcze rozpoznana w rosterze.' end
 lastProbe=clock(); probeId=tostring(math.floor(lastProbe*1000))
 local ok,result=pcall(D.send,'TSGuildDiag','D1|'..probeId..'|'..wireVersion,'GUILD')
 D.mark('probe.request',ok and scalar(result) or 'error')
 return ok and number(result)==0,'Wysłano wewnętrzny test. Raport za 15–30 s; przyjęcie wysyłki nie potwierdza odbioru.'
end
function D.receiveProbe(payload,sender,known)
 if not known or type(payload)~='string' or #payload>80 then D.mark('probe.reject'); return end
 if label(sender)=='self' then return end
 local tag,id,version=payload:match('^(D[12])|(%d+)|([%d%.]+)$')
 if not tag or #id>18 or #version>20 then D.mark('probe.invalid'); return end
 if tag=='D2' then
  if id==probeId then probePeers[label(sender)]=version;D.mark('probe.remote_reply',label(sender)..':v'..version) else D.mark('probe.old_reply',label(sender)) end
 elseif not lastReply[sender] or clock()-lastReply[sender]>=10 then
  if lastProbeResponse and clock()-lastProbeResponse<5 then D.mark('probe.reply_rate_limited');return end
  lastProbeResponse=clock()
  if not lastReply[sender] and #peerOrder>=40 then return end
  lastReply[sender]=clock(); D.mark('probe.remote_request',label(sender)..':v'..version)
  pcall(D.send,'TSGuildDiag','D2|'..id..'|'..wireVersion,'GUILD')
 end
end
local function apiFlag(lines,name,value) lines[#lines+1]=name..'='..scalar(value) end
function D.report()
 local lines={'TS_DIAG_BEGIN schema=1 version='..version,'Local diagnostics; packet bodies, gold, items and chat excluded.'}
 if GetBuildInfo then local ok,v,b,_,i=pcall(GetBuildInfo); if ok then lines[#lines+1]='game='..code(v)..' build='..code(b)..' interface='..scalar(i) end end
 lines[#lines+1]='elapsed='..math.floor(math.max(0,clock()-epoch))..'s'
 apiFlag(lines,'inGuild',IsInGuild and IsInGuild())
 if GetNumGuildMembers then local ok,total,online=pcall(GetNumGuildMembers); if ok then apiFlag(lines,'roster.total',total);apiFlag(lines,'roster.online',online) end end
 for _,name in ipairs({'SendAddonMessageLogged','RegisterAddonMessagePrefix','AreOutgoingAddonChatMessagesRestricted'}) do apiFlag(lines,'api.'..name,C_ChatInfo and type(C_ChatInfo[name])=='function') end
 if C_ChatInfo and C_ChatInfo.AreOutgoingAddonChatMessagesRestricted then local ok,result=pcall(C_ChatInfo.AreOutgoingAddonChatMessagesRestricted);lines[#lines+1]='outgoing.restricted='..(ok and scalar(result) or 'error') end
 -- Capability flags only: do not call calendar APIs or inspect any events.
 local calendar=type(C_Calendar)=='table' and C_Calendar or nil
 apiFlag(lines,'api.C_Calendar',calendar~=nil)
 for _,name in ipairs({'OpenCalendar','CreateGuildSignUpEvent','EventSetDate','EventSetTime','AddEvent','GetDayEvent'}) do
  apiFlag(lines,'api.C_Calendar.'..name,calendar~=nil and type(calendar[name])=='function')
 end
 if snapshot then
  local ok,state=pcall(snapshot)
  if ok and type(state)=='table' then local keys={};for k in pairs(state) do keys[#keys+1]=k end;table.sort(keys);for _,k in ipairs(keys) do local v=state[k];lines[#lines+1]=code(k)..'='..(type(v)=='string' and code(v) or scalar(v)) end
  else D.error('snapshot',state);lines[#lines+1]='snapshot=error' end
 end
 local keys={};for k in pairs(counts) do keys[#keys+1]=k end;table.sort(keys)
 local peerKeys={};for k in pairs(probePeers) do peerKeys[#peerKeys+1]=k end;table.sort(peerKeys);for _,k in ipairs(peerKeys) do lines[#lines+1]='probe.'..code(k)..'.version='..code(probePeers[k]) end
 lines[#lines+1]='COUNTERS';for _,k in ipairs(keys) do lines[#lines+1]=k..'='..counts[k] end
 lines[#lines+1]='RECENT (self vs peer aliases, metadata only)';for _,line in ipairs(ring) do lines[#lines+1]=line end
 lines[#lines+1]='TS_DIAG_END'
 return table.concat(lines,'\n')
end
function D.show()
 if not window then
  local p=CreateFrame('Frame','TheSentencedDiagnostics',UIParent,'BackdropTemplate');window=p
  p:SetSize(720,530);p:SetPoint('CENTER');p:SetFrameStrata('FULLSCREEN_DIALOG');p:SetFrameLevel(100);p:SetClampedToScreen(true);p:EnableMouse(true)
  p:SetBackdrop({bgFile='Interface\\Buttons\\WHITE8X8',edgeFile='Interface\\Buttons\\WHITE8X8',edgeSize=1});p:SetBackdropColor(.04,.04,.05,1);p:SetBackdropBorderColor(.7,.4,.2,1)
  local title=p:CreateFontString(nil,'OVERLAY','GameFontNormalLarge');title:SetPoint('TOPLEFT',18,-18);title:SetText('THE SENTENCED — DIAGNOSTYKA')
  local note=p:CreateFontString(nil,'OVERLAY','GameFontHighlightSmall');note:SetPoint('TOPLEFT',18,-45);note:SetWidth(680);note:SetText('Odtwórz problem, odśwież raport, zaznacz i skopiuj Ctrl+C / Cmd+C. Test połączenia nie wysyła tekstu na czat gildii.')
  if NS.Theme then NS.Theme.font(title,17,'body');NS.Theme.font(note,11,'body') end
  local scroll=CreateFrame('ScrollFrame',nil,p,'UIPanelScrollFrameTemplate');scroll:SetPoint('TOPLEFT',18,-78);scroll:SetPoint('BOTTOMRIGHT',-40,65)
  local box=CreateFrame('EditBox',nil,scroll);box:SetMultiLine(true);box:SetAutoFocus(false);box:SetFontObject(ChatFontNormal);if NS.Theme then box:SetFont(NS.Theme.bodyFont,12,'') end;box:SetWidth(645);box:SetMaxLetters(40000)
  box:SetScript('OnEscapePressed',function(self) self:ClearFocus() end);scroll:SetScrollChild(box);p.box=box
  local function action(text,x,w,fn)
   local b=CreateFrame('Button',nil,p,'UIPanelButtonTemplate');b:SetSize(w,30);b:SetPoint('BOTTOMLEFT',x,18);b:SetText(text);if NS.Theme and b.GetFontString then NS.Theme.font(b:GetFontString(),12,'body') end;b:SetScript('OnClick',fn)
  end
  local function refresh()
    local report=D.report();box:SetText(report);local rows=0;for line in report:gmatch('[^\n]+') do rows=rows+math.max(1,math.ceil(#line/78)) end
    box:SetHeight(math.max(350,rows*16));box:SetCursorPosition(0)
  end
  p.refresh=refresh
  action('Odśwież raport',18,145,refresh)
  action('Zaznacz raport',171,145,function() box:SetFocus();box:HighlightText() end)
  action('Test połączenia',324,150,function() local _,message=D.probe();refresh();print('The Sentenced: '..message) end)
  action('Zamknij',550,125,function() p:Hide() end)
  if UISpecialFrames then table.insert(UISpecialFrames,'TheSentencedDiagnostics') end
 end
 window.refresh();window:Show()
end
