-- The client blocks automated guild chat. Prepare text; Enter remains the player's action.
local _,NS=...
local W={};NS.GuildWelcome=W
local prepared
local function confirmed()
 TheSentencedGuildDB=TheSentencedGuildDB or {};TheSentencedGuildDB.welcomeConfirmed=TheSentencedGuildDB.welcomeConfirmed or {};return TheSentencedGuildDB.welcomeConfirmed
end
function W.pending()
 local snap
 if NS.GuildAccess then snap=NS.GuildAccess.snapshot() else snap=NS.CompanionSnapshot end
 local now=GetServerTime and GetServerTime()or time()
 if not GetGuildInfo or GetGuildInfo('player')~='The Sentenced' or type(snap)~='table' or type(snap.welcomesGeneratedAt)~='number' or now-snap.welcomesGeneratedAt>3600 or now<snap.welcomesGeneratedAt-300 then return {}end
 local out={};local ack=confirmed()
 for _,row in ipairs(snap.welcomes or {})do
  if type(row)=='table' and type(row.id)=='string' and row.id:match('^%d+$')and #row.id<=20 and type(row.text)=='string' and #row.text<=240 and not row.text:find('[|%z\001-\031\127]')and type(row.createdAt)=='number' and row.createdAt<=now+300 and now-row.createdAt<86400 and not ack[row.id]then out[#out+1]=row end
 end
 return out
end
function W.prepare()
 if InCombatLockdown and InCombatLockdown()then return false,'Wyślij powitanie po walce.'end
 local row=W.pending()[1];if not row then return false,'Brak nowych powitań w pobranej kolejce.'end
 if not ChatFrame_OpenChat then return false,'Pole czatu jest niedostępne.'end
 prepared=row
 ChatFrame_OpenChat('/g '..row.text)
 return true,'Sprawdź tekst i zatwierdź Enter. Potwierdzenie nastąpi po echu w /g.'
end
function W.echo(message,author,guid)
 if issecretvalue and (issecretvalue(message)or issecretvalue(author)or issecretvalue(guid))then return false end
 if not GetGuildInfo or GetGuildInfo('player')~='The Sentenced'then return false end
 if not prepared or message~=prepared.text then return false end
 local name=UnitName and UnitName('player');local full=NS.TransferSync and NS.TransferSync.character()
 if not ((guid and UnitGUID and guid==UnitGUID('player'))or author==name or author==full)then return false end
 local ack=confirmed();ack[prepared.id]=GetServerTime and GetServerTime()or time();prepared=nil
 local ids={};for id in pairs(ack)do if type(id)=='string' and id:match('^%d+$')then ids[#ids+1]=id end end
 table.sort(ids);while #ids>100 do ack[table.remove(ids,1)]=nil end
 TheSentencedGuildDB.welcomeConfirmedV1='TW1|'..table.concat(ids,'|')
 return true
end
if CreateFrame then local f=CreateFrame('Frame');f:RegisterEvent('CHAT_MSG_GUILD');f:SetScript('OnEvent',function(_,_,message,author,...)local rest={...};W.echo(message,author,rest[10])end)end
