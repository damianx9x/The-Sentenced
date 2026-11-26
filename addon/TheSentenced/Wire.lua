-- Bounded guild transport framing. No pipes appear on the wire.
local _,NS=...
local W={}; NS.Wire=W
local alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
local reverse={}; for i=1,#alphabet do reverse[alphabet:sub(i,i)]=i-1 end
local serial=0
local function b64(s)
 local out={}
 for i=1,#s,3 do
  local a,b,c=s:byte(i,i+2); local n=a*65536+(b or 0)*256+(c or 0)
  out[#out+1]=alphabet:sub(math.floor(n/262144)%64+1,math.floor(n/262144)%64+1)
  out[#out+1]=alphabet:sub(math.floor(n/4096)%64+1,math.floor(n/4096)%64+1)
  out[#out+1]=b and alphabet:sub(math.floor(n/64)%64+1,math.floor(n/64)%64+1) or '='
  out[#out+1]=c and alphabet:sub(n%64+1,n%64+1) or '='
 end
 return table.concat(out)
end
local function un64(s)
 if #s==0 or #s%4~=0 or s:find('[^A-Za-z0-9+/=]') then return nil end
 local out={}
 for i=1,#s,4 do
  local a,b,c,d=s:sub(i,i),s:sub(i+1,i+1),s:sub(i+2,i+2),s:sub(i+3,i+3)
  if not reverse[a] or not reverse[b] or (c=='=' and d~='=') or ((c=='=' or d=='=') and i+3~=#s) or (c~='=' and not reverse[c]) or (d~='=' and not reverse[d]) then return nil end
  local n=reverse[a]*262144+reverse[b]*4096+(reverse[c] or 0)*64+(reverse[d] or 0)
  out[#out+1]=string.char(math.floor(n/65536)%256)
  if c~='=' then out[#out+1]=string.char(math.floor(n/256)%256) end
  if d~='=' then out[#out+1]=string.char(n%256) end
 end
 return table.concat(out)
end
function W.encode(payload)
 if type(payload)~='string' or #payload==0 or #payload>600 then return nil end
 serial=(serial+1)%1000000
 local stamp=GetServerTime and GetServerTime() or (time and time()) or 0
 local id=tostring(stamp)..'-'..serial; local total=math.ceil(#payload/150); local out={}
 for i=1,total do out[i]='~2~'..id..'~'..i..'~'..total..'~'..b64(payload:sub((i-1)*150+1,i*150)) end
 return out
end
local pending={}; local lastScope
function W.receive(scope,prefix,sender,message,clock)
 if type(message)~='string' then return nil end
 if message:sub(1,3)=='~1~' then return message:sub(4) end
 if message:sub(1,3)~='~2~' then return message end
 if #message>255 then return nil end
 if type(scope)~='string' or type(prefix)~='string' or type(sender)~='string' then return nil end
 if lastScope~=scope then pending={};lastScope=scope end
 clock=clock or ((GetTime and GetTime()) or 0)
 local count=0; for k,v in pairs(pending) do if clock<v.at or clock-v.at>30 then pending[k]=nil else count=count+1 end end
 local id,part,total,encoded=message:match('^~2~(%d+%-%d+)~(%d+)~(%d+)~([A-Za-z0-9+/=]+)$')
 part,total=tonumber(part),tonumber(total)
 if not id or #id>25 or not part or not total or total<1 or total>4 or part<1 or part>total then return nil end
 local data=un64(encoded); if not data or #data>150 or #data==0 then return nil end
 local key=prefix..'\0'..sender..'\0'..id; local item=pending[key]
 if not item then if count>=40 then return nil end; item={at=clock,total=total,parts={},size=0};pending[key]=item end
 if item.total~=total then pending[key]=nil; return nil end
 if item.parts[part] then if item.parts[part]~=data then pending[key]=nil end; return nil end
 item.parts[part]=data;item.size=item.size+#data
 if item.size>600 then pending[key]=nil;return nil end
 for i=1,total do if not item.parts[i] then return nil end end
 pending[key]=nil;return table.concat(item.parts)
end
