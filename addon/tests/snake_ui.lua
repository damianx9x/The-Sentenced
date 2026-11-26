local frames={};local proto={}
function proto:SetScript(k,v)self.scripts[k]=v end
function proto:Show()self.shown=true end
function proto:Hide()self.shown=false end
function proto:IsShown()return self.shown end
function proto:SetPropagateKeyboardInput(value)self.propagate=value end
function proto:CreateFontString()return setmetatable({scripts={}}, {__index=proto}) end
function proto:CreateTexture()return setmetatable({scripts={}}, {__index=proto}) end
setmetatable(proto,{__index=function()return function()end end})
UIParent={};SlashCmdList={};TheSentencedDB={};local taxi=false;local combat=false
UnitOnTaxi=function()return taxi end;InCombatLockdown=function()return combat end
CreateFrame=function()local x=setmetatable({scripts={},shown=false},{__index=proto});frames[#frames+1]=x;return x end
local ns={};assert(loadfile('TheSentenced/Snake.lua'))('TheSentenced',ns);assert(loadfile('TheSentenced/SnakeUI.lua'))('TheSentenced',ns)
local main=frames[1];local watcher=frames[#frames];assert(watcher.scripts.OnUpdate)
local steps=0;local realStep=ns.Snake.step;ns.Snake.step=function(...) steps=steps+1;return realStep(...) end
taxi=true;watcher.scripts.OnUpdate(watcher,46);assert(main:IsShown(),'auto open on long taxi');assert(steps==0,'game waits for user');main.scripts.OnKeyDown(main,'UP');assert(main.propagate==false,'snake arrows must not move the character');main.scripts.OnKeyDown(main,'B');assert(main.propagate==true,'other shortcuts remain available');watcher.scripts.OnUpdate(watcher,.2);assert(steps==1,'game starts after direction')
taxi=false;watcher.scripts.OnUpdate(watcher,1);assert(not main:IsShown(),'auto close on landing')
combat=true;taxi=true;watcher.scripts.OnUpdate(watcher,46);assert(not main:IsShown(),'combat blocks opening')
combat=false;watcher.scripts.OnUpdate(watcher,1);assert(main:IsShown(),'opens after combat during same flight')
taxi=false;watcher.scripts.OnUpdate(watcher,1);assert(not main:IsShown(),'landing closes delayed game')
SlashCmdList.TSSNAKE('auto');taxi=true;watcher.scripts.OnUpdate(watcher,46);assert(not main:IsShown(),'auto can be disabled')
SlashCmdList.TSSNAKE('');assert(main:IsShown(),'manual open')
SlashCmdList.TSSNAKE('auto');taxi=false;watcher.scripts.OnUpdate(watcher,1);taxi=true;watcher.scripts.OnUpdate(watcher,46);taxi=false;watcher.scripts.OnUpdate(watcher,1);assert(main:IsShown(),'manual game remains open after flight');print('SNAKE_UI_OK')
