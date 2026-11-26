local ns={};assert(loadfile('TheSentenced/RosterCapture.lua'))('TheSentenced',ns)
local c=ns.RosterCapture
assert(c.encode('The Sentenced',123,{{name='Icex-Realm',class='PALADIN',level=60,rank='GM'}})=='TSR2|123|5468652053656E74656E636564|1|496365782D5265616C6D:Paladin:60:474D')
assert(c.encode('The Sentenced',123,{{name='Icex',class='UNKNOWN'}})==nil)
assert(c.encode('The Sentenced',123,{{name='Icex',class='MAGE'},{name='Icex',class='MAGE'}})==nil)
TheSentencedGuildDB={};IsInGuild=function() return true end;GetGuildInfo=function() return 'The Sentenced' end;GetNumGuildMembers=function() return 1 end;GetGuildRosterInfo=function() return 'Icex-Realm','GM',nil,60,nil,nil,nil,nil,nil,nil,'PALADIN' end;GetServerTime=function() return 123 end
assert(c.snapshot());assert(TheSentencedGuildDB.rosterExportV1:match('^TSR2|123|'))
GetNumGuildMembers=function() return 2 end;assert(not c.snapshot(),'partial roster must not replace valid snapshot')
print('ROSTER_CAPTURE_OK')
