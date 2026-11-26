local _, NS=...
local L={}
NS.GuildLinks=L
local KIND={E='Otwórz wydarzenie',B='Otwórz ogłoszenie'}
local PREFIX='tsguildhall'
local function safe(value)
  return not (issecretvalue and issecretvalue(value))
end
local function hex(name)
  return (name:gsub('.',function(c) return string.format('%02x',c:byte()) end))
end
local function decode(encoded)
  if #encoded<2 or #encoded>144 or #encoded%2~=0 then return end
  local name=encoded:gsub('..',function(pair) return string.char(tonumber(pair,16)) end)
  if not name:find('[|:%[%]%z\001-\031\127]') and not name:match('^%s') and not name:match('%s$') then return name end
end
local function validId(id)
  return type(id)=='string' and #id<=22 and id:match('^%d+$')
end
function L.payload(kind,author,id,scope)
  if not (KIND[kind] and type(author)=='string' and #author<=72 and #author>0 and validId(id)) then return end
  if type(scope)~='number' or not safe(scope) then return end
  return table.concat({kind,scope,hex(author),id},':')
end
function L.parse(data,scope)
  if type(data)~='string' or not safe(data) or #data>200 then return end
  local kind,club,encoded,id=data:match('^([EB]):(%d+):([a-f0-9]+):(%d+)$')
  if not kind or not validId(id) or tonumber(club)~=scope then return end
  local author=decode(encoded)
  if author then return kind,author,id end
end
local draft
local function visible(text)
  return (text:gsub('|c%x%x%x%x%x%x%x%x',''):gsub('|r',''):gsub('|Hitem:[^|]+|h(.-)|h','%1')
    :gsub('%s+',' '):match('^%s*(.-)%s*$'))
end
local function shorten(text,len)
  local last=math.min(len,#text)
  while text:byte(last+1) and text:byte(last+1)>=128 and text:byte(last+1)<192 do last=last-1 end
  return text:sub(1,last)
end
function L.prepare(kind,author,id,title,scope)
  local payload=L.payload(kind,author,id,scope)
  local openChat=(ChatFrameUtil and ChatFrameUtil.OpenChat) or ChatFrame_OpenChat
  if not (payload and type(openChat)=='function') then return false end
  local clean=tostring(title or ''):gsub('[|%z\001-\031\127]',' ')
  local text=NS.BoardItems and NS.BoardItems.chatText(clean) or clean
  if NS.BoardItems and #NS.BoardItems.links(clean)>0 and not text:find('|Hitem:',1,true) then
    return false,'Gra wczytuje podgląd przedmiotu. Kliknij ponownie za chwilę.'
  end
  if #text>235 then
    -- Do not cut a native item hyperlink. Keep the first item when possible.
    local item=NS.BoardItems and NS.BoardItems.links(clean)[1]
    local first=item and NS.BoardItems.chatText('{'..item..'}') or ''
    local heading=NS.BoardItems and NS.BoardItems.label(clean:gsub('{item:[^{}]+}','')) or visible(clean)
    text=#first<230 and (shorten(heading,234-#first)..' '..first) or shorten(heading,234)
  end
  local now=GetTime and GetTime() or 0
  draft={payload=payload,label=visible(text),scope=scope,expires=now+120}
  openChat('/g '..text)
  return true
end
function L.echo(message,sender,selfName,scope)
  if not draft or not safe(message) or not safe(sender) or type(message)~='string' or sender~=selfName then return end
  if draft.scope~=scope or (GetTime and GetTime() or 0)>draft.expires then draft=nil; return end
  if visible(message)~=draft.label then return end
  local payload=draft.payload
  draft=nil
  return 'L1|'..payload
end
local recently={}
function L.show(data,sender,scope)
  local kind=L.parse(data,scope)
  if not kind or not safe(sender) or type(sender)~='string' then return false end
  local now=GetTime and GetTime() or 0
  if recently[sender] and now>=recently[sender] and now-recently[sender]<3 then return false end
  local target=SELECTED_CHAT_FRAME or DEFAULT_CHAT_FRAME
  if not target or not target.AddMessage then return false end
  recently[sender]=now
  target:AddMessage('|cffb7bbc7'..sender:gsub('|','')..' · |r|cffffbf66|H'..PREFIX..':'..data..'|h['..KIND[kind]..']|h|r')
  return true
end
function L.install(scope,open)
  if not (LinkUtil and LinkUtil.RegisterLinkHandler) then return false end
  if L.installed then return true end
  if LinkUtil.IsLinkHandlerRegistered and LinkUtil.IsLinkHandlerRegistered(PREFIX) then return false end
  LinkUtil.RegisterLinkHandler(PREFIX,function(_,_,link,context)
    if context and context.button~='LeftButton' then return end
    local kind,author,id=L.parse(link.options,scope())
    if kind then open(kind,author,id) end
  end)
  L.installed=true
  return true
end
