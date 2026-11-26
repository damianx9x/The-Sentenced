'use strict';
const ACK=Symbol.for('sentenced.maintenance.ack');
function maintenance(db){return db.prepare("SELECT value FROM settings WHERE key='system_maintenance'").get()?.value==='1'}
function setMaintenance(db,enabled){db.prepare("INSERT INTO settings(key,value) VALUES('system_maintenance',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(enabled?'1':'0')}
async function guardInteraction(db,interaction){
 if(!maintenance(db)||interaction.commandName==='status')return false;
 // EventEmitter calls independent listeners concurrently. Reserve the ACK before awaiting Discord.
 if(interaction[ACK])return true;
 interaction[ACK]=true;
 const payload={content:'🛠️ The Sentenced jest w trybie maintenance. Zapisy są chwilowo wstrzymane; wrócimy z komunikatem w #ogłoszenia-bota.',flags:64,allowedMentions:{parse:[]}};
 if(interaction.deferred||interaction.replied)await interaction.followUp(payload);else await interaction.reply(payload);
 return true;
}
module.exports={maintenance,setMaintenance,guardInteraction};
