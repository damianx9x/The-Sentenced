'use strict';
// A saved Discord message ID can outlive the message itself.
async function signupLink(guild,channel,raid){
 if(!channel||!raid?.signup_message_id)return null;
 try{
  const message=await channel.messages.fetch(raid.signup_message_id);
  if(!message)return null;
  return `https://discord.com/channels/${guild.id}/${channel.id}/${raid.signup_message_id}`;
 }catch(error){
  if(error?.code===10008||error?.status===404)return null;
  throw error;
 }
}
module.exports={signupLink};
