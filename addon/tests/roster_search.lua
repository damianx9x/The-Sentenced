local ns={};assert(loadfile('TheSentenced/RosterSearch.lua'))('TheSentenced',ns)
local match=ns.RosterSearch.matches
local m={name='Żaneta',level=45,className='Druid',zone='Orgrimmar',rank='Oficer',note='Alchemia i zioła',officerNote='secret'}
assert(match(m,''))
assert(match(m,'zaneta') and match(m,'ŻANETA'),'diacritics and capitalisation')
assert(match(m,'druid') and match(m,'ORGRIMMAR') and match(m,'oficer'),'normal roster fields')
assert(match(m,'ziola') and not match(m,'secret'),'public note only')
assert(match(m,'45') and not match(m,'46'),'exact level')
assert(match(m,'40-50') and match(m,'>=45') and match(m,'<=45'),'level ranges')
assert(not match(m,'50-40') and not match(m,'>=46') and not match(m,'<=44'),'out of range')
assert(not match({name='X'},'45') and not match(nil,'x'),'missing data')
issecretvalue=function(v) return v=='HIDDEN' end
assert(not match({name='HIDDEN'},'HIDDEN'),'secret text is ignored')
assert(not match({level='HIDDEN'},'45'),'secret level is ignored')
print('ROSTER_SEARCH_OK: roster fields, notes, diacritics and level filters')
