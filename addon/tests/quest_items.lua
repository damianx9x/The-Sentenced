local frame={scripts={}}
function frame:RegisterEvent(event) assert(event=='PLAYER_LOGIN') end
function frame:SetScript(key,fn) self.scripts[key]=fn end
CreateFrame=function() return frame end

local function item(bag,slot)
  local button={}
  function button:IsVisible() return true end
  function button:GetBagID() return bag end
  function button:GetID() return slot end
  function button:CreateFontString()
    local mark={SetPoint=function() end,SetText=function() end,SetTextColor=function() end,SetShadowOffset=function() end}
    function mark:Show() self.shown=true end
    function mark:Hide() self.shown=false end
    function mark:SetAlpha(alpha) self.alpha=alpha end
    self.mark=mark
    return mark
  end
  return button
end
local ore,quest,starter,bank=item(0,1),item(1,2),item(2,3),item(-1,4)
local buttons={ore,quest,starter,bank}
ContainerFrameCombinedBags={shown=true,IsVisible=function(self) return self.shown end,EnumerateValidItems=function() return ipairs(buttons) end}
local queriedBank=false
C_Container={GetContainerItemQuestInfo=function(bag,slot)
  if bag<0 then queriedBank=true; return {isQuestItem=true} end
  if slot==2 then return {isQuestItem=true} end
  if slot==3 then return {questID=112} end
  return {isQuestItem=false}
end}
TheSentencedDB={}
local ns={}
assert(loadfile('TheSentenced/QuestItems.lua'))('TheSentenced',ns)
local questItems=ns.QuestItems
frame.scripts.OnEvent()
assert(not frame.scripts.OnUpdate,'sparkles are opt-in')
questItems.setEnabled(true)
frame.scripts.OnUpdate(frame,.25)
assert(quest.mark.shown and starter.mark.shown and quest.mark.alpha>0,'mark quest and quest-starting items')
assert(not ore.mark and not bank.mark and not queriedBank,'skip ordinary items and banks')
ContainerFrameCombinedBags.shown=false
frame.scripts.OnUpdate(frame,.25)
assert(not quest.mark.shown and not starter.mark.shown,'pressed bag close clears marks')
questItems.setEnabled(false)
assert(not frame.scripts.OnUpdate and not TheSentencedDB.questItemSparkle,'toggle stops updates and persists')
C_Container.GetContainerItemQuestInfo=function() error('API restricted') end
assert(not questItems.isQuest(1,2),'unavailable API does not mislabel slots')
print('QUEST_ITEMS_OK: opt-in, carried quest and quest-starting items, cleanup, unsupported API')
