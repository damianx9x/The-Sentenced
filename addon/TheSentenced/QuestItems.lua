local _, NS=...
local Q={}
NS.QuestItems=Q

local function safe(value)
  return not (issecretvalue and issecretvalue(value))
end

function Q.isQuest(bag,slot)
  if not (C_Container and C_Container.GetContainerItemQuestInfo) then return false end
  local ok,info=pcall(C_Container.GetContainerItemQuestInfo,bag,slot)
  if not ok or not safe(info) or type(info)~='table' then return false end
  return (safe(info.isQuestItem) and info.isQuestItem==true)
    or (safe(info.questID) and type(info.questID)=='number' and info.questID>0)
end

function Q.enabled()
  return type(TheSentencedDB)=='table' and TheSentencedDB.questItemSparkle==true
end

local marks=setmetatable({},{__mode='k'})
local active={}
local function addMark(button)
  local mark=marks[button]
  if not mark then
    mark=button:CreateFontString(nil,'OVERLAY','GameFontNormalLarge')
    mark:SetPoint('TOPRIGHT',2,3)
    mark:SetText('✦')
    mark:SetTextColor(1,.79,.27)
    mark:SetShadowOffset(1,-1)
    marks[button]=mark
  end
  mark:Show()
  active[mark]=true
end

local function scan(container)
  if not (container and container:IsVisible() and container.EnumerateValidItems) then return end
  local reagent=Enum and Enum.BagIndex and Enum.BagIndex.ReagentBag
  for _,button in container:EnumerateValidItems() do
    if button:IsVisible() and button.GetBagID then
      local bag,slot=button:GetBagID(),button:GetID()
      if safe(bag) and type(bag)=='number' and ((bag>=0 and bag<=(NUM_BAG_SLOTS or 4)) or bag==reagent)
        and safe(slot) and type(slot)=='number' and slot>0 and Q.isQuest(bag,slot) then
        addMark(button)
      end
    end
  end
end

local frame=CreateFrame('Frame')
local elapsed,phase=0,0
local function clear()
  for mark in pairs(active) do mark:Hide(); active[mark]=nil end
end
local function update(_,dt)
  elapsed,phase=elapsed+dt,(phase+dt)%1.6
  if elapsed>=.25 then
    elapsed=0
    clear()
    if not (InCombatLockdown and InCombatLockdown()) then
      scan(ContainerFrameCombinedBags)
      for i=1,(NUM_CONTAINER_FRAMES or 6) do scan(_G['ContainerFrame'..i]) end
    end
  end
  local alpha=.67+.33*(1+math.cos(phase*math.pi/0.8))/2
  for mark in pairs(active) do mark:SetAlpha(alpha) end
end

local function refresh()
  clear()
  elapsed=.25
  frame:SetScript('OnUpdate',Q.enabled() and update or nil)
end
function Q.setEnabled(value)
  if type(TheSentencedDB)~='table' then return end
  TheSentencedDB.questItemSparkle=value==true
  refresh()
end
frame:RegisterEvent('PLAYER_LOGIN')
frame:SetScript('OnEvent',refresh)
