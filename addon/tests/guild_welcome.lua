local ns={};assert(loadfile('TheSentenced/GuildWelcome.lua'))('TheSentenced',ns)
function GetServerTime()return 1800000000 end;function GetGuildInfo()return 'The Sentenced'end;function UnitName()return 'Owner'end
function ChatFrame_OpenChat(text)assert(text=='/g Witaj Test!')end
TheSentencedGuildDB={};ns.CompanionSnapshot={welcomesGeneratedAt=1800000000,welcomes={{id='123456789012345678',text='Witaj Test!',createdAt=1800000000}}}
assert(#ns.GuildWelcome.pending()==1);assert(ns.GuildWelcome.prepare())
assert(not ns.GuildWelcome.echo('Witaj Test!','Other'))
assert(not ns.GuildWelcome.echo('Other','Owner'))
assert(ns.GuildWelcome.echo('Witaj Test!','Owner'));assert(#ns.GuildWelcome.pending()==0)
assert(TheSentencedGuildDB.welcomeConfirmedV1=='TW1|123456789012345678')
ns.CompanionSnapshot.welcomesGeneratedAt=1700000000;assert(#ns.GuildWelcome.pending()==0)
print('GUILD_WELCOME_OK')
