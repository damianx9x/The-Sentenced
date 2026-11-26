-- Read-only view of guild calendar entries from the game client.
local _,NS=...
local M={};NS.GameCalendar=M
local function safe(v)return not (issecretvalue and issecretvalue(v))end
local function integer(v,min,max)return safe(v) and type(v)=='number' and v==math.floor(v) and v>=min and v<=max end
function M.refresh()
 local api=C_Calendar
 if not api or type(api.OpenCalendar)~='function' then return false end
 return pcall(api.OpenCalendar)
end
function M.events()
 local api=C_Calendar
 if not api or type(api.GetNumGuildEvents)~='function' or type(api.GetGuildEventInfo)~='function' then return nil,'unavailable' end
 local ok,count=pcall(api.GetNumGuildEvents)
 if not ok or not integer(count,0,10000) then return nil,'unavailable' end
 local rows={};local incomplete=count>200
 for i=1,math.min(count,200) do
  local good,e=pcall(api.GetGuildEventInfo,i)
  if good and safe(e) and type(e)=='table' and safe(e.title) and type(e.title)=='string' and #e.title>0 and #e.title<=300 and integer(e.year,2000,9999) and integer(e.month,1,12) and integer(e.monthDay,1,31) and integer(e.hour,0,23) and integer(e.minute,0,59) then
   rows[#rows+1]={title=e.title,when=string.format('%04d-%02d-%02d %02d:%02d',e.year,e.month,e.monthDay,e.hour,e.minute)}
  else incomplete=true end
 end
 table.sort(rows,function(a,b)if a.when==b.when then return a.title<b.title end;return a.when<b.when end)
 return rows,incomplete and 'partial' or 'ok'
end

-- The planner records Polish civil time. Translate to an epoch before asking
-- WoW for the matching calendar date, independently of the player's locale.
local function leap(year)
 return year%4==0 and (year%100~=0 or year%400==0)
end
local function daysBefore(year)
 local y=year-1
 return 365*y+math.floor(y/4)-math.floor(y/100)+math.floor(y/400)
end
function M.polishEpoch(value)
 if type(value)~='string' then return end
 local y,m,d,h,mi,zone=value:match('^(%d%d%d%d)%-(%d%d)%-(%d%d) (%d%d):(%d%d) (.+)$')
 if zone~='PL' and zone~='polski' and zone~='czas polski' and zone~='Europe/Warsaw' then return end
 y,m,d,h,mi=tonumber(y),tonumber(m),tonumber(d),tonumber(h),tonumber(mi)
 if not y or y<2000 or not integer(m,1,12) or not integer(h,0,23) or not integer(mi,0,59) then return end
 local months={31,(leap(y) and 29 or 28),31,30,31,30,31,31,30,31,30,31}
 if not integer(d,1,months[m]) then return end
 local first=daysBefore(y)-daysBefore(1970)
 local days=first+d-1
 for i=1,m-1 do days=days+months[i] end
 local function lastSunday(month)
  local day=first-1
  for i=1,month do day=day+months[i] end
  return months[month]-(day+4)%7
 end
 local march,october=lastSunday(3),lastSunday(10)
 if (m==3 and d==march or m==10 and d==october) and h==2 then return end
 local summer=m>3 and m<10 or m==3 and (d>march or d==march and h>=3) or m==10 and (d<october or d==october and h<2)
 return days*86400+(h-(summer and 2 or 1))*3600+mi*60
end

function M.preview(event)
 if type(event)~='table' then return nil,'Wydarzenie nie jest dostępne.' end
 local epoch=M.polishEpoch(event.when)
 if not epoch then return nil,'Potrzebna jest poprawna, jednoznaczna godzina w czasie polskim.' end
 local now=GetServerTime and GetServerTime()
 if not integer(now,1,9999999999) or epoch<=now then return nil,'Wybierz przyszły termin.' end
 if not (C_DateAndTime and C_DateAndTime.GetCalendarTimeFromEpoch) then return nil,'Gra nie udostępnia przeliczenia czasu kalendarza.' end
 local ok,value=pcall(C_DateAndTime.GetCalendarTimeFromEpoch,epoch)
 if not ok or not safe(value) or type(value)~='table' or not integer(value.year,2000,9999) or not integer(value.month,1,12)
  or not integer(value.monthDay,1,31) or not integer(value.hour,0,23) or not integer(value.minute,0,59) then
  return nil,'Nie udało się przeliczyć terminu na kalendarz gry.'
 end
 return value
end

local pending,listener
function M.publish(event,players,result)
 local slot,why=M.preview(event)
 if not slot then return false,why end
 local api=C_Calendar
 if not (api and api.GetEventInfo and api.IsActionPending and api.CreatePlayerEvent and api.EventSetTitle and api.EventSetDate
   and api.EventSetTime and api.EventSetDescription and api.EventInvite and api.CanAddEvent and api.AddEvent and api.CloseEvent) then
  return false,'Gra nie udostępnia tworzenia wydarzeń.'
 end
 if not (C_Timer and C_Timer.After) then return false,'Nie można zweryfikować wyniku w kalendarzu.' end
 if InCombatLockdown and InCombatLockdown() then return false,'Spróbuj po walce.' end
 if pending or api.IsActionPending() or api.GetEventInfo() then return false,'Zamknij bieżące wydarzenie kalendarza i spróbuj ponownie.' end
 if not listener then
  listener=CreateFrame('Frame')
  listener:RegisterEvent('CALENDAR_NEW_EVENT')
  listener:SetScript('OnEvent',function(_,_,isCopy)
   if not isCopy and pending then
    local reply=pending.result
    pending=nil
    reply(true)
   end
  end)
 end
 local started=false
 pending={}
 local request=pending
 request.result=result
 local ok=pcall(function()
  api.CreatePlayerEvent()
  started=true
  api.EventSetTitle(event.title)
  api.EventSetDate(slot.month,slot.monthDay,slot.year)
  api.EventSetTime(slot.hour,slot.minute)
  api.EventSetDescription('The Sentenced • '..event.when)
  for _,name in ipairs(players) do api.EventInvite(name) end
  if not api.CanAddEvent() then error('calendar draft rejected') end
  api.AddEvent()
 end)
 if not ok then
  pending=nil
  if started and not api.IsActionPending() then pcall(api.CloseEvent) end
  return false,'Gra odrzuciła utworzenie wydarzenia w kalendarzu.'
 end
 C_Timer.After(15,function()
  if pending==request then pending=nil; result(false) end
 end)
 return true
end
