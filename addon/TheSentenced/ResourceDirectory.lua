-- Search only already shared bag snapshots belonging to the current guild roster.
local _, NS = ...
local D = {}; NS.ResourceDirectory = D
function D.search(members, profiles, query, label, onlineOnly, maximum)
  query=type(query)=='string' and query:match('^%s*(.-)%s*$'):lower() or ''
  if #query<2 and not query:match('^%d+$') then return {},false end
  local rows,labels={},{};maximum=maximum or 200
  for _,member in ipairs(members or {}) do
    if not onlineOnly or member.online then
      local record=profiles and profiles(member.name);local bag=record and record.B
      for _,item in ipairs(bag and bag.items or {}) do
        if type(item.id)=='number' and type(item.count)=='number' and item.count>0 then
          local name=labels[item.id]
          if name==nil then name=label(item.id) or false;labels[item.id]=name end
          if type(name)=='string' and (name:lower():find(query,1,true) or tostring(item.id)==query) then
            if #rows>=maximum then return rows,true end
            rows[#rows+1]={member=member,id=item.id,count=item.count,name=name,received=bag.received}
          end
        end
      end
    end
  end
  return rows,false
end
