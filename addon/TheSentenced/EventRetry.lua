-- Bounded, best-effort retransmission of an accepted event and its description.
-- A server acceptance is not delivery confirmation; no acknowledgements are inferred.
local _, NS = ...
local R = {}
NS.EventRetry = R
local queue, active, config = {}, false, nil
local MAX_EVENTS = 8
local function schedule(delay, callback)
  if not (C_Timer and type(C_Timer.After)=='function') then return false end
  return pcall(C_Timer.After, delay, callback)
end
local function scope()
  if not config or type(config.scope)~='function' then return nil end
  local ok,value=pcall(config.scope)
  return ok and value or nil
end
local pump
pump=function()
  local job=queue[1]
  if not job then active=false; return end
  if scope()~=job.scope then queue={}; active=false; return end
  local wait=job.attempts==0 and 5 or 12
  if not schedule(wait,function()
    if queue[1]~=job then return end
    if scope()~=job.scope then queue={}; active=false; return end
    -- Same author's exact event and id, so receivers' existing dedupe applies.
    pcall(config.send,job.payload)
    job.attempts=job.attempts+1
    if job.attempts>=2 then table.remove(queue,1) end
    pump()
  end) then
    queue={}; active=false
  end
end
function R.init(opts)
  queue={}; active=false; config=opts
end
local function eventId(payload)
  if type(payload)~='string' or #payload>230 or payload:find('[%z\001-\031\127]') then return nil end
  return payload:match('^E1|(%d+)|%d+|[^|]+|[^|]+$')
end
function R.enqueue(payload, guild, acceptedEvent)
  if not config or type(config.send)~='function' or type(payload)~='string' or #payload>230
    or payload:find('[%z\001-\031\127]') then return false end
  local id=eventId(payload)
  if not id then
    id=NS.EventSync and NS.EventSync.parseDescription(payload)
    if not id or eventId(acceptedEvent)~=id then return false end
  end
  if not guild or guild~=scope() or not (C_Timer and type(C_Timer.After)=='function') then return false end
  for _,job in ipairs(queue) do if job.payload==payload and job.scope==guild then return true end end
  if #queue>=MAX_EVENTS then return false end
  queue[#queue+1]={payload=payload,scope=guild,id=id,attempts=0}
  if not active then active=true; pump() end
  return active
end
function R.cancel(guild,id)
  local head=queue[1]
  for i=#queue,1,-1 do
    local job=queue[i]
    if job.scope==guild and job.id==id then table.remove(queue,i) end
  end
  if queue[1]~=head then pump() end
end
function R.pending() return #queue end
