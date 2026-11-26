local _, NS = ...

-- Decorative, non-interactive notice. Delivery/deduplication belong to the
-- event protocol; this module never treats a send as an acknowledgement.
local MAX_PENDING, DURATION, TTL = 6, 5, 30
local queue, driver, banner, current = {}, nil, nil, nil
local elapsed, logicalClock = 0, 0

local function gameClock()
  if type(GetTime)~='function' then return nil end
  local ok, value=pcall(GetTime)
  if not ok or (issecretvalue and issecretvalue(value)) or type(value)~='number' or value~=value or value<0 or value==math.huge then return nil end
  return value
end

local function expired(entry, now)
  if entry.gameTime and now and now>=entry.gameTime then return now-entry.gameTime>=TTL end
  return logicalClock-entry.logicalTime>=TTL
end

local function plain(value, limit)
  if issecretvalue and issecretvalue(value) then return '' end
  if type(value) ~= 'string' then return '' end
  value = value:gsub('[%z\001-\031\127|]', '')
  if #value <= limit then return value end
  -- Do not split a UTF-8 character when shortening a player-supplied title.
  local cut = limit
  while cut > 0 do
    local c = value:byte(cut + 1)
    if not c or c < 128 or c >= 192 then break end
    cut = cut - 1
  end
  return value:sub(1, cut) .. '…'
end

local function inCombat()
  if type(InCombatLockdown) ~= 'function' then return false end
  local ok, result = pcall(InCombatLockdown)
  return not ok or result == true
end

local function solid(parent, layer, r, g, b, a)
  local t = parent:CreateTexture(nil, layer)
  t:SetColorTexture(r, g, b, a)
  return t
end

local function makeBanner()
  local f = CreateFrame('Frame', nil, UIParent, 'BackdropTemplate')
  f:SetSize(400, 94)
  f:SetPoint('TOP', UIParent, 'TOP', 0, -138)
  f:SetFrameStrata('HIGH')
  f:EnableMouse(false)
  f:SetBackdrop({bgFile='Interface\\Buttons\\WHITE8X8', edgeFile='Interface\\Buttons\\WHITE8X8', edgeSize=1})
  f:SetBackdropColor(.075,.055,.05,.97)
  f:SetBackdropBorderColor(.67,.46,.25,1)

  local rail=solid(f,'ARTWORK',.52,.16,.12,1)
  rail:SetPoint('TOPLEFT',f,'TOPLEFT',1,-1); rail:SetPoint('BOTTOMLEFT',f,'BOTTOMLEFT',1,1); rail:SetWidth(5)
  local crest=CreateFrame('Frame',nil,f,'BackdropTemplate')
  crest:SetSize(47,50); crest:SetPoint('LEFT',f,'LEFT',17,0); crest:EnableMouse(false)
  crest:SetBackdrop({bgFile='Interface\\Buttons\\WHITE8X8',edgeFile='Interface\\Buttons\\WHITE8X8',edgeSize=1})
  crest:SetBackdropColor(.08,.04,.03,1); crest:SetBackdropBorderColor(.76,.55,.31,1)
  local emblem=crest:CreateTexture(nil,'ARTWORK'); emblem:SetPoint('TOPLEFT',2,-2); emblem:SetPoint('BOTTOMRIGHT',-2,2)
  emblem:SetTexture('Interface\\AddOns\\TheSentenced\\Textures\\GuildCrest.tga')

  f.heading=f:CreateFontString(nil,'OVERLAY','GameFontNormal')
  f.heading:SetPoint('TOPLEFT',f,'TOPLEFT',76,-13); f.heading:SetWidth(305); f.heading:SetJustifyH('LEFT')
  f.heading:SetTextColor(.86,.68,.42,1)
  if NS.Theme and NS.Theme.font then NS.Theme.font(f.heading,11,'body') end
  f.name=f:CreateFontString(nil,'OVERLAY','GameFontNormal')
  f.name:SetPoint('TOPLEFT',f,'TOPLEFT',76,-34); f.name:SetWidth(307); f.name:SetJustifyH('LEFT')
  if f.name.SetWordWrap then f.name:SetWordWrap(false) end
  if f.name.SetMaxLines then f.name:SetMaxLines(1) end
  f.name:SetTextColor(.96,.91,.83,1)
  if NS.Theme and NS.Theme.font then NS.Theme.font(f.name,15,'body') end
  f.event=f:CreateFontString(nil,'OVERLAY','GameFontNormal')
  f.event:SetPoint('TOPLEFT',f,'TOPLEFT',76,-59); f.event:SetWidth(307); f.event:SetJustifyH('LEFT')
  if f.event.SetWordWrap then f.event:SetWordWrap(false) end
  if f.event.SetMaxLines then f.event:SetMaxLines(1) end
  f.event:SetTextColor(.72,.68,.61,1)
  if NS.Theme and NS.Theme.font then NS.Theme.font(f.event,11,'body') end
  f.glow=solid(f,'OVERLAY',.83,.55,.27,.8)
  f.glow:SetPoint('BOTTOMLEFT',f,'BOTTOMLEFT',7,1); f.glow:SetHeight(2); f.glow:SetWidth(1)
  f:Hide()
  return f
