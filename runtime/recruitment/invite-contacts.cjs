'use strict';

const names = ['Icex Jenkins', 'Prado Greenhoof', 'Armisael Protector', 'Gniewna Jaga'];

function inviteContacts(bold = false) {
 const formatted = bold ? names.map(name => '**'+name+'**') : names;
 return formatted.slice(0,-1).join(', ')+' lub '+formatted.at(-1);
}

module.exports={inviteContacts};
