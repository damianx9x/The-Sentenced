'use strict';

const {MessageFlags, SlashCommandBuilder} = require('discord.js');
const {has, OFFICERS} = require('./guild-core');

const EKIPA_ROLE_NAME = 'Ekipa_WWW';
const ACCESS_ROLE_NAME = 'Dostęp_zatwierdzony';

function commandDefinition() {
    const builder = new SlashCommandBuilder()
        .setName('ekipa')
        .setDescription('Zarządzaj dostępem do Ekipa WWW');
    for (const [name, description] of [['zapros', 'Nadaj dostęp'], ['usun', 'Cofnij dostęp']]) {
        builder.addSubcommand(option => option.setName(name).setDescription(description)
            .addUserOption(user => user.setName('czlonek').setDescription('Osoba z gildii').setRequired(true)));
    }
    return builder.toJSON();
}

async function ensureEkipaCommand(guild) {
    const commands = await guild.commands.fetch();
    const existing = commands.find(command => command.name === 'ekipa' && command.type === 1);
    const payload = commandDefinition();
    if (existing && existing.equals(payload)) return;
    if (existing) await existing.edit(payload);
    else await guild.commands.create(payload);
}

function mayInvite(target, accessRole) {
    return !target.user.bot && target.pending === false && Boolean(accessRole && target.roles.cache.has(accessRole.id));
}

async function handleEkipaCommand(interaction, db) {
    await interaction.deferReply({flags: MessageFlags.Ephemeral});
    try {
        const guild = interaction.guild;
        const actor = await guild.members.fetch({user: interaction.user.id, force: true});
        if (!has(actor, OFFICERS)) {
            await interaction.editReply('Tylko GM lub Oficer może zarządzać dostępem do Ekipa WWW.');
            return;
        }
        const action = interaction.options.getSubcommand(false);
        if (!['zapros', 'usun'].includes(action)) {
            await interaction.editReply('Użyj /ekipa zapros albo /ekipa usun.');
            return;
        }
        const target = await guild.members.fetch({user: interaction.options.getUser('czlonek', true).id, force: true});
        await guild.roles.fetch();
        const roles = guild.roles.cache.filter(role => role.name === EKIPA_ROLE_NAME);
        const role = roles.size === 1 ? roles.first() : null;
        if (!role?.editable) throw Error('EKIPA_ROLE_UNAVAILABLE');
        const access = guild.roles.cache.find(entry => entry.name === ACCESS_ROLE_NAME);
        if (action === 'zapros' && !mayInvite(target, access)) {
            await interaction.editReply('Dostęp do Ekipa WWW można nadać członkowi po zakończeniu rekrutacji.');
            return;
        }
        const grant = action === 'zapros';
        if (target.roles.cache.has(role.id) !== grant) {
            db.exec(`CREATE TABLE IF NOT EXISTS ts_ekipa_decisions (
                id INTEGER PRIMARY KEY, actor TEXT NOT NULL, target TEXT NOT NULL,
                action TEXT NOT NULL, created_at INTEGER NOT NULL, verified INTEGER NOT NULL DEFAULT 0)`);
            const receipt = db.prepare('INSERT INTO ts_ekipa_decisions(actor,target,action,created_at) VALUES(?,?,?,?)')
                .run(actor.id, target.id, action, Date.now());
            if (grant) await target.roles.add(role, 'Ekipa WWW: zaproszenie przez kadrę');
            else await target.roles.remove(role, 'Ekipa WWW: cofnięcie przez kadrę');
            const verify = await guild.members.fetch({user: target.id, force: true});
            if (verify.roles.cache.has(role.id) !== grant) throw Error('EKIPA_ROLE_READBACK_FAILED');
            db.prepare('UPDATE ts_ekipa_decisions SET verified=1 WHERE id=?').run(receipt.lastInsertRowid);
        }
        await interaction.editReply(grant ? 'Dostęp do Ekipa WWW jest aktywny.' : 'Dostęp do Ekipa WWW jest cofnięty.');
    } catch (error) {
        console.error('[ekipa]', error.code || error.name);
        await interaction.editReply('Nie potwierdzono operacji. Sprawdź aktualne role w Discordzie.');
    }
}

module.exports = {commandDefinition, ensureEkipaCommand, handleEkipaCommand, mayInvite};
