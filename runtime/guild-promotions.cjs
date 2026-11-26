'use strict';
const {ActionRowBuilder,ModalBuilder,TextInputBuilder,TextInputStyle,PermissionFlagsBits}=require('discord.js');
const {has,text}=require('./guild-core');
const CHANNEL='materiały-promocyjne';

function modal(){
 const input=new TextInputBuilder().setCustomId('material').setLabel('Tekst do skopiowania').setStyle(TextInputStyle.Paragraph).setMinLength(1).setMaxLength(1600).setRequired(true).setPlaceholder('Wpisz gotowy tekst, który inni będą mogli skopiować.');
 return new ModalBuilder().setCustomId('v2:publishpromotion').setTitle('Dodaj materiał gildii').addComponents(new ActionRowBuilder().addComponents(input));
}

async function publish({guild,getChannel,interaction}){
 const content=interaction.fields.getTextInputValue('material');
 if(typeof content!=='string'||!content.trim()||content.length>1600||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(content))return {ok:false,error:'Wpisz materiał o długości 1–1600 znaków.'};
 const member=await guild.members.fetch({user:interaction.user.id,force:true});
 if(!has(member))return {ok:false,error:'Brak aktualnego dostępu gildii.'};
 const candidate=getChannel(guild,CHANNEL);
 const channel=candidate&&await guild.channels.fetch(candidate.id);
 const permissions=channel?.permissionsFor(member);
 if(!channel||channel.guildId!==guild.id||channel.type!==0||!permissions?.has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages]))return {ok:false,error:'Nie możesz publikować na kanale materiałów promocyjnych.'};
 const author=text(member.displayName||interaction.user.username||'Członek gildii',60);
 try{
  const message=await channel.send({content:`**Materiał gildii • ${author}**\n${content}`,allowedMentions:{parse:[]},nonce:interaction.id,enforceNonce:true});
  return {ok:true,url:message.url};
 }catch{return {ok:false,error:'Nie potwierdzono publikacji. Sprawdź kanał przed ponowną próbą.'};}
}
module.exports={CHANNEL,modal,publish};
