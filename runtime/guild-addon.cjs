'use strict';

const {ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType} = require('discord.js');

const ADDON_CHANNEL = '1568654994054451413';
const DOWNLOAD = 'https://discord.com/channels/1549146537802600568/1568654994054451413';

const ADDON_HELP = 'Paczki i instrukcje znajdziesz na kanale dodatku. Panel w grze otwiera **/ts**.\n\n**Discord ↔ addon:** wybierz **Połącz addon**, a potem **Synchronizacja dodatku**. W grze otwórz **Gildia → Discord** albo **Kadra**. Pozostałe urządzenia korzystają z opcji ręczne kody. Na Macu właściciela z programem towarzyszącym terminy i kolejka kadry odświeżają się po przeładowaniu dodatku.\n\n**CurseForge:** status publikacji znajdziesz w aktualnym ogłoszeniu na kanale dodatku.';

function downloadButton() {
    return new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Otwórz kanał dodatku').setURL(DOWNLOAD);
}

async function ensureAddonPanel({guild, getSetting, setSetting}) {
    const channel = await guild.channels.fetch(ADDON_CHANNEL);
    if (channel?.type !== ChannelType.GuildText) throw Error('ADDON_CHANNEL_UNAVAILABLE');
    const key = 'ts_addon_panel_v3';
    const payload = {
        content: '**THE SENTENCED • GUILD HALL**\n'+ADDON_HELP,
        components: [new ActionRowBuilder().addComponents(
            downloadButton(),
            new ButtonBuilder().setCustomId('transfer:open').setLabel('Synchronizacja dodatku').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('integration:addon').setLabel('Połącz addon').setStyle(ButtonStyle.Secondary)
        )],
        allowedMentions: {parse: []},
    };
    const id = getSetting(key);
    if (id) {
        const existing = await channel.messages.fetch(id).catch(error => {
            if (error.code === 10008) return null;
            throw error;
        });
        if (existing) {
            if (existing.author.id !== guild.client.user.id) throw Error('ADDON_PANEL_AUTHOR_MISMATCH');
            await existing.edit(payload);
            return;
        }
    }
    const sent = await channel.send(payload);
    setSetting(key, sent.id);
}

module.exports = {ADDON_CHANNEL, ADDON_HELP, downloadButton, ensureAddonPanel};