end

local function update(_, dt)
  local delta=tonumber(dt) or 0
  if delta~=delta or delta<0 or delta==math.huge then delta=0 end
  logicalClock=logicalClock+delta
  local now=gameClock()
  while queue[1] and expired(queue[1],now) do table.remove(queue,1) end
  if current and expired(current,now) then if banner then banner:Hide() end; current=nil end
  if inCombat() then
    if banner then banner:Hide() end
    if not current and #queue==0 then driver:Hide() end
    return
  end
  if not current then
    current=table.remove(queue,1); elapsed=0
    if not current then driver:Hide(); return end
    if not banner then
      local ok, result=pcall(makeBanner)
      if not ok or not result then queue={}; current=nil; driver:Hide(); return end
      banner=result
    end
    banner.heading:SetText(current.preview and 'TEST — NOWY UCZESTNIK' or 'NOWY UCZESTNIK')
    banner.name:SetText(current.name .. '  •  ' .. current.role)
    banner.event:SetText(current.title)
  end
  elapsed=elapsed+math.min(delta,.25)
  if elapsed >= DURATION then
    banner:Hide(); current=nil
    if #queue==0 then driver:Hide() end
    return
  end
  local fadeIn=math.min(1,elapsed/.38)
  local fadeOut=math.min(1,(DURATION-elapsed)/.65)
  banner:SetAlpha(math.min(fadeIn,fadeOut))
  banner:ClearAllPoints()
  banner:SetPoint('TOP',UIParent,'TOP',0,-138-(1-fadeIn)*14)
  banner.glow:SetWidth(math.max(1,392*(1-elapsed/DURATION)))
  banner:Show()
end

local function ensureDriver()
  if driver then return true end
  if type(CreateFrame)~='function' or not UIParent then return false end
  local ok, result=pcall(CreateFrame,'Frame','TheSentencedSignupNotice',UIParent)
  if not ok or not result then return false end
  driver=result
  local configured=pcall(function()
    driver:SetScript('OnUpdate',update); driver:Hide()
    driver.Preview=function() return NS.previewEventSignup() end
  end)
  if not configured then driver=nil; return false end
  return true
end

local function enqueue(event, player, role, preview)
  if type(event)~='table' or type(CreateFrame)~='function' or not UIParent then return false end
  local name, title, kind=plain(player,72), plain(event.title,120), plain(role,12)
  if name=='' or title=='' or (kind~='TANK' and kind~='HEAL' and kind~='DPS') then return false end
  if #queue>=MAX_PENDING then return false end
  if not ensureDriver() then return false end
  queue[#queue+1]={name=name,title=title,role=kind,preview=preview,gameTime=gameClock(),logicalTime=logicalClock}
  driver:Show()
  return true
end

function NS.notifyEventSignup(event, player, role)
  return enqueue(event,player,role,false)
end

-- Explicit local-only visual check. It does not create or transmit an event.
function NS.previewEventSignup()
  return enqueue({title='Przykładowa wyprawa'},'Przykładowy gracz','DPS',true)
end
ensureDriver()
