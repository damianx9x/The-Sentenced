require('dotenv').config({ quiet: true });

const {
    handlePollInteraction,
    refreshAllPollMessages,
    recordVote, refreshPollMessage,
} = require('./polls');



const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { DateTime } = require('luxon');

const {
    startRaidReminderEngine,
} = require('./raid-reminders');

const {
    startForeverWatcher,
    fetchForeverNews,
} = require('./forever-watcher');

const {
    Client,
    GatewayIntentBits,
    Events,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    StringSelectMenuBuilder,
    ActivityType,
    ChannelType,
    MessageFlags,
} = require('discord.js');

const {version: VERSION} = require('./package.json');
const { createCommunity } = require('./community');
const { ensureEkipaCommand, handleEkipaCommand } = require('./ekipa-www');
const { ensureAddonPanel } = require('./guild-addon.cjs');
let community;
let electionRuntime;
let rosterRuntime;
let publicApplications;
let integration, integrationDevices;
const { createGuildHub } = require('./guild-hub');
let guildHub;
const {createGuildIdentity}=require('./guild-identity');
const {createGuildNotifications}=require('./guild-notifications');
const {createGuildMilestones}=require('./guild-milestones');
const {createGuildHistory}=require('./guild-history');
let guildHistory;
const {statusEmbeds, statusComponents, createIntroductions, GAME, SITE} = require('./guild-refresh.cjs');
const {CHANNEL_IDS, channelId} = require('./guild-channel-ids.cjs');
const {signupPayload} = require('./raid-signup-view.cjs');
let guildIdentity, guildNotifications, introductions;
const GUILD_ID = process.env.GUILD_ID;

/*
|--------------------------------------------------------------------------
| DATABASE
|--------------------------------------------------------------------------
*/

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'sentenced.db');

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, {
        recursive: true,
    });
}

const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');

// Production 3.0 is a single recruitment flow. Legacy checks in sibling
// modules read this same switch after the entry point starts.
process.env.TS_ONBOARDING_V6_ENABLED = 'true';
const TS_ONBOARDING_V6_ENABLED = true;

db.exec(`
CREATE TABLE IF NOT EXISTS members (
    user_id TEXT PRIMARY KEY,
    discord_tag TEXT NOT NULL,
    display_name TEXT,
    joined_at INTEGER NOT NULL,

    onboarding_status TEXT NOT NULL DEFAULT 'not_started',

    first_name TEXT,
    age INTEGER,
    old_ts_nick TEXT,

    plans_forever TEXT,
    interests TEXT,
    wow_class TEXT,
    wow_role TEXT,

    submitted_at INTEGER,
    approved_at INTEGER,
    approved_by TEXT,
    rejected_at INTEGER,
    rejected_by TEXT,

    messages_count INTEGER NOT NULL DEFAULT 0,
    voice_seconds INTEGER NOT NULL DEFAULT 0,
    last_activity_at INTEGER,
    left_at INTEGER
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);
`);

function ensureColumn(table, column, definition) {
    const columns = db
        .prepare(`PRAGMA table_info(${table})`)
        .all();

    if (!columns.some(c => c.name === column)) {
        console.log(`💾 DB + ${column}`);

        db.exec(`
            ALTER TABLE ${table}
            ADD COLUMN ${column} ${definition}
        `);
    }
}

ensureColumn('members', 'first_name', 'TEXT');
ensureColumn('members', 'game_nick', 'TEXT');
ensureColumn('members', 'age', 'INTEGER');
ensureColumn('members', 'interests', 'TEXT');
ensureColumn('members', 'wow_class', 'TEXT');
ensureColumn('members', 'wow_role', 'TEXT');
ensureColumn('members', 'left_at', 'INTEGER');
ensureColumn('members', 'welcomed_at', 'INTEGER');
ensureColumn('members', 'join_announced_at', 'INTEGER');
ensureColumn('members', 'played_before_ts', 'TEXT');

/*
|--------------------------------------------------------------------------
| RAID DATABASE
|--------------------------------------------------------------------------
*/

db.exec(`
CREATE TABLE IF NOT EXISTS raids (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    raid_type TEXT NOT NULL,
    name TEXT NOT NULL,

    scheduled_ts INTEGER NOT NULL,

    player_limit INTEGER,

    description TEXT,

    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,

    calendar_message_id TEXT,
    signup_message_id TEXT,

    status TEXT NOT NULL DEFAULT 'ACTIVE'
);

CREATE TABLE IF NOT EXISTS raid_signups (
    raid_id INTEGER NOT NULL,

    user_id TEXT NOT NULL,

    status TEXT NOT NULL,

    updated_at INTEGER NOT NULL,

    PRIMARY KEY (
        raid_id,
        user_id
    )
);

CREATE INDEX IF NOT EXISTS idx_raid_signups_raid
ON raid_signups(raid_id);

CREATE INDEX IF NOT EXISTS idx_raids_status
ON raids(status);
`);



/*
|--------------------------------------------------------------------------
| RAID MIGRATION v0.6.2
|--------------------------------------------------------------------------
*/

ensureColumn(
    'raids',
    'cancel_reason',
    'TEXT'
);

ensureColumn(
    'raids',
    'updated_at',
    'INTEGER'
);

const sql = {
    upsert: db.prepare(`
        INSERT INTO members (
            user_id,
            discord_tag,
            display_name,
            joined_at,
            last_activity_at,
            left_at
        )
        VALUES (?, ?, ?, ?, ?, NULL)

        ON CONFLICT(user_id)
        DO UPDATE SET
            discord_tag = excluded.discord_tag,
            display_name = excluded.display_name,
            left_at = NULL
    `),

    getMember: db.prepare(`
        SELECT *
        FROM members
        WHERE user_id = ?
    `),

    submit: db.prepare(`
        UPDATE members
        SET
            onboarding_status = 'pending',
            first_name = ?,
            age = ?,
            game_nick = ?,
            plans_forever = ?,
            interests = ?,
            wow_class = ?,
            wow_role = ?,
            submitted_at = ?,
            rejected_at = NULL,
            rejected_by = NULL
        WHERE user_id = ?
    `),

    approve: db.prepare(`
        UPDATE members
        SET
            onboarding_status = 'approved',
            approved_at = ?,
            approved_by = ?
        WHERE user_id = ?
    `),

    reject: db.prepare(`
        UPDATE members
        SET
            onboarding_status = 'rejected',
            rejected_at = ?,
            rejected_by = ?
        WHERE user_id = ?
    `),

    message: db.prepare(`
        UPDATE members
        SET
            messages_count = messages_count + 1,
            last_activity_at = ?
        WHERE user_id = ?
    `),

    voice: db.prepare(`
        UPDATE members
        SET
            voice_seconds = voice_seconds + ?,
            last_activity_at = ?
        WHERE user_id = ?
    `),

    left: db.prepare(`
        UPDATE members
        SET
            left_at = ?,
            last_activity_at = ?
        WHERE user_id = ?
    `),

    settingGet: db.prepare(`
        SELECT value
        FROM settings
        WHERE key = ?
    `),

    settingSet: db.prepare(`
        INSERT INTO settings (key, value)
        VALUES (?, ?)

        ON CONFLICT(key)
        DO UPDATE SET value = excluded.value
    `),
};

/*
|--------------------------------------------------------------------------
| DISCORD
|--------------------------------------------------------------------------
*/

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
    ],
});

// Enable only after the current Discord ACL and rules panel have passed preflight.
const tsGateV6 = TS_ONBOARDING_V6_ENABLED ? require('./ts-onboarding-v6/src/ts-onboarding-runtime.cjs').createRuntime({
    db, guildId: GUILD_ID, discord: require('discord.js'),
    config: {
        enabled: TS_ONBOARDING_V6_ENABLED,
        rulesId: CHANNEL_IDS.regulamin, startId: CHANNEL_IDS.start, waitId: CHANNEL_IDS.poczekalnia,
        staffId: CHANNEL_IDS.oficerka, generalId: CHANNEL_IDS['ogólny'],
        reviewRoleIds: ['1549371114415988797','1549371116034719795'],
        accessRoleName: 'Dostęp_zatwierdzony',
        rulesVersion: '2026-11-19',
        rulesUrl: process.env.TS_RECRUITMENT_RULES_URL || null,
    },
    getSetting, setSetting, getChannel,
    upsertCandidate: upsertMember,
    sendWelcome: sendPersonalizedWelcome,
    publishApplication: (userId, application, status) => {
        const guild = client.guilds.cache.get(GUILD_ID);
        if (!guild) throw new Error('PUBLIC_GUILD_UNAVAILABLE');
        if (!publicApplications) publicApplications = require('./recruitment/public.cjs').createPublicApplications({db,guild,forumId:'1574134857767063645'});
        return publicApplications.update(userId,application,status);
    },
    recordApplication: db.transaction((userId, application) => {
        require('./recruitment/projection.cjs').projectApplication(db,userId,application,now());
    }),
    recordApproved: db.transaction((userId, actorId, application) => {
        const result = sql.approve.run(now(), actorId, userId);
        if (result.changes !== 1) throw new Error('MEMBER_APPROVAL_NOT_PERSISTED');
        require('./recruitment/projection.cjs').projectApplication(db,userId,application,now());
    }),
    refreshState: refreshGuildState,
}) : null;

const onboardingSessions = new Map();

const profileSessions = new Map();

function profileGameNickModal() {
    const modal =
        new ModalBuilder()
            .setCustomId('profile:gamenick')
            .setTitle('The Sentenced — profil WoW');

    const nick =
        new TextInputBuilder()
            .setCustomId('gamenick')
            .setLabel('Twój aktualny nick w WoW')
            .setPlaceholder('Np. Icex')
            .setRequired(true)
            .setMaxLength(60)
            .setStyle(TextInputStyle.Short);

    modal.addComponents(
        new ActionRowBuilder()
            .addComponents(nick)
    );

    return modal;
}

function profileForeverButtons() {
    return [
        new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('profile:forever:yes')
                    .setLabel('Tak, chcę grać')
                    .setEmoji('✅')
                    .setStyle(ButtonStyle.Success),

                new ButtonBuilder()
                    .setCustomId('profile:forever:no')
                    .setLabel('Nie planuję')
                    .setEmoji('❌')
                    .setStyle(ButtonStyle.Secondary)
            ),
    ];
}

function profileClassSelect() {
    return [
        new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('profile:class')
                    .setPlaceholder('Wybierz klasę')
                    .setMinValues(1)
                    .setMaxValues(1)
                    .addOptions(
                        { label: 'Warrior', value: 'Warrior', emoji: '⚔️' },
                        { label: 'Paladin', value: 'Paladin', emoji: '🛡️' },
                        { label: 'Hunter', value: 'Hunter', emoji: '🏹' },
                        { label: 'Rogue', value: 'Rogue', emoji: '🗡️' },
                        { label: 'Priest', value: 'Priest', emoji: '✨' },
                        { label: 'Shaman', value: 'Shaman', emoji: '🌩️' },
                        { label: 'Mage', value: 'Mage', emoji: '🔮' },
                        { label: 'Warlock', value: 'Warlock', emoji: '🔥' },
                        { label: 'Druid', value: 'Druid', emoji: '🌿' }
                    )
            ),
    ];
}

function roleOptionsForClass(wowClass) {
    const map = {
        Warrior: [
            { label: 'Tank', value: 'TANK', emoji: '🛡️' },
            { label: 'DPS', value: 'DPS', emoji: '⚔️' },
        ],
        Paladin: [
            { label: 'Tank', value: 'TANK', emoji: '🛡️' },
            { label: 'Heal', value: 'HEAL', emoji: '💚' },
            { label: 'DPS', value: 'DPS', emoji: '⚔️' },
        ],
        Hunter: [
            { label: 'DPS', value: 'DPS', emoji: '⚔️' },
        ],
        Rogue: [
            { label: 'DPS', value: 'DPS', emoji: '⚔️' },
        ],
        Priest: [
            { label: 'Heal', value: 'HEAL', emoji: '💚' },
            { label: 'DPS', value: 'DPS', emoji: '⚔️' },
        ],
        Shaman: [
            { label: 'Heal', value: 'HEAL', emoji: '💚' },
            { label: 'DPS', value: 'DPS', emoji: '⚔️' },
        ],
        Mage: [
            { label: 'DPS', value: 'DPS', emoji: '⚔️' },
        ],
        Warlock: [
            { label: 'DPS', value: 'DPS', emoji: '⚔️' },
        ],
        Druid: [
            { label: 'Tank', value: 'TANK', emoji: '🛡️' },
            { label: 'Heal', value: 'HEAL', emoji: '💚' },
            { label: 'DPS', value: 'DPS', emoji: '⚔️' },
        ],
    };

    return map[wowClass] || [];
}

function profileRoleSelect(wowClass) {
    return [
        new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('profile:role')
                    .setPlaceholder('Wybierz rolę')
                    .setMinValues(1)
                    .setMaxValues(1)
                    .addOptions(
                        roleOptionsForClass(wowClass)
                    )
            ),
    ];
}

function profileOldGuildButtons() {
    return [
        new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('profile:oldguild:yes')
                    .setLabel('Tak, grałem')
                    .setEmoji('✅')
                    .setStyle(ButtonStyle.Success),

                new ButtonBuilder()
                    .setCustomId('profile:oldguild:no')
                    .setLabel('Nie')
                    .setEmoji('❌')
                    .setStyle(ButtonStyle.Secondary)
            ),
    ];
}

function profileOldNickModal() {
    const modal =
        new ModalBuilder()
            .setCustomId('profile:oldnick')
            .setTitle('The Sentenced — dawny nick');

    const nick =
        new TextInputBuilder()
            .setCustomId('oldnick')
            .setLabel('Jaki miałeś wtedy nick?')
            .setRequired(true)
            .setMaxLength(60)
            .setStyle(TextInputStyle.Short);

    modal.addComponents(
        new ActionRowBuilder()
            .addComponents(nick)
    );

    return modal;
}

function profileRoleLabel(role) {
    const map = {
        TANK: '🛡️ Tank',
        DPS: '⚔️ DPS',
        HEAL: '💚 Heal',
    };

    return map[role] || '—';
}

async function saveProfileSession(interaction, session) {
    const member =
        await getInteractionMember(
            interaction
        );

    upsertMember(member);

    db.prepare(`
        UPDATE members
        SET
            game_nick = ?,
            plans_forever = ?,
            wow_class = ?,
            wow_role = ?,
            played_before_ts = ?,
            old_ts_nick = ?
        WHERE user_id = ?
    `).run(
        session.gameNick || '',
        session.plansForever || 'NIE',
        session.wowClass || '',
        session.wowRole || '',
        session.playedBefore || 'NIE',
        session.oldNick || '',
        member.id
    );

    profileSessions.delete(
        interaction.user.id
    );

    /*
     * GUILD STATE PRO v2 — profil użytkownika.
     */
    await refreshGuildState(
        interaction.guild
    );

}

const voiceSessions = new Map();

/*
|--------------------------------------------------------------------------
| HELPERS
|--------------------------------------------------------------------------
*/

function now() {
    return Date.now();
}

function getRole(guild, name) {
    return guild.roles.cache.find(
        r => r.name === name
    );
}

function getChannel(guild, name) {
    const id = channelId(guild, name);
    if (id) {
        const channel = guild.channels.cache.get(id);
        return channel?.type === ChannelType.GuildText ? channel : undefined;
    }
    return guild.channels.cache.find(
        c =>
            c.type === ChannelType.GuildText &&
            c.name === name
    );
}

function getSetting(key) {
    return sql.settingGet.get(key)?.value || null;
}

function setSetting(key, value) {
    sql.settingSet.run(
        key,
        String(value)
    );
}

function upsertMember(member) {
    if (!member || member.user.bot) {
        return;
    }

    sql.upsert.run(
        member.id,
        member.user.tag,
        member.displayName,
        member.joinedTimestamp || now(),
        now()
    );
}

async function getInteractionMember(
    interaction
) {
    if (
        interaction.member?.roles?.cache
    ) {
        return interaction.member;
    }

    const cached =
        interaction.guild.members.cache.get(
            interaction.user.id
        );

    if (cached) {
        return cached;
    }

    return interaction.guild.members.fetch(
        interaction.user.id
    );
}

function isGMOrOfficer(member) {
    if (member.id === member.guild.ownerId) {
        return true;
    }

    return ['GM', 'Oficer'].some(name => {
        const role = getRole(
            member.guild,
            name
        );

        return (
            role &&
            member.roles.cache.has(role.id)
        );
    });
}

function isRaidManager(member) {
    if (member.id === member.guild.ownerId) {
        return true;
    }

    return [
        'GM',
        'Oficer',
        'Raid Lider',
    ].some(name => {
        const role = getRole(
            member.guild,
            name
        );

        return (
            role &&
            member.roles.cache.has(role.id)
        );
    });
}

function hasGuildRank(member) {
    return require('./guild-core').has(member);
}

async function announce(guild, text) {
    const channel =
        getChannel(
            guild,
            'ogłoszenia-bota'
        );

    if (!channel) {
        return;
    }

    try {
        await channel.send(text);
    } catch (error) {
        console.error(
            'Announcement:',
            error.message
        );
    }
}


async function sendPersonalizedWelcome(guild, target) {
    return require('./recruitment/welcome.cjs').sendWelcome({db,guild,target,upsertMember,getChannel,now});
}

async function sendRawJoinAnnouncement(guild, target) {
    if (!guild || !target || target.user?.bot) {
        return false;
    }

    const claim = db.prepare(`
        UPDATE members
        SET join_announced_at = -1
        WHERE
            user_id = ?
            AND join_announced_at IS NULL
    `).run(target.id);

    if (claim.changes === 0) {
        return false;
    }

    try {
        const generalChannel =
            getChannel(guild, 'ogólny');

        if (!generalChannel) {
            throw new Error('Brak kanału #ogólny');
        }

        const startChannel =
            getChannel(guild, 'start');

        const nextStep = startChannel
            ? `Pierwszy krok czeka na ${startChannel}.`
            : 'Za chwilę przejdzie przez szybki start gildyjny.';

        await generalChannel.send({
            content:
                `👋 <@${target.id}> właśnie dołączył do serwera. ${nextStep}`,
            allowedMentions: {
                users: [target.id],
                roles: [],
                repliedUser: false,
            },
        });

        db.prepare(`
            UPDATE members
            SET join_announced_at = ?
            WHERE user_id = ?
        `).run(now(), target.id);

        console.log(
            `✅ Raw join #ogólny: ${target.user.tag}`
        );

        return true;
    } catch (error) {
        db.prepare(`
            UPDATE members
            SET join_announced_at = NULL
            WHERE
                user_id = ?
                AND join_announced_at = -1
        `).run(target.id);

        console.error(
            'RAW JOIN ANNOUNCEMENT:',
            error
        );

        return false;
    }
}


function readableInterests(values) {
    const map = {
        PVE: '🛡️ PvE',
        PVP: '⚔️ PvP',
        RAIDY: '☠️ Raidy',
        RP: '📜 Roleplay',
    };

    if (!values || !values.length) {
        return '—';
    }

    return values
        .map(v => map[v] || v)
        .join(', ');
}


/*
|--------------------------------------------------------------------------
| RAID CORE v0.6.1
|--------------------------------------------------------------------------
*/

function raidSignupButtons(raidId) {
    const raid = getRaid(raidId);

    if (
        !raid ||
        raid.status !== 'ACTIVE'
    ) {
        return [];
    }

    return [
        new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(
                        `raid:signup:${raidId}:YES`
                    )
                    .setLabel('Będę')
                    .setEmoji('✅')
                    .setStyle(
                        ButtonStyle.Success
                    ),

                new ButtonBuilder()
                    .setCustomId(
                        `raid:signup:${raidId}:MAYBE`
                    )
                    .setLabel('Może')
                    .setEmoji('🤔')
                    .setStyle(
                        ButtonStyle.Secondary
                    ),

                new ButtonBuilder()
                    .setCustomId(
                        `raid:signup:${raidId}:NO`
                    )
                    .setLabel('Nie będę')
                    .setEmoji('❌')
                    .setStyle(
                        ButtonStyle.Danger
                    )
            ),
    ];
}

function getRaid(raidId) {
    return db
        .prepare(`
            SELECT *
            FROM raids
            WHERE id = ?
        `)
        .get(raidId);
}

function getRaidSignups(raidId) {
    return db
        .prepare(`
            SELECT
                rs.user_id,
                rs.status,
                rs.updated_at,

                m.first_name,
                m.wow_class,
                m.wow_role

            FROM raid_signups rs

            LEFT JOIN members m
                ON m.user_id = rs.user_id

            WHERE rs.raid_id = ?

            ORDER BY
                rs.updated_at ASC
        `)
        .all(raidId);
}

function rosterValue(rows) {
    if (!rows.length) {
        return '—';
    }

    const lines =
        rows.map(row => {
            const wowClass =
                row.wow_class
                    ? ` — **${row.wow_class}**`
                    : '';

            return (
                `<@${row.user_id}>` +
                wowClass
            );
        });

    let output = '';

    let shown = 0;

    for (const line of lines) {
        if (
            (
                output +
                '\n' +
                line
            ).length > 950
        ) {
            break;
        }

        output +=
            (
                output
                    ? '\n'
                    : ''
            ) +
            line;

        shown++;
    }

    if (shown < lines.length) {
        output +=
            `\n… +${lines.length - shown}`;
    }

    return output;
}

function simpleSignupValue(rows) {
    if (!rows.length) {
        return '—';
    }

    return rows
        .slice(0, 25)
        .map(
            row =>
                `<@${row.user_id}>`
        )
        .join('\n');
}

function buildRaidSignupEmbed(
    raidId
) {
    const raid =
        getRaid(raidId);

    if (!raid) {
        throw new Error(
            'Raid nie istnieje.'
        );
    }

    const rows =
        getRaidSignups(raidId);

    const yes =
        rows.filter(
            row => row.status === 'YES'
        );

    const maybe =
        rows.filter(
            row => row.status === 'MAYBE'
        );

    const no =
        rows.filter(
            row => row.status === 'NO'
        );

    const tanks =
        yes.filter(
            row => row.wow_role === 'TANK'
        );

    const healers =
        yes.filter(
            row => row.wow_role === 'HEAL'
        );

    const dps =
        yes.filter(
            row => row.wow_role === 'DPS'
        );

    const unknown =
        yes.filter(
            row =>
                ![
                    'TANK',
                    'HEAL',
                    'DPS',
                ].includes(
                    row.wow_role
                )
        );

    const limitText =
        raid.player_limit
            ? `${yes.length}/${raid.player_limit}`
            : String(yes.length);

    const unix =
        raid.scheduled_ts;

    const signupColor =
        raid.status === 'CANCELLED'
            ? 0xED4245
            : raid.status === 'CLOSED'
                ? 0x4F545C
                : 0x8B1E1E;

    const signupTitle =
        raid.status === 'CANCELLED'
            ? `❌ RAID #${raid.id} ANULOWANY • ${raid.name}`
            : raid.status === 'CLOSED'
                ? `🔒 RAID #${raid.id} • ZAPISY ZAMKNIĘTE • ${raid.name}`
                : `⚔️ RAID #${raid.id} • ${raid.name}`;

    const embed =
        new EmbedBuilder()
            .setColor(signupColor)
            .setTitle(signupTitle)
            .setDescription(
                [
                    `📅 <t:${unix}:F>`,
                    `⏳ <t:${unix}:R>`,
                    '',
                    `👥 **${limitText} potwierdzonych**`,
                ].join('\n')
            )
            .addFields(
                {
                    name:
                        `🛡️ TANK • ${tanks.length}`,
                    value:
                        rosterValue(tanks),
                    inline: true,
                },
                {
                    name:
                        `💚 HEAL • ${healers.length}`,
                    value:
                        rosterValue(healers),
                    inline: true,
                },
                {
                    name:
                        `⚔️ DPS • ${dps.length}`,
                    value:
                        rosterValue(dps),
                    inline: true,
                }
            );

    if (unknown.length) {
        embed.addFields({
            name:
                `❓ BEZ ROLI • ${unknown.length}`,
            value:
                rosterValue(unknown),
            inline: false,
        });
    }

    embed.addFields(
        {
            name:
                `🤔 MOŻE • ${maybe.length}`,
            value:
                simpleSignupValue(maybe),
            inline: true,
        },
        {
            name:
                `❌ NIE BĘDZIE • ${no.length}`,
            value:
                simpleSignupValue(no),
            inline: true,
        }
    );

    embed
        .setFooter({
            text:
                `The Sentenced • Raid #${raid.id} • SentencedBot v${VERSION}`,
        })
        .setTimestamp();

    return embed;
}

async function refreshRaidSignupMessage(
    guild,
    raidId,
    strict = false
) {
    const raid =
        getRaid(raidId);

    if (
        !raid ||
        !raid.signup_message_id
    ) {
        if(strict)throw Error('Panel zapisów raidu niedostępny');
        return;
    }

    const channel =
        getChannel(
            guild,
            'zapisy'
        );

    if (!channel) {
        if(strict)throw Error('Panel zapisów raidu niedostępny');
        return;
    }

    try {
        const message =
            await channel.messages.fetch(
                raid.signup_message_id
            );

        await message.edit(signupPayload(raid, buildRaidSignupEmbed(raidId), raidSignupButtons));

    } catch (error) {
        if(strict)throw error;
        console.error(
            'Raid signup refresh:',
            error.message
        );
    }
}


/*
|--------------------------------------------------------------------------
| RAID MANAGEMENT v0.6.2
|--------------------------------------------------------------------------
*/

function raidStatusLabel(status) {
    const values = {
        ACTIVE:
            '🟢 Zapisy otwarte',

        CLOSED:
            '🔒 Zapisy zamknięte',

        CANCELLED:
            '❌ Raid anulowany',
    };

    return (
        values[status] ||
        status
    );
}

async function refreshRaidCalendarMessage(
    guild,
    raidId,
    strict = false
) {
    const raid =
        getRaid(
            raidId
        );

    if (
        !raid ||
        !raid.calendar_message_id
    ) {
        if (strict) throw Error('Kalendarz raidu niedostępny');
        return;
    }

    const calendar =
        getChannel(
            guild,
            'kalendarz'
        );

    const signups =
        getChannel(
            guild,
            'zapisy'
        );

    if (!calendar) {
        if (strict) throw Error('Kalendarz raidu niedostępny');
        return;
    }

    let signupUrl=null;
    try { signupUrl=await require('./raid-links.cjs').signupLink(guild,signups,raid); }
    catch(error) {
        if(strict)throw error;
        console.error('Raid signup link unavailable:',error.code||error.name);
    }

    const raidColor =
        raid.status === 'CANCELLED'
            ? 0xED4245
            : raid.status === 'CLOSED'
                ? 0x4F545C
                : 0x8B1E1E;

    const embed =
        new EmbedBuilder()
            .setColor(raidColor)
            .setTitle(
                raid.status === 'CANCELLED'
                    ? `❌ RAID #${raid.id} • ${raid.name}`
                    : `⚔️ RAID #${raid.id} • ${raid.name}`
            )
            .setDescription(
                raid.description ||
                '**Raid The Sentenced**'
            )
            .addFields(
                {
                    name: '📅 TERMIN',
                    value:
                        `<t:${raid.scheduled_ts}:F>\n` +
                        `<t:${raid.scheduled_ts}:R>`,
                    inline: false,
                },
                {
                    name: '🔢 ID RAIDU',
                    value:
                        `**#${raid.id}**`,
                    inline: true,
                },
                {
                    name: '📌 STATUS',
                    value:
                        raidStatusLabel(
                            raid.status
                        ),
                    inline: true,
                },
                {
                    name: '👥 LIMIT',
                    value:
                        raid.player_limit
                            ? `**${raid.player_limit}** graczy`
                            : 'Bez limitu',
                    inline: true,
                },
                {
                    name: '👑 ORGANIZATOR',
                    value:
                        `<@${raid.created_by}>`,
                    inline: true,
                }
            );

    if (signupUrl) {
        embed.addFields({
            name: '📝 ZAPISY',
            value:
                `➡️ [Przejdź do zapisów](${signupUrl})`,
            inline: false,
        });
    } else {
        embed.addFields({name:'📝 ZAPISY',value:raid.status==='ACTIVE'?'Panel zapisów jest obecnie niedostępny.':'Zapisy zamknięte lub panel niedostępny.',inline:false});
    }

    if (
        raid.status === 'CANCELLED' &&
        raid.cancel_reason
    ) {
        embed.addFields({
            name: '❌ POWÓD ANULOWANIA',
            value:
                raid.cancel_reason,
            inline: false,
        });
    }

    embed
        .setFooter({
            text:
                `The Sentenced • Raid #${raid.id} • SentencedBot v${VERSION}`,
        })
        .setTimestamp();

    try {
        const message =
            await calendar.messages.fetch(
                raid.calendar_message_id
            );

        await message.edit({
            embeds: [
                embed
            ],
        });

    } catch (error) {
        if (strict) throw error;
        console.error(
            'Calendar refresh:',
            error.message
        );
    }
}

async function refreshRaidSignupStatusMessage(
    guild,
    raidId
) {
    const raid =
        getRaid(
            raidId
        );

    if (
        !raid ||
        !raid.signup_message_id
    ) {
        return;
    }

    const channel =
        getChannel(
            guild,
            'zapisy'
        );

    if (!channel) {
        return;
    }

    try {
        const message =
            await channel.messages.fetch(
                raid.signup_message_id
            );

        await message.edit(signupPayload(raid, buildRaidSignupEmbed(raidId), raidSignupButtons));

    } catch (error) {
        console.error(
            'Signup status refresh:',
            error.message
        );
    }
}

/*
|--------------------------------------------------------------------------
| PANEL STARTOWY
|--------------------------------------------------------------------------
*/

function startEmbed() {
    return new EmbedBuilder()
        .setColor(0x8B1E1E)
        .setTitle('⚔️ THE SENTENCED')
        .setDescription(
            [
                '**HORDA • WoW: Forever • Rekrutacja do gildii**',
                '',
                'Dołączenie zajmie Ci mniej niż minutę.',
            ].join('\n')
        )
        .addFields(
            {
                name: '① ZGŁOSZENIE',
                value:
                    'Wybierz **Trial bez identyfikacji** albo podaj nick z gry. Nie wymagamy danych prywatnych.',
            },
            {
                name: '② RANGA TRIAL',
                value:
                    '**Trial ma pełny dostęp gracza**, także gdy nie chcesz się identyfikować.\n' +
                    '**Member** wyróżnia kompletny profil i nick potwierdzony przez GM/Oficera — sam quiz nie wystarcza.',
            },
            {
                name: '③ WITAJ W GILDII',
                value:
                    'Przywitaj się na **#ogólny**, zajrzyj do **#wyprawy** i znajdź ekipę. Za Hordę!',
            },
            {
                name: '👤 PROFIL GRACZA',
                value:
                    'Otwórz **Panel gildii** poniżej lub użyj **`/bot`**.\n' +
                    'Uzupełnij postać, znajdź ekipę i zapisz się na wyprawę.',
            }
        )
        .setFooter({
            text: `The Sentenced • Za Hordę! • SentencedBot v${VERSION}`,
        }).setImage('attachment://sentenced-banner.png');
}

function startButton() {
    return [
        new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('onboarding:start')
                    .setLabel('Rozpocznij zgłoszenie')
                    .setEmoji('⚔️')
                    .setStyle(ButtonStyle.Primary)
                ,new ButtonBuilder().setCustomId('botmenu:open').setLabel('Panel gildii').setStyle(ButtonStyle.Success)
                ,new ButtonBuilder().setCustomId('ident:skip').setLabel('Trial bez identyfikacji').setStyle(ButtonStyle.Secondary)
                ,new ButtonBuilder().setCustomId('ident:home').setLabel('Potwierdzenie → Member').setStyle(ButtonStyle.Secondary)
            ),
    ];
}

async function ensureStartPanel(guild) {
    const channel =
        getChannel(guild, 'start');

    if (!channel) {
        throw new Error(
            'Brak kanału #start'
        );
    }

    const settingKey =
        'start_panel_v05';

    const oldMessageId =
        getSetting(settingKey);

    if (oldMessageId) {
        try {
            const message =
                await channel.messages.fetch(
                    oldMessageId
                );

            await message.edit({
                embeds: [startEmbed()],
                components: startButton(),
                flags: 0,
                attachments: [],
                files: [require('path').join(__dirname, 'assets/sentenced-banner.png')],
            });

            console.log(
                '✅ Panel #start zaktualizowany'
            );

            return;
        } catch (_) {}
    }

    const message =
        await channel.send({
            embeds: [startEmbed()],
            components: startButton(),
            files: [require('path').join(__dirname, 'assets/sentenced-banner.png')],
        });

    setSetting(
        settingKey,
        message.id
    );

    try {
        await message.pin();
    } catch (_) {}

    console.log(
        '✅ Panel #start utworzony'
    );
}

function waitingEmbed() {
    return new EmbedBuilder()
        .setColor(0xD99A2B)
        .setTitle('⏳ ZGŁOSZENIE W WERYFIKACJI')
        .setDescription(
            'Twoje zgłoszenie zostało poprawnie wysłane.'
        )
        .addFields(
            {
                name: 'STATUS',
                value:
                    '🟡 **Oczekuje na decyzję GM lub Oficera**',
            },
            {
                name: 'CO TERAZ?',
                value:
                    'Uzupełnij profil przez **`/profil konfiguruj`**.\n' +
                    'Ustawisz klasę, rolę i historię w The Sentenced.',
            },
            {
                name: 'PO AKCEPTACJI',
                value:
                    'Otrzymasz rangę **Trial** i automatycznie odblokują się kanały gildii.',
            },
            {
                name: '👤 TWÓJ PROFIL',
                value:
                    'Sprawdzisz go przez **`/profil moj`**.',
            }
        )
        .setFooter({
            text: `The Sentenced • SentencedBot v${VERSION}`,
        });
}

async function ensureWaitingPanel(guild) {
    const channel =
        getChannel(
            guild,
            'poczekalnia'
        );

    if (!channel) {
        throw new Error(
            'Brak kanału #poczekalnia'
        );
    }

    const settingKey =
        'waiting_panel_v01';

    const oldMessageId =
        getSetting(settingKey);

    if (oldMessageId) {
        try {
            const message =
                await channel.messages.fetch(
                    oldMessageId
                );

            await message.edit({
                embeds: [
                    waitingEmbed()
                ],
            });

            console.log(
                '✅ Panel #poczekalnia zaktualizowany'
            );

            return;
        } catch (_) {}
    }

    const message =
        await channel.send({
            embeds: [
                waitingEmbed()
            ],
        });

    setSetting(
        settingKey,
        message.id
    );

    console.log(
        '✅ Panel #poczekalnia utworzony'
    );
}


/*
|--------------------------------------------------------------------------
| ANKIETA — KROK 1
|--------------------------------------------------------------------------
*/


function nickModal() {
    const modal =
        new ModalBuilder()
            .setCustomId(
                'onboarding:nick'
            )
            .setTitle(
                'The Sentenced'
            );

    const nick =
        new TextInputBuilder()
            .setCustomId('oldnick')
            .setLabel(
                'Twój nick w WoW'
            )
            .setPlaceholder(
                'Obecny lub stary nick z The Sentenced'
            )
            .setRequired(true)
            .setMaxLength(60)
            .setStyle(
                TextInputStyle.Short
            );

    modal.addComponents(
        new ActionRowBuilder()
            .addComponents(nick)
    );

    return modal;
}


function basicModal() {
    const modal =
        new ModalBuilder()
            .setCustomId(
                'onboarding:basic'
            )
            .setTitle(
                'The Sentenced'
            );

    const name =
        new TextInputBuilder()
            .setCustomId('name')
            .setLabel('Imię')
            .setRequired(true)
            .setMaxLength(40)
            .setStyle(
                TextInputStyle.Short
            );

    const age =
        new TextInputBuilder()
            .setCustomId('age')
            .setLabel('Wiek')
            .setRequired(true)
            .setMaxLength(3)
            .setStyle(
                TextInputStyle.Short
            );

    const oldNick =
        new TextInputBuilder()
            .setCustomId('oldnick')
            .setLabel(
                'Stary nick z The Sentenced'
            )
            .setPlaceholder(
                'Jeśli nie grałeś wcześniej — zostaw puste'
            )
            .setRequired(false)
            .setMaxLength(60)
            .setStyle(
                TextInputStyle.Short
            );

    modal.addComponents(
        new ActionRowBuilder()
            .addComponents(name),

        new ActionRowBuilder()
            .addComponents(age),

        new ActionRowBuilder()
            .addComponents(oldNick)
    );

    return modal;
}

function playingButtons() {
    return [
        new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(
                        'onboarding:playing:yes'
                    )
                    .setLabel(
                        'Tak, będę grał'
                    )
                    .setEmoji('✅')
                    .setStyle(
                        ButtonStyle.Success
                    ),

                new ButtonBuilder()
                    .setCustomId(
                        'onboarding:playing:no'
                    )
                    .setLabel(
                        'Nie planuję'
                    )
                    .setEmoji('❌')
                    .setStyle(
                        ButtonStyle.Secondary
                    )
            ),
    ];
}

function interestsSelect() {
    return [
        new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(
                        'onboarding:interests'
                    )
                    .setPlaceholder(
                        'Co Cię interesuje?'
                    )
                    .setMinValues(1)
                    .setMaxValues(4)
                    .addOptions(
                        {
                            label: 'PvE',
                            value: 'PVE',
                            emoji: '🛡️',
                        },
                        {
                            label: 'PvP',
                            value: 'PVP',
                            emoji: '⚔️',
                        },
                        {
                            label: 'Raidy',
                            value: 'RAIDY',
                            emoji: '☠️',
                        },
                        {label:'RP / klimat',value:'RP',emoji:'📜'}
                    )
            ),
    ];
}

function classSelect() {
    return [
        new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(
                        'onboarding:class'
                    )
                    .setPlaceholder(
                        'Wybierz klasę Hordy'
                    )
                    .setMinValues(1)
                    .setMaxValues(1)
                    .addOptions(
                        {
                            label: 'Warrior',
                            value: 'Warrior',
                            emoji: '⚔️',
                        },
                        {
                            label: 'Paladin',
                            value: 'Paladin',
                            emoji: '🛡️',
                        },
                        {
                            label: 'Hunter',
                            value: 'Hunter',
                            emoji: '🏹',
                        },
                        {
                            label: 'Rogue',
                            value: 'Rogue',
                            emoji: '🗡️',
                        },
                        {
                            label: 'Priest',
                            value: 'Priest',
                            emoji: '✨',
                        },
                        {
                            label: 'Shaman',
                            value: 'Shaman',
                            emoji: '🌩️',
                        },
                        {
                            label: 'Mage',
                            value: 'Mage',
                            emoji: '🔮',
                        },
                        {
                            label: 'Warlock',
                            value: 'Warlock',
                            emoji: '🔥',
                        },
                        {
                            label: 'Druid',
                            value: 'Druid',
                            emoji: '🌿',
                        }
                    )
            ),
    ];
}

function roleSelect() {
    return [
        new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(
                        'onboarding:role'
                    )
                    .setPlaceholder(
                        'Wybierz funkcję'
                    )
                    .setMinValues(1)
                    .setMaxValues(1)
                    .addOptions(
                        {
                            label: 'Tank',
                            value: 'TANK',
                            emoji: '🛡️',
                        },
                        {
                            label: 'DPS',
                            value: 'DPS',
                            emoji: '⚔️',
                        },
                        {
                            label: 'Heal',
                            value: 'HEAL',
                            emoji: '💚',
                        }
                    )
            ),
    ];
}

/*
|--------------------------------------------------------------------------
| FINALIZACJA ANKIETY
|--------------------------------------------------------------------------
*/

async function finalizeSurvey(
    interaction,
    data
) {
    const guild =
        interaction.guild;

    const member =
        await guild.members.fetch(
            interaction.user.id
        );

    upsertMember(member);

    sql.submit.run(
        data.name,
        data.age,
        data.oldNick || '',
        data.playing,
        (data.interests || []).join(','),
        data.wowClass || '',
        data.wowRole || '',
        now(),
        member.id
    );

    /*
     * Po zakończeniu ankiety
     * automatycznie nadajemy Trial.
     */
    if (!hasGuildRank(member)) {
        const trial =
            getRole(
                guild,
                'Trial'
            );

        if (!trial) {
            throw new Error(
                'Nie znaleziono roli Trial'
            );
        }

        await member.roles.add(
            trial,
            'Automatyczny Trial po wypełnieniu ankiety'
        );

        const waiting =
            getRole(
                guild,
                'Oczekujący'
            );

        if (
            waiting &&
            member.roles.cache.has(
                waiting.id
            )
        ) {
            await member.roles.remove(
                waiting
            );
        }

        sql.approve.run(
            now(),
            client.user.id,
            member.id
        );

        return;
    }

    /*
     * Użytkownik ma już główną rangę
     * (np. GM podczas testu).
     * Zachowujemy ją i kończymy onboarding
     * bez ręcznej akceptacji.
     */
    sql.approve.run(
        now(),
        client.user.id,
        member.id
    );

    return;

    await sendSimpleReviewCard(
        guild,
        interaction.user,
        data
    );

    await announce(
        guild,
        `⏳ <@${member.id}> wypełnił ankietę i oczekuje na decyzję GM / Oficera.`
    );

    await refreshGuildState(
        guild
    );
}


async function sendSimpleReviewCard(
    guild,
    user,
    data
) {
    const channel =
        getChannel(
            guild,
            'oficerka'
        );

    if (!channel) {
        throw new Error(
            'Brak #oficerka'
        );
    }

    const embed =
        new EmbedBuilder()
            .setTitle(
                '📋 NOWE ZGŁOSZENIE'
            )
            .setDescription(
                `<@${user.id}>`
            )
            .addFields(
                {
                    name:
                        '🏅 Nick w WoW',
                    value:
                        data.oldNick ||
                        'Nie podano',
                    inline: true,
                }
            )
            .setFooter({
                text:
                    `Discord: ${user.tag}`,
            })
            .setTimestamp();

    const buttons =
        new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(
                        `review:accept:${user.id}`
                    )
                    .setLabel(
                        'Przyjmij jako Trial'
                    )
                    .setEmoji('✅')
                    .setStyle(
                        ButtonStyle.Success
                    ),

                new ButtonBuilder()
                    .setCustomId(
                        `review:reject:${user.id}`
                    )
                    .setLabel('Odrzuć')
                    .setEmoji('❌')
                    .setStyle(
                        ButtonStyle.Danger
                    )
            );

    await channel.send({
        embeds: [embed],
        components: [buttons],
    });
}


async function sendReviewCard(
    guild,
    user,
    data
) {
    const channel =
        getChannel(
            guild,
            'oficerka'
        );

    if (!channel) {
        throw new Error(
            'Brak #oficerka'
        );
    }

    const playing =
        data.playing === 'TAK'
            ? '✅ TAK'
            : '❌ NIE';

    const roleMap = {
        TANK: '🛡️ Tank',
        DPS: '⚔️ DPS',
        HEAL: '💚 Heal',
    };

    const embed =
        new EmbedBuilder()
            .setTitle(
                '📋 NOWA ANKIETA'
            )
            .setDescription(
                `<@${user.id}>`
            )
            .addFields(
                {
                    name: '👤 Imię',
                    value: data.name,
                    inline: true,
                },
                {
                    name: '🎂 Wiek',
                    value:
                        String(data.age),
                    inline: true,
                },
                {
                    name:
                        '🏅 Stary nick TS',
                    value:
                        data.oldNick ||
                        'Nie podano',
                    inline: true,
                },
                {
                    name:
                        '🌍 WoW Forever',
                    value: playing,
                    inline: true,
                },
                {
                    name:
                        '🎮 Zainteresowania',
                    value:
                        readableInterests(
                            data.interests
                        ),
                    inline: true,
                },
                {
                    name: '🧙 Klasa',
                    value:
                        data.wowClass ||
                        '—',
                    inline: true,
                },
                {
                    name: '⚔️ Funkcja',
                    value:
                        roleMap[
                            data.wowRole
                        ] ||
                        '—',
                    inline: true,
                }
            )
            .setFooter({
                text:
                    `Discord: ${user.tag}`,
            })
            .setTimestamp();

    const buttons =
        new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(
                        `review:accept:${user.id}`
                    )
                    .setLabel(
                        'Przyjmij jako Trial'
                    )
                    .setEmoji('✅')
                    .setStyle(
                        ButtonStyle.Success
                    ),

                new ButtonBuilder()
                    .setCustomId(
                        `review:reject:${user.id}`
                    )
                    .setLabel('Odrzuć')
                    .setEmoji('❌')
                    .setStyle(
                        ButtonStyle.Danger
                    )
            );

    await channel.send({
        embeds: [embed],
        components: [buttons],
    });
}

/*
|--------------------------------------------------------------------------
| STAN GILDII
|--------------------------------------------------------------------------
*/

function count(query) {
    return db.prepare(query).get().c;
}

async function buildGuildState(guild) {
    return statusEmbeds(db,guild);
}

async function refreshGuildStateNow(
    guild
) {
    const channel =
        getChannel(
            guild,
            'stan-gildii'
        );

    if (!channel) {
        return;
    }

    const embeds =
        await buildGuildState(guild);

    const key = 'guild_state_v05';

    const messageId =
        getSetting(key);

    if (messageId) {
        try {
            const message =
                await channel.messages.fetch(
                    messageId
                );

            await message.edit({
                embeds,
                components: statusComponents(),
            });

            return;
        } catch (_) {}
    }

    const message =
        await channel.send({
            embeds,
            components: statusComponents(),
        });

    setSetting(
        key,
        message.id
    );

    try {
        await message.pin();
    } catch (_) {}
}

/*
 * Wiele zdarzeń Discorda może dotyczyć jednej zmiany rangi/profilu.
 * Grupujemy je w jeden zapis panelu i nie uruchamiamy odświeżeń równolegle.
 */
const guildStateRefreshQueues =
    new Map();

function refreshGuildState(guild) {
    return new Promise(
        (resolve, reject) => {
            let queue =
                guildStateRefreshQueues.get(
                    guild.id
                );

            if (!queue) {
                queue = {
                    timer: null,
                    running: null,
                    waiters: [],
                };

                guildStateRefreshQueues.set(
                    guild.id,
                    queue
                );
            }

            queue.waiters.push({
                resolve,
                reject,
            });

            if (queue.timer) {
                clearTimeout(
                    queue.timer
                );
            }

            queue.timer = setTimeout(
                async () => {
                    queue.timer = null;

                    const waiters =
                        queue.waiters.splice(0);

                    try {
                        if (queue.running) {
                            await queue.running;
                        }

                        queue.running =
                            refreshGuildStateNow(
                                guild
                            );

                        await queue.running;

                        for (const waiter of waiters) {
                            waiter.resolve();
                        }
                    } catch (error) {
                        for (const waiter of waiters) {
                            waiter.reject(error);
                        }
                    } finally {
                        queue.running = null;
                    }
                },
                1500
            );
        }
    );
}

/*
|--------------------------------------------------------------------------
| READY
|--------------------------------------------------------------------------
*/

client.once(
    Events.ClientReady,
    async () => {
        try {
            const guild =
                client.guilds.cache.get(
                    GUILD_ID
                );

            if (!guild) {
                throw new Error(
                    'Nie znaleziono serwera'
                );
            }

            require('./companion-api.cjs')({db,guild,refresh:()=>refreshGuildState(guild)});


            console.log('');
            console.log(
                '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
            );
            console.log(
                `⚔️ THE SENTENCED v${VERSION}`
            );
            console.log(
                '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
            );
            console.log(
                `✅ ${client.user.tag}`
            );
            console.log(
                `🏰 ${guild.name}`
            );
            console.log(
                `💾 ${DB_PATH}`
            );

            let previousMaintenance;
            const updatePresence = () => {
                const maintenance = require('./maintenance.cjs').maintenance(db);
                if (maintenance === previousMaintenance) return;
                previousMaintenance = maintenance;
                client.user.setPresence({activities:[{name:maintenance?'The Sentenced • maintenance':`The Sentenced • WoW Forever • ${VERSION}`,type:ActivityType.Watching}],status:maintenance?'dnd':'online'});
            };
            updatePresence();
            setInterval(updatePresence,10000).unref();

            /*
             * Jedna pełna synchronizacja przy starcie.
             * Późniejsze odświeżenia korzystają z cache i eventów.
             */
            try {
                await guild.members.fetch();

                console.log(
                    `✅ Cache członków: ${guild.members.cache.size}/${guild.memberCount}`
                );

                const owner =
                    guild.members.cache.get(
                        guild.ownerId
                    );

                upsertMember(owner);
            } catch (error) {
                console.error(
                    'INITIAL MEMBER SYNC:',
                    error.message
                );
            }

            await tsGateV6.ensurePanels(guild);
            await ensureAddonPanel({guild, getSetting, setSetting});
            await ensureEkipaCommand(guild);

            await refreshGuildState(
                guild
            );

            const pollsRefreshed =
                await refreshAllPollMessages({
                    guild,
                    db,
                });

            console.log(
                `✅ Ankiety odświeżone: ${pollsRefreshed}`
            );

            const raidsToRefresh =
                db.prepare(`
                    SELECT id
                    FROM raids
                    WHERE
                        calendar_message_id IS NOT NULL
                        OR signup_message_id IS NOT NULL
                `).all();

            for (const raid of raidsToRefresh) {
                await refreshRaidCalendarMessage(
                    guild,
                    raid.id
                );

                await refreshRaidSignupMessage(
                    guild,
                    raid.id
                );
            }

            console.log(
                `✅ Raidy odświeżone: ${raidsToRefresh.length}`
            );

            startRaidReminderEngine({
                db,
                guild,
                getChannel,
            });
        community = createCommunity({db,guild,getChannel,
            refreshRaids: async id => {await refreshRaidCalendarMessage(guild,id);await refreshRaidSignupMessage(guild,id);},
            refreshPolls: () => refreshAllPollMessages({db,guild,getChannel}),
        });
        await community.start();
        if (process.env.SENTENCED_INTEGRATION_ENABLED === 'true') {
            const core = require('./guild-core');
            integration = require('./integration-service.cjs')({db,guild,
                hasPlayer: member => core.has(member), hasStaff: member => core.has(member,core.STAFF),getChannel,
                authorizeStaff: tsGateV6 ? id=>tsGateV6.requireModerator(guild,id) : undefined,
                reviewQueue: tsGateV6 ? (id,page)=>tsGateV6.reviewQueue(guild,id,page) : undefined,
                reviewApplication: tsGateV6 ? (id,action,candidate,revision)=>tsGateV6.reviewApplication(guild,id,action,candidate,revision) : undefined,
                refreshProfile:()=>refreshGuildState(guild),
                refreshRaid:async id=>{await refreshRaidSignupMessage(guild,id,true);await refreshRaidCalendarMessage(guild,id,true);},
                recordVote:(ctx,id,option)=>recordVote(db,ctx,id,option),
                refreshPoll:poll=>refreshPollMessage({guild},db,poll),
                joinExpedition:(e,id,role)=>require('./community').joinExpedition(db,e,id,role),
                refreshLfg:async id=>{await require('./lfg-actions.cjs').publishExpedition({db,guild,channel:getChannel(guild,'wyprawy'),payload:community.lfgPayload,id});},
            });
            integrationDevices = require('./device-api.cjs').createDevices({db,guild,service:integration,key:process.env.DISCORD_TOKEN});
            require('./device-api.cjs').startDeviceAPI({devices:integrationDevices});
            const staffBridgeDirectory=path.join(DATA_DIR,'staff-bridge');
            if(tsGateV6 && process.platform!=='win32' && fs.existsSync(path.join(staffBridgeDirectory,'enabled'))){
                require('./staff-local-bridge.cjs').startStaffLocalBridge({db,guild,service:integration,
                    directory:staffBridgeDirectory});
            }
            console.log('[integration] 2.5 device API ready on loopback 8880');
        }
        const milestones=createGuildMilestones({db,guild,getChannel});
        guildHistory=createGuildHistory({db,guild,getChannel});
        await guildHistory.start();
        introductions = createIntroductions({guild,db,getSetting,setSetting});
        try { await introductions.ensurePanel(); } catch(e) { console.error('[intro] panel',e.code||e.name); }
        guildHub = createGuildHub({db,guild,getChannel,community,milestones,refreshGuildState:()=>refreshGuildState(guild)});
        guildIdentity = createGuildIdentity({db,guild,getChannel,refreshGuildState:()=>refreshGuildState(guild)});
        guildNotifications = createGuildNotifications({db,guild,getChannel});
        guildNotifications.start();
        if (process.env.TS_ROSTER_ENABLED === 'true') {
            try {
                const importer = require('./roster/import.cjs').createImporter(db);
                rosterRuntime = require('./roster/discord.cjs').createRosterDiscord({
                    db, importer, guildId:GUILD_ID, ownerId:guild.ownerId,
                    officerRoleIds:(process.env.TS_ROSTER_OFFICER_ROLE_IDS||'').split(',').filter(Boolean),
                    refresh:()=>refreshGuildStateNow(guild),
                });
            } catch(error) { rosterRuntime=null;console.error('[roster] startup failed',error.code||error.message); }
        }
        if (process.env.TS_ELECTION_ENABLED === 'true') {
            try {
                const secret = fs.readFileSync(process.env.TS_ELECTION_SECRET_PATH);
                electionRuntime = require('./election/runtime.cjs').createElectionRuntime({
                    db, client, guildId: GUILD_ID,
                    channelId: process.env.TS_ELECTION_CHANNEL_ID,
                    generalChannelId: process.env.TS_ELECTION_GENERAL_CHANNEL_ID,
                    allowedRoleIds: (process.env.TS_ELECTION_ROLE_IDS || '').split(',').filter(Boolean),
                    ownerId: guild.ownerId, secret,
                    log: (code, detail) => console.error('[election]', code, detail),
                });
                await electionRuntime.start();
            } catch (error) {
                electionRuntime = null;
                console.error('[election] startup failed', error.code || error.message);
            }
        }

        milestones.start();
        console.log('✅ Guild Hub 2.1 online | identity notifications milestones');

            await require('./guild-ops-v3')
                .startGuildOpsV3({
                    manageLayout: false,
                    client,
                    guild,
                    db,
                    getChannel,
                    sendPersonalizedWelcome,
                    refreshGuildStateNow,
                });

        // Historical one-shot migrations are NOT normal startup tasks.
        // Missing/corrupt JSON must never authorize deleting public history
        // or replaying catch-up announcements. Modules retained for recovery.
        console.log('🛡️ Historyczne migracje publiczne: tylko ręcznie, poza startem');





            await refreshGuildStateNow(
                guild
            );

            setInterval(
                () =>
                    refreshGuildStateNow(
                        guild
                    ).catch(error =>
                        console.error(
                            'GUILD STATE FALLBACK:',
                            error
                        )
                    ),
                60 * 1000
            );

            console.log(
                '✅ #start online'
            );

            console.log(
                '✅ #stan-gildii PRO v2 online'
            );

            console.log(
                '✅ onboarding v0.5 online'
            );

            console.log('');
        } catch (error) {
            console.error(
                'READY:',
                error
            );
        }
    }
);

/*
|--------------------------------------------------------------------------
| NOWY UŻYTKOWNIK
|--------------------------------------------------------------------------
*/

client.on(
    Events.GuildMemberAdd,
    async member => {
        if (
            member.user.bot ||
            member.guild.id !==
                GUILD_ID
        ) {
            return;
        }

        const previous =
            sql.getMember.get(member.id);

        upsertMember(member);
        if (TS_ONBOARDING_V6_ENABLED) {
            // No guild role, no approval and no public welcome on bare join.
            await tsGateV6.onJoin(member);
        }

        if (!previous || previous.left_at) {
            db.prepare(`
                UPDATE members
                SET
                    joined_at = ?,
                    join_announced_at = NULL
                WHERE user_id = ?
            `).run(
                now(),
                member.id
            );
        }

        const start =
            getChannel(
                member.guild,
                'start'
            );

        if (start) {
            try {
                await member.send(
                    [
                        '⚔️ **Witaj w The Sentenced!**',
                        '',
                        'Wypełnij ankietę startową:',
                        `https://discord.com/channels/${member.guild.id}/${start.id}`,
                    ].join('\n')
                );
            } catch (_) {}
        }

        if (!TS_ONBOARDING_V6_ENABLED) {
            await sendRawJoinAnnouncement(member.guild, member);
        }

        await refreshGuildState(
            member.guild
        );
    }
);

client.on(
    Events.GuildMemberRemove,
    async member => {
        if (
            member.user.bot ||
            member.guild.id !==
                GUILD_ID
        ) {
            return;
        }

        sql.left.run(
            now(),
            now(),
            member.id
        );

        voiceSessions.delete(
            member.id
        );

        await refreshGuildState(
            member.guild
        );
    }
);

/*
|--------------------------------------------------------------------------
| AKTYWNOŚĆ
|--------------------------------------------------------------------------
*/

client.on(
    Events.MessageCreate,
    message => {
        if (
            !message.guild ||
            message.guild.id !==
                GUILD_ID ||
            message.author.bot
        ) {
            return;
        }

        upsertMember(
            message.member
        );

        sql.message.run(
            now(),
            message.author.id
        );
    }
);

client.on(
    Events.VoiceStateUpdate,
    (
        oldState,
        newState
    ) => {
        const member =
            newState.member ||
            oldState.member;

        if (
            !member ||
            member.user.bot ||
            member.guild.id !==
                GUILD_ID
        ) {
            return;
        }

        upsertMember(member);

        if (
            !oldState.channelId &&
            newState.channelId
        ) {
            voiceSessions.set(
                member.id,
                now()
            );

            return;
        }

        if (
            oldState.channelId &&
            !newState.channelId
        ) {
            const start =
                voiceSessions.get(
                    member.id
                );

            if (!start) {
                return;
            }

            const seconds =
                Math.max(
                    1,
                    Math.floor(
                        (
                            now() -
                            start
                        ) / 1000
                    )
                );

            sql.voice.run(
                seconds,
                now(),
                member.id
            );

            voiceSessions.delete(
                member.id
            );
        }
    }
);

/*
|--------------------------------------------------------------------------
| INTERACTIONS
|--------------------------------------------------------------------------
*/

client.on(
    Events.InteractionCreate,
    async interaction => {
        try {

            if(await require('./maintenance.cjs').guardInteraction(db,interaction))return;
            if (interaction.customId === 'pubapp:view') {
                if (!publicApplications) publicApplications = require('./recruitment/public.cjs').createPublicApplications({db,guild:interaction.guild,forumId:'1574134857767063645'});
                await publicApplications.handle(interaction);
                return;
            }
            if (interaction.customId?.startsWith('roster:')) {
                if (rosterRuntime) await rosterRuntime.handle(interaction);
                else if (interaction.isRepliable()) await interaction.reply({content:'Roster jest chwilowo niedostępny.',flags:MessageFlags.Ephemeral});
                return;
            }
            if (interaction.customId?.startsWith('elect:')) {
                if (electionRuntime) await electionRuntime.handle(interaction);
                else if (interaction.isRepliable()) await interaction.reply({content:'Wybory są chwilowo niedostępne.',flags:MessageFlags.Ephemeral});
                return;
            }
            if (interaction.customId?.startsWith('ts:')) {
                await tsGateV6.handle(interaction);
                return;
            }
            if (/^(veteran|vet2|tsv2|beta|onboarding|review|ident|profile:forever):/.test(interaction.customId || '')) {
                if (interaction.isRepliable()) await interaction.reply({
                    content: 'Ten panel został wycofany. Użyj aktualnego formularza lub /bot.',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            if (TS_ONBOARDING_V6_ENABLED && tsGateV6.shouldBlockLegacy(interaction)) {
                if (interaction.isRepliable()) {
                    await interaction.reply({
                        content: '⚠️ Użyj regulaminu oraz nowego formularza na #start. Stare przyciski Trial i identyfikacji nie nadają już dostępu.',
                        flags: MessageFlags.Ephemeral,
                        allowedMentions: {parse: []},
                    });
                }
                return;
            }
            if(interaction.commandName === 'ekipa'){
                await handleEkipaCommand(interaction, db);
                return;
            }

            if(interaction.customId?.startsWith('history:')){
                if(guildHistory)await guildHistory.handle(interaction);
                else await interaction.reply({content:'Kronika jeszcze się uruchamia. Spróbuj za chwilę.',flags:MessageFlags.Ephemeral});
                return;
            }
            if (interaction.customId?.startsWith('transfer:')) {
                await require('./transfer-sync.cjs').handle({interaction,service:integration,db,guildId:GUILD_ID});
                return;
            }
            if (interaction.customId?.startsWith('integration:')) {
                if (!integration || !integrationDevices) {await interaction.reply({content:'Integracja 2.5 nie jest jeszcze uruchomiona.',flags:MessageFlags.Ephemeral});return;}
                await interaction.deferReply({flags:MessageFlags.Ephemeral});
                const member=await getInteractionMember(interaction);
                if (!require('./guild-core').has(member)) {await interaction.editReply('Brak aktualnego dostępu gildii.');return;}
                const kind=interaction.customId.slice('integration:'.length);
                if(kind==='revoke') {integrationDevices.revoke(member.id);await interaction.editReply('Odłączono wszystkie Twoje urządzenia i addon.');return;}
                const code=kind==='addon'?await integration.issuePairCode(member.id):await integrationDevices.issueCode(member.id,kind==='relay'?'relay':'client');
                await interaction.editReply('Kod do '+(kind==='addon'?'addonu w grze':'programu The Sentenced')+': **'+code+'**. Ważny 10 minut, jednorazowy. Nie udostępniaj. Parowanie nie zmienia rangi gildii.');
                return;
            }
            if (interaction.customId?.startsWith('intro:')) {
                if (introductions) await introductions.handle(interaction);
                else await interaction.reply({content:'Formularz chwilowo się uruchamia.',flags:MessageFlags.Ephemeral});
                return;
            }
            if (interaction.customId?.startsWith('identity:') || interaction.customId?.startsWith('notify:')) {
                const handler=interaction.customId.startsWith('identity:')?guildIdentity:guildNotifications;
                if(handler)await handler.handle(interaction);
                else await interaction.reply({content:'Centrum gildii jeszcze się uruchamia. Spróbuj za chwilę.',flags:MessageFlags.Ephemeral});
                return;
            }
            if (interaction.customId?.startsWith('v2:')) {
                if (guildHub) await guildHub.handle(interaction);
                else await interaction.reply({content:'Centrum gildii jeszcze się uruchamia. Spróbuj za chwilę.',flags:MessageFlags.Ephemeral});
                return;
            }
            if (interaction.customId?.startsWith('sc:')) {
                if (community) await community.handle(interaction);
                else await interaction.reply({content:'Centrum gildii jeszcze się uruchamia. Spróbuj za chwilę.',flags:MessageFlags.Ephemeral});
                return;
            }

            /*
            ================================================================
            ANKIETY
            ================================================================
            */


            /*
            ================================================================
            /PROFIL USTAW
            ================================================================
            */

            if (
                interaction.isChatInputCommand() &&
                interaction.commandName ===
                    'profil'
            ) {

                const profileSubcommand =
                    interaction.options.getSubcommand();

                if (
                    profileSubcommand === 'konfiguruj'
                ) {
                    profileSessions.set(
                        interaction.user.id,
                        {
                            gameNick: '',
                            plansForever: null,
                            wowClass: '',
                            wowRole: '',
                            playedBefore: null,
                            oldNick: '',
                        }
                    );

                    await interaction.showModal(
                        profileGameNickModal()
                    );

                    return;
                }

                if (
                    profileSubcommand === 'moj'
                ) {
                    const member =
                        await getInteractionMember(
                            interaction
                        );

                    upsertMember(member);

                    const record =
                        sql.getMember.get(
                            member.id
                        );

                    await interaction.reply({
                        content:
                            [
                                '⚔️ **TWÓJ PROFIL — THE SENTENCED**',
                                '',
                                `🌍 WoW: Forever • live`,
                                `🎮 Nick w WoW: **${record?.game_nick || '—'}**`,
                                `🧙 Klasa: **${record?.wow_class || '—'}**`,
                                `⚔️ Rola: **${profileRoleLabel(record?.wow_role)}**`,
                                `🏰 Grałeś wcześniej w The Sentenced: **${record?.played_before_ts || '—'}**`,
                                `🏅 Dawny nick: **${record?.old_ts_nick || '—'}**`,
                                '',
                                'Aby zmienić dane, użyj **`/profil konfiguruj`**.',
                            ].join('\n'),
                        flags:
                            MessageFlags.Ephemeral,
                    });

                    return;
                }


                const moderator =
                    await getInteractionMember(
                        interaction
                    );

                if (
                    !isGMOrOfficer(
                        moderator
                    )
                ) {
                    await interaction.reply({
                        content:
                            '❌ Tylko GM lub Oficer może edytować profile.',
                        flags:
                            MessageFlags.Ephemeral,
                    });

                    return;
                }

                if (
                    interaction.options.getSubcommand() ===
                        'ustaw'
                ) {
                    const user =
                        interaction.options.getUser(
                            'uzytkownik',
                            true
                        );

                    const target =
                        await interaction.guild.members.fetch(
                            user.id
                        );

                    const nick =
                        interaction.options.getString(
                            'nick'
                        );

                    const wowClass =
                        interaction.options.getString(
                            'klasa'
                        );

                    const wowRole =
                        interaction.options.getString(
                            'funkcja'
                        );

                    const interests =
                        interaction.options.getString(
                            'zainteresowania'
                        );

                    if (
                        nick === null &&
                        wowClass === null &&
                        wowRole === null &&
                        interests === null
                    ) {
                        await interaction.reply({
                            content:
                                '⚠️ Podaj przynajmniej jedno pole do zmiany.',
                            flags:
                                MessageFlags.Ephemeral,
                        });

                        return;
                    }

                    sql.upsert.run(
                        target.id,
                        target.user.tag,
                        target.displayName,
                        target.joinedTimestamp ||
                            now(),
                        now()
                    );

                    db.prepare(`
                        UPDATE members
                        SET
                            game_nick =
                                COALESCE(
                                    ?,
                                    game_nick
                                ),
                            wow_class =
                                COALESCE(
                                    ?,
                                    wow_class
                                ),
                            wow_role =
                                COALESCE(
                                    ?,
                                    wow_role
                                ),
                            interests =
                                COALESCE(
                                    ?,
                                    interests
                                )
                        WHERE user_id = ?
                    `).run(
                        nick,
                        wowClass,
                        wowRole,
                        interests,
                        target.id
                    );

                    const record =
                        sql.getMember.get(
                            target.id
                        );

                    await interaction.reply({
                        content:
                            [
                                `✅ Zaktualizowano profil <@${target.id}>`,
                                '',
                                `🎮 Nick w WoW: **${record.game_nick || '—'}**`,
                                `🧙 Klasa: **${record.wow_class || '—'}**`,
                                `⚔️ Funkcja: **${record.wow_role || '—'}**`,
                                `🎮 Zainteresowania: **${record.interests || '—'}**`,
                            ].join('\n'),
                        flags:
                            MessageFlags.Ephemeral,
                    });

                    await refreshGuildState(
                        interaction.guild
                    );

                    return;
                }
            }


            const pollHandled =
                await handlePollInteraction({
                    interaction,
                    db,
                    getChannel,
                });

            if (pollHandled) {
                return;
            }


/*
            ================================================================
            /RAID UTWORZ — v0.6.1
            ================================================================
            */

            if (
                interaction.isChatInputCommand() &&
                interaction.commandName === 'raid' &&
                interaction.options.getSubcommand() === 'utworz'
            ) {
                await interaction.deferReply({
                    flags:
                        MessageFlags.Ephemeral,
                });

                const member =
                    await getInteractionMember(
                        interaction
                    );

                if (
                    !isRaidManager(
                        member
                    )
                ) {
                    await interaction.editReply({
                        content:
                            '❌ Raid może utworzyć GM, Oficer lub Raid Lider.',
                    });

                    return;
                }

                const raidType =
                    interaction.options.getString(
                        'raid',
                        true
                    );

                const date =
                    interaction.options.getString(
                        'data',
                        true
                    );

                const time =
                    interaction.options.getString(
                        'godzina',
                        true
                    );

                const customName =
                    interaction.options.getString(
                        'wlasna_nazwa'
                    );

                const description =
                    interaction.options.getString(
                        'opis'
                    );

                const customLimit =
                    interaction.options.getInteger(
                        'limit'
                    );

                const definitions = {
                    BARROW_DEEPS: {
                        name:
                            'Barrow Deeps',

                        limit: 10,
                    },

                    HYJAL_SUMMIT: {
                        name:
                            'Hyjal Summit',

                        limit: 20,
                    },

                    CUSTOM: {
                        name:
                            customName ||
                            null,

                        limit:
                            customLimit ||
                            null,
                    },
                };

                const definition =
                    definitions[
                        raidType
                    ];

                if (!definition) {
                    await interaction.editReply({
                        content:
                            '❌ Nie rozpoznano raidu.',
                    });

                    return;
                }

                if (
                    raidType === 'CUSTOM' &&
                    !customName
                ) {
                    await interaction.editReply({
                        content:
                            '❌ Dla własnego wydarzenia podaj **wlasna_nazwa**.',
                    });

                    return;
                }

                /*
                 * Polska strefa czasowa.
                 */
                const raidDate =
                    DateTime.fromFormat(
                        `${date} ${time}`,
                        'dd.MM.yyyy HH:mm',
                        {
                            zone:
                                'Europe/Warsaw',
                        }
                    );

                if (!raidDate.isValid) {
                    await interaction.editReply({
                        content:
                            '❌ Data lub godzina jest niepoprawna. Użyj np. **12.12.2026** i **20:00**.',
                    });

                    return;
                }

                if (
                    raidDate.toMillis() <=
                    Date.now()
                ) {
                    await interaction.editReply({
                        content:
                            '❌ Termin raidu musi być w przyszłości.',
                    });

                    return;
                }

                const calendar =
                    getChannel(
                        interaction.guild,
                        'kalendarz'
                    );

                const signups =
                    getChannel(
                        interaction.guild,
                        'zapisy'
                    );

                if (
                    !calendar ||
                    !signups
                ) {
                    await interaction.editReply({
                        content:
                            '❌ Brakuje #kalendarz lub #zapisy.',
                    });

                    return;
                }

                const unix =
                    Math.floor(
                        raidDate.toSeconds()
                    );

                const raidPublish=require('./raid-create.cjs');
                const creation=raidPublish.createOnce(db,{interactionId:interaction.id,type:raidType,name:definition.name,scheduled:unix,limit:definition.limit,description:description||'',userId:interaction.user.id,createdAt:now()});
                const raidId=creation.id;
                if(creation.existing){await interaction.editReply({content:`Raid #${raidId} został już zapisany dla tego zgłoszenia. Sprawdź #kalendarz i #zapisy przed ponowną próbą.`});return;}

                /*
                 * ZAPISY
                 */
                const signupResult =
                    await raidPublish.publish({db,channel:signups,raidId,kind:'signup',payload:{
                        embeds: [
                            buildRaidSignupEmbed(
                                raidId
                            ),
                        ],

                        components:
                            raidSignupButtons(
                                raidId
                            ),
                    }});
                if(!signupResult.ok){await interaction.editReply({content:`Raid #${raidId} zapisano, ale publikacja zapisów ma niepewny wynik. Sprawdź #zapisy przed ponowną próbą; nie twórz kolejnego raidu.`});return;}
                const signupMessage=signupResult.message;

                /*
                 * KALENDARZ
                 */
                const calendarEmbed =
                    new EmbedBuilder()
                        .setTitle(
                            `⚔️ ${definition.name}`
                        )

                        .setDescription(
                            description ||
                            'Raid The Sentenced'
                        )

                        .addFields(
                            {
                                name:
                                    '📅 Termin',

                                value:
                                    `<t:${unix}:F>\n<t:${unix}:R>`,
                            },

                            {
                                name:
                                    '👥 Limit',

                                value:
                                    definition.limit
                                        ? String(
                                            definition.limit
                                        )
                                        : 'Bez ustalonego limitu',

                                inline: true,
                            },

                            {
                                name:
                                    '👑 Organizator',

                                value:
                                    `<@${interaction.user.id}>`,

                                inline: true,
                            },

                            {
                                name:
                                    '📝 Zapisy',

                                value:
                                    `[Przejdź do zapisów](${signupMessage.url})`,
                            }
                        )

                        .setFooter({
                            text:
                                `The Sentenced • Raid #${raidId} • v0.6.1`,
                        })

                        .setTimestamp();

                const calendarResult =
                    await raidPublish.publish({db,channel:calendar,raidId,kind:'calendar',payload:{
                        embeds: [
                            calendarEmbed
                        ],
                    }});
                if(!calendarResult.ok){await interaction.editReply({content:`Raid #${raidId} i panel zapisów zostały utworzone: ${signupMessage.url}\nPublikacja kalendarza ma niepewny wynik. Sprawdź #kalendarz przed ponowną próbą.`});return;}

                await interaction.editReply({
                    content:
                        `✅ Raid **${definition.name}** utworzony.\n📅 #kalendarz\n📝 #zapisy`,
                });

                return;
            }

            /*
            ================================================================
            RAID — BĘDĘ / MOŻE / NIE BĘDĘ
            ================================================================
            */

            if (
                interaction.isButton() &&
                interaction.customId.startsWith(
                    'raid:signup:'
                )
            ) {
                const parts =
                    interaction.customId.split(
                        ':'
                    );

                const raidId =
                    Number(
                        parts[2]
                    );

                const signupStatus =
                    parts[3];

                if (!Number.isSafeInteger(raidId) || !['YES','MAYBE','NO'].includes(signupStatus)) {
                    await interaction.reply({content:'Nieprawidłowy zapis na raid.',flags:MessageFlags.Ephemeral});
                    return;
                }

                let raid =
                    getRaid(
                        raidId
                    );

                if (
                    !raid ||
                    raid.status !== 'ACTIVE'
                ) {
                    await interaction.reply({
                        content:
                            '❌ Ten raid nie jest już aktywny.',

                        flags:
                            MessageFlags.Ephemeral,
                    });

                    return;
                }

                const member =
                    await getInteractionMember(
                        interaction
                    );

                if (
                    !hasGuildRank(
                        member
                    )
                ) {
                    await interaction.reply({
                        content:
                            '❌ Zapisy są dostępne dla członków gildii.',

                        flags:
                            MessageFlags.Ephemeral,
                    });

                    return;
                }

                upsertMember(
                    member
                );

                // Fetching a member above yields: closure may have happened.
                raid = getRaid(raidId);
                if (!raid || raid.status !== 'ACTIVE' || raid.scheduled_ts <= Math.floor(Date.now()/1000)) {
                    await interaction.reply({content:'Ten raid jest zamknięty albo jego termin minął.',flags:MessageFlags.Ephemeral});
                    return;
                }

                const signupOutcome = require('./guild-actions.cjs').recordRaidSignup(db,{raidId,userId:member.id,status:signupStatus});
                if (signupOutcome.error) {
                    await interaction.reply({content:signupOutcome.error,flags:MessageFlags.Ephemeral});
                    return;
                }

                await interaction.deferUpdate();

                await refreshRaidSignupMessage(
                    interaction.guild,
                    raidId
                );

                const response = {
                    YES:
                        '✅ Zapisano: **Będę**',
                    MAYBE:
                        '🤔 Zapisano: **Może**',
                    NO:
                        '❌ Zapisano: **Nie będę**',
                };

                await interaction.followUp({
                    content:
                        response[
                            signupStatus
                        ] ||
                        '✅ Zapis zaktualizowany.',

                    flags:
                        MessageFlags.Ephemeral,
                });

                return;
            }


            /*
            ================================================================
            /RAID EDYTUJ — v0.6.2
            ================================================================
            */

            if (
                interaction.isChatInputCommand() &&
                interaction.commandName ===
                    'raid' &&
                interaction.options.getSubcommand() ===
                    'edytuj'
            ) {
                await interaction.deferReply({
                    flags:
                        MessageFlags.Ephemeral,
                });

                const moderator =
                    await getInteractionMember(
                        interaction
                    );

                if (
                    !isRaidManager(
                        moderator
                    )
                ) {
                    await interaction.editReply({
                        content:
                            '❌ Raid może edytować GM, Oficer lub Raid Lider.',
                    });

                    return;
                }

                const raidId =
                    interaction.options.getInteger(
                        'id',
                        true
                    );

                const raid =
                    getRaid(
                        raidId
                    );

                if (!raid) {
                    await interaction.editReply({
                        content:
                            `❌ Raid #${raidId} nie istnieje.`,
                    });

                    return;
                }

                if (
                    raid.status ===
                    'CANCELLED'
                ) {
                    await interaction.editReply({
                        content:
                            '❌ Anulowany raid pozostaje w historii.',
                    });

                    return;
                }

                const newDate =
                    interaction.options.getString(
                        'data'
                    );

                const newTime =
                    interaction.options.getString(
                        'godzina'
                    );

                const newDescription =
                    interaction.options.getString(
                        'opis'
                    );

                if (
                    !newDate &&
                    !newTime &&
                    newDescription === null
                ) {
                    await interaction.editReply({
                        content:
                            '❌ Podaj przynajmniej nową datę, godzinę albo opis.',
                    });

                    return;
                }

                const oldDate =
                    DateTime.fromSeconds(
                        raid.scheduled_ts,
                        {
                            zone:
                                'Europe/Warsaw',
                        }
                    );

                const datePart =
                    newDate ||
                    oldDate.toFormat(
                        'dd.MM.yyyy'
                    );

                const timePart =
                    newTime ||
                    oldDate.toFormat(
                        'HH:mm'
                    );

                const changedDateTime =
                    Boolean(
                        newDate ||
                        newTime
                    );

                let newUnix =
                    raid.scheduled_ts;

                if (
                    changedDateTime
                ) {
                    const parsed =
                        DateTime.fromFormat(
                            `${datePart} ${timePart}`,
                            'dd.MM.yyyy HH:mm',
                            {
                                zone:
                                    'Europe/Warsaw',
                            }
                        );

                    if (
                        !parsed.isValid
                    ) {
                        await interaction.editReply({
                            content:
                                '❌ Niepoprawna data lub godzina. Przykład: **20.09.2026 20:00**.',
                        });

                        return;
                    }

                    if (
                        parsed.toMillis() <=
                        Date.now()
                    ) {
                        await interaction.editReply({
                            content:
                                '❌ Nowy termin musi być w przyszłości.',
                        });

                        return;
                    }

                    newUnix =
                        Math.floor(
                            parsed.toSeconds()
                        );
                }

                const description =
                    newDescription === null
                        ? raid.description
                        : newDescription;

                db.prepare(`
                    UPDATE raids
                    SET
                        scheduled_ts = ?,
                        description = ?,
                        updated_at = ?
                    WHERE id = ?
                `).run(
                    newUnix,
                    description || '',
                    now(),
                    raidId
                );

                await refreshRaidCalendarMessage(
                    interaction.guild,
                    raidId
                );

                if (
                    raid.status ===
                    'ACTIVE'
                ) {
                    await refreshRaidSignupMessage(
                        interaction.guild,
                        raidId
                    );
                } else {
                    await refreshRaidSignupStatusMessage(
                        interaction.guild,
                        raidId
                    );
                }

                const changes = [];

                if (
                    newUnix !==
                    raid.scheduled_ts
                ) {
                    changes.push(
                        `📅 **Nowy termin:** <t:${newUnix}:F>`
                    );
                }

                if (
                    newDescription !==
                    null
                ) {
                    changes.push(
                        '📝 Zmieniono opis raidu.'
                    );
                }

                await announce(
                    interaction.guild,
                    [
                        `✏️ **Zmieniono raid #${raidId}: ${raid.name}**`,
                        '',
                        ...changes,
                    ].join('\n')
                );

                await interaction.editReply({
                    content:
                        `✅ Raid **#${raidId} — ${raid.name}** został zaktualizowany.`,
                });

                return;
            }

            /*
            ================================================================
            /RAID ZAMKNIJ — v0.6.2
            ================================================================
            */

            if (
                interaction.isChatInputCommand() &&
                interaction.commandName ===
                    'raid' &&
                interaction.options.getSubcommand() ===
                    'zamknij'
            ) {
                await interaction.deferReply({
                    flags:
                        MessageFlags.Ephemeral,
                });

                const moderator =
                    await getInteractionMember(
                        interaction
                    );

                if (
                    !isRaidManager(
                        moderator
                    )
                ) {
                    await interaction.editReply({
                        content:
                            '❌ Zapisy może zamknąć GM, Oficer lub Raid Lider.',
                    });

                    return;
                }

                const raidId =
                    interaction.options.getInteger(
                        'id',
                        true
                    );

                const raid =
                    getRaid(
                        raidId
                    );

                if (!raid) {
                    await interaction.editReply({
                        content:
                            `❌ Raid #${raidId} nie istnieje.`,
                    });

                    return;
                }

                if (
                    raid.status ===
                    'CANCELLED'
                ) {
                    await interaction.editReply({
                        content:
                            '❌ Ten raid jest anulowany.',
                    });

                    return;
                }

                if (
                    raid.status ===
                    'CLOSED'
                ) {
                    await interaction.editReply({
                        content:
                            '🔒 Zapisy na ten raid są już zamknięte.',
                    });

                    return;
                }

                db.prepare(`
                    UPDATE raids
                    SET
                        status = 'CLOSED',
                        updated_at = ?
                    WHERE id = ?
                `).run(
                    now(),
                    raidId
                );

                await refreshRaidCalendarMessage(
                    interaction.guild,
                    raidId
                );

                await refreshRaidSignupStatusMessage(
                    interaction.guild,
                    raidId
                );

                await announce(
                    interaction.guild,
                    `🔒 **Zapisy zamknięte:** Raid #${raidId} — **${raid.name}**.\n📅 <t:${raid.scheduled_ts}:F>`
                );

                await interaction.editReply({
                    content:
                        `🔒 Zapisy na **#${raidId} — ${raid.name}** zostały zamknięte.`,
                });

                return;
            }

            /*
            ================================================================
            /RAID ANULUJ — v0.6.2
            ================================================================
            */

            if (
                interaction.isChatInputCommand() &&
                interaction.commandName ===
                    'raid' &&
                interaction.options.getSubcommand() ===
                    'anuluj'
            ) {
                await interaction.deferReply({
                    flags:
                        MessageFlags.Ephemeral,
                });

                const moderator =
                    await getInteractionMember(
                        interaction
                    );

                if (
                    !isRaidManager(
                        moderator
                    )
                ) {
                    await interaction.editReply({
                        content:
                            '❌ Raid może anulować GM, Oficer lub Raid Lider.',
                    });

                    return;
                }

                const raidId =
                    interaction.options.getInteger(
                        'id',
                        true
                    );

                const reason =
                    interaction.options.getString(
                        'powod'
                    );

                const raid =
                    getRaid(
                        raidId
                    );

                if (!raid) {
                    await interaction.editReply({
                        content:
                            `❌ Raid #${raidId} nie istnieje.`,
                    });

                    return;
                }

                if (
                    raid.status ===
                    'CANCELLED'
                ) {
                    await interaction.editReply({
                        content:
                            '❌ Ten raid jest już anulowany.',
                    });

                    return;
                }

                db.prepare(`
                    UPDATE raids
                    SET
                        status = 'CANCELLED',
                        cancel_reason = ?,
                        updated_at = ?
                    WHERE id = ?
                `).run(
                    reason || '',
                    now(),
                    raidId
                );

                await refreshRaidCalendarMessage(
                    interaction.guild,
                    raidId
                );

                await refreshRaidSignupStatusMessage(
                    interaction.guild,
                    raidId
                );

                const announcement = [
                    `❌ **RAID ANULOWANY**`,
                    '',
                    `⚔️ **${raid.name}**`,
                    `📅 <t:${raid.scheduled_ts}:F>`,
                ];

                if (reason) {
                    announcement.push(
                        `📝 **Powód:** ${reason}`
                    );
                }

                await announce(
                    interaction.guild,
                    announcement.join(
                        '\n'
                    )
                );

                await interaction.editReply({
                    content:
                        `❌ Raid **#${raidId} — ${raid.name}** został anulowany.`,
                });

                return;
            }


            /*
            ================================================================
            /RAID LISTA — v0.6.3
            ================================================================
            */

            if (
                interaction.isChatInputCommand() &&
                interaction.commandName === 'raid' &&
                interaction.options.getSubcommand() === 'lista'
            ) {
                await interaction.deferReply({
                    flags:
                        MessageFlags.Ephemeral,
                });

                const member =
                    await getInteractionMember(
                        interaction
                    );

                if (!hasGuildRank(member)) {
                    await interaction.editReply({
                        content:
                            '❌ Lista raidów jest dostępna dla członków gildii.',
                    });

                    return;
                }

                const raids =
                    db.prepare(`
                        SELECT
                            r.*,

                            (
                                SELECT COUNT(*)
                                FROM raid_signups rs
                                WHERE
                                    rs.raid_id = r.id
                                    AND rs.status = 'YES'
                            ) AS yes_count,

                            (
                                SELECT COUNT(*)
                                FROM raid_signups rs
                                WHERE
                                    rs.raid_id = r.id
                                    AND rs.status = 'MAYBE'
                            ) AS maybe_count

                        FROM raids r

                        WHERE
                            r.status IN (
                                'ACTIVE',
                                'CLOSED'
                            )

                        ORDER BY
                            r.scheduled_ts ASC

                        LIMIT 20
                    `).all();

                if (!raids.length) {
                    await interaction.editReply({
                        content:
                            '📭 Brak aktualnych raidów.',
                    });

                    return;
                }

                const lines =
                    raids.map(raid => {
                        const status =
                            raid.status === 'ACTIVE'
                                ? '🟢'
                                : '🔒';

                        const limit =
                            raid.player_limit
                                ? `${raid.yes_count}/${raid.player_limit}`
                                : String(
                                    raid.yes_count
                                );

                        return [
                            `${status} **#${raid.id} — ${raid.name}**`,
                            `📅 <t:${raid.scheduled_ts}:F> • <t:${raid.scheduled_ts}:R>`,
                            `👥 Będę: **${limit}** • 🤔 Może: **${raid.maybe_count}**`,
                        ].join('\n');
                    });

                const embed =
                    new EmbedBuilder()
                        .setTitle(
                            '⚔️ AKTUALNE RAIDY'
                        )
                        .setDescription(
                            lines.join(
                                '\n\n'
                            )
                        )
                        .setFooter({
                            text:
                                '🟢 Zapisy otwarte • 🔒 Zapisy zamknięte',
                        })
                        .setTimestamp();

                await interaction.editReply({
                    embeds: [
                        embed
                    ],
                });

                return;
            }

            /*
            ================================================================
            /RAID OTWORZ — v0.6.3
            ================================================================
            */

            if (
                interaction.isChatInputCommand() &&
                interaction.commandName === 'raid' &&
                interaction.options.getSubcommand() === 'otworz'
            ) {
                await interaction.deferReply({
                    flags:
                        MessageFlags.Ephemeral,
                });

                const moderator =
                    await getInteractionMember(
                        interaction
                    );

                if (!isRaidManager(moderator)) {
                    await interaction.editReply({
                        content:
                            '❌ Zapisy może otworzyć GM, Oficer lub Raid Lider.',
                    });

                    return;
                }

                const raidId =
                    interaction.options.getInteger(
                        'id',
                        true
                    );

                const raid =
                    getRaid(
                        raidId
                    );

                if (!raid) {
                    await interaction.editReply({
                        content:
                            `❌ Raid #${raidId} nie istnieje.`,
                    });

                    return;
                }

                if (
                    raid.status === 'CANCELLED'
                ) {
                    await interaction.editReply({
                        content:
                            '❌ Anulowany raid pozostaje w historii. Utwórz nowy raid, jeśli wydarzenie wraca.',
                    });

                    return;
                }

                if (
                    raid.status === 'ACTIVE'
                ) {
                    await interaction.editReply({
                        content:
                            '🟢 Zapisy na ten raid są już otwarte.',
                    });

                    return;
                }

                if (
                    raid.scheduled_ts <=
                    Math.floor(
                        Date.now() / 1000
                    )
                ) {
                    await interaction.editReply({
                        content:
                            '❌ Termin tego raidu już minął. Najpierw ustaw nowy termin przez **/raid edytuj**.',
                    });

                    return;
                }

                db.prepare(`
                    UPDATE raids
                    SET
                        status = 'ACTIVE',
                        updated_at = ?
                    WHERE id = ?
                `).run(
                    now(),
                    raidId
                );

                await refreshRaidCalendarMessage(
                    interaction.guild,
                    raidId
                );

                await refreshRaidSignupMessage(
                    interaction.guild,
                    raidId
                );

                await announce(
                    interaction.guild,
                    [
                        `🟢 **Zapisy ponownie otwarte**`,
                        '',
                        `⚔️ **#${raidId} — ${raid.name}**`,
                        `📅 <t:${raid.scheduled_ts}:F>`,
                    ].join('\n')
                );

                await interaction.editReply({
                    content:
                        `🟢 Zapisy na **#${raidId} — ${raid.name}** zostały ponownie otwarte.`,
                });

                return;
            }


            /*
            ================================================================
            /FOREVER LATEST
            ================================================================
            */

            if (
                interaction.isChatInputCommand() &&
                interaction.commandName ===
                    'forever' &&
                interaction.options.getSubcommand() ===
                    'latest'
            ) {
                await interaction.deferReply({
                    flags:
                        MessageFlags.Ephemeral,
                });

                try {
                    const news =
                        await fetchForeverNews();

                    if (!news.length) {
                        await interaction.editReply({
                            content:
                                'Brak aktualnych artykułów Forever.',
                        });

                        return;
                    }

                    const lines =
                        news
                            .slice(0, 5)
                            .map(
                                item =>
                                    `• [${item.title}](${item.url})`
                            );

                    await interaction.editReply({
                        embeds: [
                            new EmbedBuilder()
                                .setTitle(
                                    '🌍 WoW Forever — najnowsze'
                                )
                                .setDescription(
                                    lines.join(
                                        '\n\n'
                                    )
                                )
                                .setFooter({
                                    text:
                                        'Źródło: Blizzard Entertainment',
                                })
                                .setTimestamp()
                        ],
                    });

                } catch (error) {
                    await interaction.editReply({
                        content:
                            `❌ Nie udało się pobrać newsów: ${error.message}`,
                    });
                }

                return;
            }

            /*
            ================================================================
            /FOREVER STATUS
            ================================================================
            */

            if (
                interaction.isChatInputCommand() &&
                interaction.commandName ===
                    'forever' &&
                interaction.options.getSubcommand() ===
                    'status'
            ) {
                await interaction.reply({
                    embeds: [new EmbedBuilder().setTitle('WoW Forever · Live')
                        .setDescription(`Build klienta **${GAME.build}**\n[Hotfixy Blizzarda z ${GAME.hotfix}](${GAME.notes})\n${GAME.summary}\n\n[Strona The Sentenced](${SITE})`)],
                    flags: MessageFlags.Ephemeral,
                });

                return;
            }


            /*
            ================================================================
            /STATYSTYKI — v0.8.0
            ================================================================
            */

            if (
                interaction.isChatInputCommand() &&
                interaction.commandName ===
                    'statystyki'
            ) {
                await interaction.deferReply({
                    flags:
                        MessageFlags.Ephemeral,
                });

                const member =
                    await getInteractionMember(
                        interaction
                    );

                if (!hasGuildRank(member)) {
                    await interaction.editReply({
                        content:
                            '❌ Statystyki gildii są dostępne dla zatwierdzonych członków.',
                    });

                    return;
                }

                await interaction.editReply({
                    embeds: await buildGuildState(interaction.guild),
                });

                return;
            }

            /*
            ================================================================
            /STATUS
            ================================================================
            */

            if (
                interaction.isChatInputCommand() &&
                interaction.commandName ===
                    'status'
            ) {
                await interaction.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle(
                                '⚔️ THE SENTENCED'
                            )
                            .setDescription(
                                require('./maintenance.cjs').maintenance(db)
                                    ? `🛠️ SentencedBot **v${VERSION}** — maintenance. Operacje są chwilowo wstrzymane.`
                                    : `SentencedBot **v${VERSION}** działa. Panel gracza i addon znajdziesz w /bot.`
                            )
                            .addFields(
                                {
                                    name:
                                        '🛡️ Onboarding',
                                    value: '✅',
                                    inline: true,
                                },
                                {
                                    name:
                                        '📊 Stan gildii',
                                    value: '✅',
                                    inline: true,
                                },
                                {
                                    name:
                                        '⚔️ Raidy',
                                    value:
                                        `✅ Wspólna logika ${VERSION}`,
                                    inline: true,
                                }
                            )
                    ],
                });

                return;
            }

            /*
            ================================================================
            START
            ================================================================
            */

            if (
                interaction.isButton() &&
                interaction.customId ===
                    'onboarding:start'
            ) {
                const record =
                    sql.getMember.get(
                        interaction.user.id
                    );

                /*
                 * GM/Oficer może testować ankietę
                 * nawet jeśli ma już rangę.
                 */
                if (
                    record?.onboarding_status ===
                        'pending'
                ) {
                    await interaction.reply({
                        content:
                            '⏳ Twoja ankieta już oczekuje na decyzję.',
                        flags: MessageFlags.Ephemeral,
                    });

                    return;
                }

                await interaction.showModal(
                    nickModal()
                );

                return;
            }

            /*
            ================================================================
            IMIĘ / WIEK / NICK
            ================================================================
            */


            /*
            ================================================================
            PROSTY ONBOARDING — TYLKO NICK
            ================================================================
            */

            if (
                interaction.isModalSubmit() &&
                interaction.customId ===
                    'onboarding:nick'
            ) {
                const nick =
                    interaction.fields
                        .getTextInputValue(
                            'oldnick'
                        )
                        .trim();

                const data = {
                    name: '',
                    age: null,
                    oldNick: nick,
                    playing: 'TAK',
                    interests: [],
                    wowClass: '',
                    wowRole: '',
                };

                await interaction.deferReply({
                    flags:
                        MessageFlags.Ephemeral,
                });

                await finalizeSurvey(
                    interaction,
                    data
                );

                await interaction.editReply({
                    content:
                        '✅ Zgłoszenie przyjęte. Otrzymałeś rangę **Trial** i dostęp do kanałów gildii.',
                    components: [],
                });

                return;
            }


            if (
                interaction.isModalSubmit() &&
                interaction.customId ===
                    'onboarding:basic'
            ) {
                const age =
                    Number(
                        interaction.fields
                            .getTextInputValue(
                                'age'
                            )
                            .trim()
                    );

                if (
                    !Number.isInteger(age) ||
                    age < 13 ||
                    age > 99
                ) {
                    await interaction.reply({
                        content:
                            '❌ Podaj poprawny wiek.',
                        flags: MessageFlags.Ephemeral,
                    });

                    return;
                }

                onboardingSessions.set(
                    interaction.user.id,
                    {
                        name:
                            interaction.fields
                                .getTextInputValue(
                                    'name'
                                )
                                .trim(),

                        age,

                        oldNick:
                            interaction.fields
                                .getTextInputValue(
                                    'oldnick'
                                )
                                .trim(),

                        playing: null,
                        interests: [],
                        wowClass: '',
                        wowRole: '',
                    }
                );

                await interaction.reply({
                    content:
                        '**Czy planujesz grać w WoW Forever?**',

                    components:
                        playingButtons(),

                    flags: MessageFlags.Ephemeral,
                });

                return;
            }

            /*
            ================================================================
            GRAM / NIE GRAM
            ================================================================
            */

            if (
                interaction.isButton() &&
                interaction.customId.startsWith(
                    'onboarding:playing:'
                )
            ) {
                const session =
                    onboardingSessions.get(
                        interaction.user.id
                    );

                if (!session) {
                    await interaction.reply({
                        content:
                            'Formularz wygasł. Uruchom ankietę ponownie.',
                        flags: MessageFlags.Ephemeral,
                    });

                    return;
                }

                const playing =
                    interaction.customId.endsWith(
                        ':yes'
                    );

                session.playing =
                    playing
                        ? 'TAK'
                        : 'NIE';

                if (!playing) {
                    await interaction.deferUpdate();

                    await finalizeSurvey(
                        interaction,
                        session
                    );

                    onboardingSessions.delete(
                        interaction.user.id
                    );

                    await interaction.editReply({
                        content:
                            '✅ Ankieta zakończona. Otrzymałeś rangę **Trial** i dostęp do kanałów gildii.',
                        components: [],
                    });

                    return;
                }

                await interaction.update({
                    content:
                        '**Co Cię najbardziej interesuje?**\nMożesz zaznaczyć kilka opcji.',

                    components:
                        interestsSelect(),
                });

                return;
            }

            /*
            ================================================================
            PVE / PVP / RAIDY
            ================================================================
            */

            if (
                interaction.isStringSelectMenu() &&
                interaction.customId ===
                    'onboarding:interests'
            ) {
                const session =
                    onboardingSessions.get(
                        interaction.user.id
                    );

                if (!session) {
                    return;
                }

                session.interests =
                    interaction.values;

                await interaction.update({
                    content:
                        '**Jaką klasą planujesz grać w WoW Forever?**',

                    components:
                        classSelect(),
                });

                return;
            }

            /*
            ================================================================
            KLASA
            ================================================================
            */

            if (
                interaction.isStringSelectMenu() &&
                interaction.customId ===
                    'onboarding:class'
            ) {
                const session =
                    onboardingSessions.get(
                        interaction.user.id
                    );

                if (!session) {
                    await interaction.reply({
                        content:
                            'Formularz wygasł. Uruchom ankietę ponownie.',
                        flags:
                            MessageFlags.Ephemeral,
                    });

                    return;
                }

                session.wowClass =
                    interaction.values[0];

                await interaction.update({
                    content:
                        '**Jaką funkcję planujesz pełnić?**',

                    components:
                        roleSelect(),
                });

                return;
            }

            /*
            ================================================================
            TANK / DPS / HEAL
            ================================================================
            */

            if (
                interaction.isStringSelectMenu() &&
                interaction.customId ===
                    'onboarding:role'
            ) {
                const session =
                    onboardingSessions.get(
                        interaction.user.id
                    );

                if (!session) {
                    return;
                }

                session.wowRole =
                    interaction.values[0];

                await interaction.deferUpdate();

                await finalizeSurvey(
                    interaction,
                    session
                );

                onboardingSessions.delete(
                    interaction.user.id
                );

                await interaction.editReply({
                    content:
                        '✅ Ankieta zakończona. Otrzymałeś rangę **Trial** i dostęp do kanałów gildii.',

                    components: [],
                });

                return;
            }

            /*
            ================================================================
            GM / OFICER — DECYZJA
            ================================================================
            */


            /*
            ================================================================
            PROFILE CONFIG FLOW HANDLERS
            ================================================================
            */

            if (
                interaction.isModalSubmit() &&
                interaction.customId === 'profile:gamenick'
            ) {
                const session =
                    profileSessions.get(
                        interaction.user.id
                    );

                if (!session) {
                    await interaction.reply({
                        content:
                            'Formularz wygasł. Uruchom `/profil konfiguruj` ponownie.',
                        flags:
                            MessageFlags.Ephemeral,
                    });

                    return;
                }

                session.gameNick =
                    interaction.fields
                        .getTextInputValue('gamenick')
                        .trim();

                await interaction.reply({
                    content:
                        [
                            '⚔️ **KONFIGURACJA PROFILU**',
                            '',
                            `🎮 Nick w WoW: **${session.gameNick}**`,
                            '',
                            '**Czy chcesz grać w WoW: Forever?**',
                        ].join('\n'),
                    components:
                        profileForeverButtons(),
                    flags:
                        MessageFlags.Ephemeral,
                });

                return;
            }


            if (
                interaction.isButton() &&
                interaction.customId.startsWith(
                    'profile:forever:'
                )
            ) {
                const session =
                    profileSessions.get(
                        interaction.user.id
                    );

                if (!session) {
                    await interaction.reply({
                        content:
                            'Formularz wygasł. Uruchom `/profil konfiguruj` ponownie.',
                        flags:
                            MessageFlags.Ephemeral,
                    });

                    return;
                }

                const yes =
                    interaction.customId.endsWith(
                        ':yes'
                    );

                session.plansForever =
                    yes
                        ? 'TAK'
                        : 'NIE';

                if (!yes) {
                    await interaction.update({
                        content:
                            [
                                '⚔️ **KONFIGURACJA PROFILU**',
                                '',
                                '**Czy grałeś wcześniej w The Sentenced?**',
                            ].join('\n'),
                        components:
                            profileOldGuildButtons(),
                    });

                    return;
                }

                await interaction.update({
                    content:
                        [
                            '⚔️ **KONFIGURACJA PROFILU**',
                            '',
                            '**Jaką klasą planujesz grać w WoW: Forever?**',
                        ].join('\n'),
                    components:
                        profileClassSelect(),
                });

                return;
            }

            if (
                interaction.isStringSelectMenu() &&
                interaction.customId ===
                    'profile:class'
            ) {
                const session =
                    profileSessions.get(
                        interaction.user.id
                    );

                if (!session) {
                    return;
                }

                session.wowClass =
                    interaction.values[0];

                await interaction.update({
                    content:
                        [
                            '⚔️ **KONFIGURACJA PROFILU**',
                            '',
                            `**Wybrana klasa: ${session.wowClass}**`,
                            '',
                            '**Jaką rolę planujesz pełnić?**',
                            '',
                            '🛡️ **Tank** — trzyma przeciwników na sobie',
                            '💚 **Heal** — leczy drużynę',
                            '⚔️ **DPS** — zadaje obrażenia',
                        ].join('\n'),
                    components:
                        profileRoleSelect(
                            session.wowClass
                        ),
                });

                return;
            }

            if (
                interaction.isStringSelectMenu() &&
                interaction.customId ===
                    'profile:role'
            ) {
                const session =
                    profileSessions.get(
                        interaction.user.id
                    );

                if (!session) {
                    return;
                }

                session.wowRole =
                    interaction.values[0];

                await interaction.update({
                    content:
                        [
                            '⚔️ **KONFIGURACJA PROFILU**',
                            '',
                            `Klasa: **${session.wowClass}**`,
                            `Rola: **${profileRoleLabel(session.wowRole)}**`,
                            '',
                            '**Czy grałeś wcześniej w The Sentenced?**',
                        ].join('\n'),
                    components:
                        profileOldGuildButtons(),
                });

                return;
            }

            if (
                interaction.isButton() &&
                interaction.customId.startsWith(
                    'profile:oldguild:'
                )
            ) {
                const session =
                    profileSessions.get(
                        interaction.user.id
                    );

                if (!session) {
                    await interaction.reply({
                        content:
                            'Formularz wygasł. Uruchom `/profil konfiguruj` ponownie.',
                        flags:
                            MessageFlags.Ephemeral,
                    });

                    return;
                }

                const yes =
                    interaction.customId.endsWith(
                        ':yes'
                    );

                session.playedBefore =
                    yes
                        ? 'TAK'
                        : 'NIE';

                if (yes) {
                    await interaction.showModal(
                        profileOldNickModal()
                    );

                    return;
                }

                session.oldNick = '';

                await saveProfileSession(
                    interaction,
                    session
                );

                await interaction.update({
                    content:
                        [
                            '✅ **Profil zapisany.**',
                            '',
                            session.plansForever === 'TAK'
                                ? `🌍 WoW: Forever: **TAK**\n🧙 Klasa: **${session.wowClass}**\n⚔️ Rola: **${profileRoleLabel(session.wowRole)}**`
                                : '🌍 WoW: Forever: **NIE**',
                            '',
                            '🏰 Grałeś wcześniej w The Sentenced: **NIE**',
                            '',
                            'Profil możesz później zmienić przez **`/profil konfiguruj`**.',
                        ].join('\n'),
                    components: [],
                });

                return;
            }

            if (
                interaction.isModalSubmit() &&
                interaction.customId ===
                    'profile:oldnick'
            ) {
                const session =
                    profileSessions.get(
                        interaction.user.id
                    );

                if (!session) {
                    await interaction.reply({
                        content:
                            'Formularz wygasł. Uruchom `/profil konfiguruj` ponownie.',
                        flags:
                            MessageFlags.Ephemeral,
                    });

                    return;
                }

                session.oldNick =
                    interaction.fields
                        .getTextInputValue(
                            'oldnick'
                        )
                        .trim();

                await saveProfileSession(
                    interaction,
                    session
                );

                await interaction.reply({
                    content:
                        [
                            '✅ **Profil zapisany.**',
                            '',
                            session.plansForever === 'TAK'
                                ? `🌍 WoW: Forever: **TAK**\n🧙 Klasa: **${session.wowClass}**\n⚔️ Rola: **${profileRoleLabel(session.wowRole)}**`
                                : '🌍 WoW: Forever: **NIE**',
                            '',
                            '🏰 Grałeś wcześniej w The Sentenced: **TAK**',
                            `🏅 Dawny nick: **${session.oldNick}**`,
                            '',
                            'Profil możesz później zmienić przez **`/profil konfiguruj`**.',
                        ].join('\n'),
                    flags:
                        MessageFlags.Ephemeral,
                });

                return;
            }


            if (
                interaction.isButton() &&
                (
                    interaction.customId.startsWith(
                        'review:accept:'
                    ) ||
                    interaction.customId.startsWith(
                        'review:reject:'
                    )
                )
            ) {
                const moderator =
                    await getInteractionMember(
                        interaction
                    );

                if (
                    !isGMOrOfficer(
                        moderator
                    )
                ) {
                    await interaction.reply({
                        content:
                            '❌ Tylko GM lub Oficer może podjąć decyzję.',
                        flags: MessageFlags.Ephemeral,
                    });

                    return;
                }

                const [
                    ,
                    action,
                    userId,
                ] =
                    interaction.customId.split(
                        ':'
                    );

                const target =
                    await interaction.guild.members.fetch(
                        userId
                    );

                const embed =
                    EmbedBuilder.from(
                        interaction.message.embeds[0]
                    );

                const waiting =
                    getRole(
                        interaction.guild,
                        'Oczekujący'
                    );

                /*
                 * ACCEPT
                 */
                if (action === 'accept') {
                    const trial =
                        getRole(
                            interaction.guild,
                            'Trial'
                        );

                    await target.roles.add(
                        trial,
                        `Zaakceptowany przez ${moderator.user.tag}`
                    );

                    if (
                        waiting &&
                        target.roles.cache.has(
                            waiting.id
                        )
                    ) {
                        await target.roles.remove(
                            waiting
                        );
                    }

                    sql.approve.run(
                        now(),
                        moderator.id,
                        target.id
                    );

                    embed
                        .setColor(
                            0x2ecc71
                        )
                        .addFields({
                            name:
                                '✅ DECYZJA',
                            value:
                                `Przyjęty jako **Trial** przez <@${moderator.id}>`,
                        });

                    await interaction.update({
                        embeds: [embed],
                        components: [],
                    });

                    await sendPersonalizedWelcome(
                        interaction.guild,
                        target
                    );

                }

                /*
                 * REJECT
                 */
                if (action === 'reject') {
                    if (
                        waiting &&
                        target.roles.cache.has(
                            waiting.id
                        )
                    ) {
                        await target.roles.remove(
                            waiting
                        );
                    }

                    sql.reject.run(
                        now(),
                        moderator.id,
                        target.id
                    );

                    embed
                        .setColor(
                            0xe74c3c
                        )
                        .addFields({
                            name:
                                '❌ DECYZJA',
                            value:
                                `Odrzucony przez <@${moderator.id}>`,
                        });

                    await interaction.update({
                        embeds: [embed],
                        components: [],
                    });
                }

                await refreshGuildState(
                    interaction.guild
                );

                return;
            }
        } catch (error) {
            console.error(
                'INTERACTION:',
                error
            );

            if (
                interaction.isRepliable()
            ) {
                try {
                    if (
                        interaction.replied ||
                        interaction.deferred
                    ) {
                        await interaction.followUp({
                            content:
                                '❌ Wystąpił błąd SentencedBota.',
                            flags: MessageFlags.Ephemeral,
                        });
                    } else {
                        await interaction.reply({
                            content:
                                '❌ Wystąpił błąd SentencedBota.',
                            flags: MessageFlags.Ephemeral,
                        });
                    }
                } catch (_) {}
            }
        }
    }
);

/*
|--------------------------------------------------------------------------
| ERROR / SHUTDOWN
|--------------------------------------------------------------------------
*/

client.on(
    Events.Error,
    error =>
        console.error(
            'Discord:',
            error.message
        )
);

process.on(
    'unhandledRejection',
    error =>
        console.error(
            'Promise:',
            error
        )
);

function shutdown() {
    console.log('');
    console.log(
        '🛑 SentencedBot'
    );

    try {
        db.close();
    } catch (_) {}

    client.destroy();

    process.exit(0);
}

process.on(
    'SIGINT',
    shutdown
);

process.on(
    'SIGTERM',
    shutdown
);


/*
========================================================================
SENTENCEDBOT NAVIGATION v1
========================================================================
/bot = główny interaktywny panel użytkownika.

Profil zapisuje te same dane, z których korzysta:
- /profil
- #stan-gildii
- powitania
========================================================================
*/

function botMenuInterestsText(value) {
    if (!value) {
        return '—';
    }

    try {
        const parsed =
            JSON.parse(value);

        if (Array.isArray(parsed)) {
            return parsed.join(', ');
        }
    } catch (_) {}

    return String(value)
        .replace(/[\[\]"]/g, '')
        .replace(/,/g, ', ');
}

function missingProfileFields(record) {
    return require('./guild-core').missingProfileFields(record);
}


function botMenuProfileEmbed(
    user,
    record
) {
    const interests =
        botMenuInterestsText(
            record?.interests
        );

    const completeFields = [
        record?.game_nick,
        record?.wow_class,
        record?.wow_role,
        record?.interests,
    ].filter(
        value =>
            String(
                value || ''
            ).trim()
    ).length;

    return new EmbedBuilder()
        .setColor(0x8B1E1E)
        .setTitle(
            '👤 TWÓJ PROFIL GILDYJNY'
        )
        .setDescription(
            `<@${user.id}>\n` +
            `Kompletność profilu: **${4-missingProfileFields(record).length}/4**\n` +
            (missingProfileFields(record).length ? `Brakuje: **${missingProfileFields(record).map(x=>x[1]).join(', ')}**` : '✅ Postać gotowa do wyprawy.') +
            (record?.old_ts_nick ? `\nDawniej w The Sentenced: **${record.old_ts_nick}**` : '')
        )
        .addFields(
            {
                name:
                    '🎮 Nick',
                value:
                    record?.game_nick ||
                    '—',
                inline: true,
            },
            {
                name:
                    '🧙 Klasa',
                value:
                    record?.wow_class ||
                    '—',
                inline: true,
            },
            {
                name:
                    '⚔️ Funkcja',
                value:
                    record?.wow_role
                        ? profileRoleLabel(
                            record.wow_role
                        )
                        : '—',
                inline: true,
            },
            {
                name:
                    '🎯 Styl gry',
                value:
                    interests,
                inline: true,
            },
            {
                name: '🌍 WoW Forever',
                value: `[The Sentenced · live](${SITE})`,
                inline: true,
            }
        )
        .setFooter({
            text:
                'Zmiany profilu automatycznie aktualizują stan gildii.',
        });
}


function botMenuMainEmbed(userId) {
    if (guildHub) return guildHub.dashboard({id:userId});
    const record =
        sql.getMember.get(
            userId
        );

    const completed =
        [
            record?.game_nick,
            record?.wow_class,
            record?.wow_role,
            record?.interests,
        ].filter(
            value =>
                String(
                    value || ''
                ).trim()
        ).length;

    return new EmbedBuilder()
        .setColor(0x8B1E1E)
        .setTitle(
            '⚔️ SENTENCEDBOT • PANEL GRACZA'
        )
        .setDescription(
            [
                'Witaj w centrum obsługi **The Sentenced Forever**.',
                '',
                'Wybierz poniżej, co chcesz zrobić.',
                '',
                `📋 Twój profil: **${4-missingProfileFields(record).length}/4**`,
                missingProfileFields(record).length ? `⚠️ Brakuje: **${missingProfileFields(record).map(x=>x[1]).join(', ')}**` : '✅ Profil kompletny — Azeroth czeka.',
            ].join('\n')
        )
        .addFields(
            {
                name:
                    '👤 Profil',
                value:
                    'Podejrzyj lub zmień nick, klasę, funkcję i styl gry.',
                inline: true,
            },
            {
                name:
                    '☠️ Gildia',
                value:
                    'Raidy, ankiety i aktualny stan gildii.',
                inline: true,
            }
        );
}


function botMenuMainRows(guild, member) {
    if (guildHub) return guildHub.rows(member);
    const firstRow =
        new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(
                        'botmenu:profile'
                    )
                    .setLabel(
                        'Mój profil'
                    )
                    .setEmoji('👤')
                    .setStyle(
                        ButtonStyle.Primary
                    ),

                new ButtonBuilder()
                    .setCustomId(
                        'botmenu:edit'
                    )
                    .setLabel(
                        'Edytuj profil'
                    )
                    .setEmoji('✏️')
                    .setStyle(
                        ButtonStyle.Success
                    ),

                new ButtonBuilder()
                    .setCustomId(
                        'botmenu:help'
                    )
                    .setLabel(
                        'Pomoc'
                    )
                    .setEmoji('❓')
                    .setStyle(
                        ButtonStyle.Secondary
                    )
            );

    const links = [];

    const calendar =
        getChannel(
            guild,
            'kalendarz'
        );

    const polls =
        getChannel(
            guild,
            'ankiety'
        );

    const state =
        getChannel(
            guild,
            'stan-gildii'
        );

    if (calendar) {
        links.push(
            new ButtonBuilder()
                .setLabel('Raidy')
                .setEmoji('☠️')
                .setStyle(
                    ButtonStyle.Link
                )
                .setURL(
                    `https://discord.com/channels/${guild.id}/${calendar.id}`
                )
        );
    }

    if (polls) {
        links.push(
            new ButtonBuilder()
                .setLabel('Ankiety')
                .setEmoji('🗳️')
                .setStyle(
                    ButtonStyle.Link
                )
                .setURL(
                    `https://discord.com/channels/${guild.id}/${polls.id}`
                )
        );
    }

    if (state) {
        links.push(
            new ButtonBuilder()
                .setLabel(
                    'Stan gildii'
                )
                .setEmoji('📊')
                .setStyle(
                    ButtonStyle.Link
                )
                .setURL(
                    `https://discord.com/channels/${guild.id}/${state.id}`
                )
        );
    }

    const rows = [
        firstRow,
    ];

    if (links.length) {
        rows.push(
            new ActionRowBuilder()
                .addComponents(
                    ...links
                )
        );
    }

    if (community) rows.push(community.nav(member));
    const extras=['offtop'].map(name=>getChannel(guild,name)).filter(Boolean).map(c=>new ButtonBuilder().setLabel(c.name==='offtop'?'😂 Karczma i memy':'🏆 Próba Weterana').setStyle(ButtonStyle.Link).setURL(`https://discord.com/channels/${guild.id}/${c.id}`));
    if(extras.length) rows.push(new ActionRowBuilder().addComponents(...extras));
    return rows;
}


function botMenuEditRows() {
    return [
        new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(
                        'botmenu:nick'
                    )
                    .setLabel('Nick')
                    .setEmoji('🎮')
                    .setStyle(
                        ButtonStyle.Secondary
                    ),

                new ButtonBuilder()
                    .setCustomId(
                        'botmenu:class'
                    )
                    .setLabel('Klasa')
                    .setEmoji('🧙')
                    .setStyle(
                        ButtonStyle.Primary
                    ),

                new ButtonBuilder()
                    .setCustomId(
                        'botmenu:role'
                    )
                    .setLabel('Funkcja')
                    .setEmoji('⚔️')
                    .setStyle(
                        ButtonStyle.Primary
                    ),

                new ButtonBuilder()
                    .setCustomId(
                        'botmenu:style'
                    )
                    .setLabel('Styl')
                    .setEmoji('🎯')
                    .setStyle(
                        ButtonStyle.Primary
                    ),
            ),

        new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(
                        'botmenu:home'
                    )
                    .setLabel(
                        'Wróć do menu'
                    )
                    .setEmoji('⬅️')
                    .setStyle(
                        ButtonStyle.Secondary
                    )
            ),
    ];
}


function botMenuClassRows(revision) {
    return [
        new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(
                        'botmenu:classselect:' + revision
                    )
                    .setPlaceholder(
                        'Wybierz klasę'
                    )
                    .setMinValues(1)
                    .setMaxValues(1)
                    .addOptions(
                        {
                            label:
                                'Warrior',
                            value:
                                'Warrior',
                            emoji:
                                '⚔️',
                        },
                        {
                            label:
                                'Paladin',
                            value:
                                'Paladin',
                            emoji:
                                '🛡️',
                        },
                        {
                            label:
                                'Hunter',
                            value:
                                'Hunter',
                            emoji:
                                '🏹',
                        },
                        {
                            label:
                                'Rogue',
                            value:
                                'Rogue',
                            emoji:
                                '🗡️',
                        },
                        {
                            label:
                                'Priest',
                            value:
                                'Priest',
                            emoji:
                                '✨',
                        },
                        {
                            label:
                                'Shaman',
                            value:
                                'Shaman',
                            emoji:
                                '🌩️',
                        },
                        {
                            label:
                                'Mage',
                            value:
                                'Mage',
                            emoji:
                                '❄️',
                        },
                        {
                            label:
                                'Warlock',
                            value:
                                'Warlock',
                            emoji:
                                '🔥',
                        },
                        {
                            label:
                                'Druid',
                            value:
                                'Druid',
                            emoji:
                                '🌿',
                        }
                    )
            ),

        new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(
                        'botmenu:edit'
                    )
                    .setLabel('Wróć')
                    .setEmoji('⬅️')
                    .setStyle(
                        ButtonStyle.Secondary
                    )
            ),
    ];
}


function botMenuRoleRows(revision) {
    return [
        new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(
                        'botmenu:roleselect:' + revision
                    )
                    .setPlaceholder(
                        'Wybierz funkcję'
                    )
                    .setMinValues(1)
                    .setMaxValues(1)
                    .addOptions(
                        {
                            label:
                                'Tank',
                            value:
                                'TANK',
                            emoji:
                                '🛡️',
                        },
                        {
                            label:
                                'DPS',
                            value:
                                'DPS',
                            emoji:
                                '⚔️',
                        },
                        {
                            label:
                                'Heal',
                            value:
                                'HEAL',
                            emoji:
                                '💚',
                        }
                    )
            ),

        new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(
                        'botmenu:edit'
                    )
                    .setLabel('Wróć')
                    .setEmoji('⬅️')
                    .setStyle(
                        ButtonStyle.Secondary
                    )
            ),
    ];
}


function botMenuStyleRows(revision) {
    return [
        new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(
                        'botmenu:styleselect:' + revision
                    )
                    .setPlaceholder(
                        'Wybierz styl gry'
                    )
                    .setMinValues(1)
                    .setMaxValues(4)
                    .addOptions(
                        {
                            label:
                                'PvE',
                            value:
                                'PVE',
                            emoji:
                                '🛡️',
                        },
                        {
                            label:
                                'PvP',
                            value:
                                'PVP',
                            emoji:
                                '⚔️',
                        },
                        {
                            label:
                                'Raidy',
                            value:
                                'RAIDY',
                            emoji:
                                '☠️',
                        },
                        {label:'RP / klimat',value:'RP',emoji:'📜'}
                    )
            ),

        new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(
                        'botmenu:edit'
                    )
                    .setLabel('Wróć')
                    .setEmoji('⬅️')
                    .setStyle(
                        ButtonStyle.Secondary
                    )
            ),
    ];
}


function botMenuNickModal(userId,revision) {
    const record =
        sql.getMember.get(
            userId
        );

    const input =
        new TextInputBuilder()
            .setCustomId(
                'botmenu_nick'
            )
            .setLabel(
                'Twój nick w WoW'
            )
            .setPlaceholder(
                'Np. Icex'
            )
            .setRequired(true)
            .setMaxLength(60)
            .setStyle(
                TextInputStyle.Short
            );

    if (
        record?.game_nick
    ) {
        input.setValue(
            String(
                record.game_nick
            ).slice(
                0,
                60
            )
        );
    }

    return new ModalBuilder()
        .setCustomId(
            'botmenu:nickmodal:' + revision
        )
        .setTitle(
            'SentencedBot — nick'
        )
        .addComponents(
            new ActionRowBuilder()
                .addComponents(
                    input
                )
        );
}


async function botMenuBeginProfileEdit(interaction,label,buildRows) {
    await interaction.deferUpdate();
    let payload;
    try {
        const result=await require('./profile-discord.cjs').prepareClassEdit({db,guild:interaction.guild,userId:interaction.user.id});
        payload=result.error?{content:result.error,embeds:[],components:[]}:{content:label,embeds:[],components:buildRows(result.revision)};
    } catch(error) {
        console.error('[profile] could not open edit:',error.message);
        payload={content:'Nie udało się otworzyć edycji profilu. Spróbuj ponownie.',embeds:[],components:[]};
    }
    return interaction.editReply(payload);
}
async function botMenuSaveProfileEdit(interaction,field,revision,value,label,modal=false) {
    if(modal) await interaction.deferReply({flags:MessageFlags.Ephemeral}); else await interaction.deferUpdate();
    let result;
    try {result=await require('./profile-discord.cjs').saveProfileEdit({db,guild:interaction.guild,userId:interaction.user.id,revision,field,value});}
    catch(error) {
        console.error('[profile] save not confirmed:',error.message);
        return interaction.editReply({content:'Nie udało się potwierdzić zapisu. Sprawdź profil przed ponowieniem.',embeds:[],components:[]});
    }
    if(result.error) return interaction.editReply({content:result.error,embeds:[],components:[]});
    let payload;
    try {
        const record=await botMenuRefreshProfile(interaction);
        payload={content:label,embeds:[botMenuProfileEmbed(interaction.user,record)],components:botMenuEditRows()};
    } catch(error) {
        console.error('[profile] saved; refresh or render failed:',error.message);
        payload={content:'✅ Zmianę zapisano, ale nie udało się odświeżyć lub wyświetlić widoku gildii.',embeds:[],components:[]};
    }
    return interaction.editReply(payload);
}
function botMenuNickOpenRows(revision) {
    return [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('botmenu:nickopen:'+revision).setLabel('Otwórz formularz nicka').setStyle(ButtonStyle.Primary))];
}

async function botMenuEnsureMember(
    interaction
) {
    const member =
        await getInteractionMember(
            interaction
        );

    upsertMember(member);

    return member;
}


async function botMenuRefreshProfile(
    interaction
) {
    await refreshGuildState(
        interaction.guild
    );

    return sql.getMember.get(
        interaction.user.id
    );
}


async function ensureBotMenuSlashCommand() {
    try {
        const base =
            `https://discord.com/api/v10/applications/${process.env.CLIENT_ID}/guilds/${GUILD_ID}/commands`;

        const headers = {
            Authorization:
                `Bot ${process.env.DISCORD_TOKEN}`,
            'Content-Type':
                'application/json',
        };

        const response =
            await fetch(
                base,
                {
                    headers,
                }
            );

        if (!response.ok) {
            throw new Error(
                `GET commands: ${response.status}`
            );
        }

        const commands =
            await response.json();

        const existing =
            commands.find(
                command =>
                    command.name ===
                        'bot' &&
                    command.type === 1
            );

        const payload = {
            name:
                'bot',
            description:
                'Otwórz interaktywny panel SentencedBota',
            type:
                1,
        };

        let writeResponse;

        if (existing) {
            writeResponse =
                await fetch(
                    `${base}/${existing.id}`,
                    {
                        method:
                            'PATCH',
                        headers,
                        body:
                            JSON.stringify(
                                payload
                            ),
                    }
                );
        } else {
            writeResponse =
                await fetch(
                    base,
                    {
                        method:
                            'POST',
                        headers,
                        body:
                            JSON.stringify(
                                payload
                            ),
                    }
                );
        }

        if (!writeResponse.ok) {
            throw new Error(
                `WRITE /bot: ${writeResponse.status} ${await writeResponse.text()}`
            );
        }

        console.log(
            '✅ /bot • Panel gracza online'
        );
    } catch (error) {
        console.error(
            'BOT MENU COMMAND:',
            error
        );
    }
}


client.once(
    Events.ClientReady,
    async () => {
        await ensureBotMenuSlashCommand();
    }
);


client.on(
    Events.InteractionCreate,
    async interaction => {
        try {
            if(await require('./maintenance.cjs').guardInteraction(db,interaction))return;
            /*
             * /bot
             */
            if (
                (interaction.isChatInputCommand() && interaction.commandName === 'bot') ||
                interaction.customId === 'botmenu:open'
            ) {
                await interaction.deferReply({
                    flags:
                        MessageFlags.Ephemeral,
                });

                await botMenuEnsureMember(
                    interaction
                );

                await interaction.editReply({
                    embeds: [
                        botMenuMainEmbed(
                            interaction.user.id
                        ),
                    ],
                    components:
                        botMenuMainRows(
                            interaction.guild, interaction.member
                        ),
                });

                return;
            }

            if (
                typeof interaction.customId !==
                    'string' ||
                !interaction.customId.startsWith(
                    'botmenu:'
                )
            ) {
                return;
            }

            /*
             * HOME
             */
            if (
                interaction.customId ===
                    'botmenu:home'
            ) {
                await interaction.update({
                    content:
                        null,
                    embeds: [
                        botMenuMainEmbed(
                            interaction.user.id
                        ),
                    ],
                    components:
                        botMenuMainRows(
                            interaction.guild, interaction.member
                        ),
                });

                return;
            }

            /*
             * PROFIL
             */
            if (
                interaction.customId ===
                    'botmenu:profile'
            ) {
                const record =
                    sql.getMember.get(
                        interaction.user.id
                    );

                await interaction.update({
                    content:
                        null,
                    embeds: [
                        botMenuProfileEmbed(
                            interaction.user,
                            record
                        ),
                    ],
                    components: [
                        ...integrationPairRows(interaction.user.id,interaction.guild),
                        new ActionRowBuilder()
                            .addComponents(
                                new ButtonBuilder()
                                    .setCustomId(
                                        missingProfileFields(record).length ? `botmenu:${missingProfileFields(record)[0][2]}` : 'botmenu:edit'
                                    )
                                    .setLabel(
                                        missingProfileFields(record).length ? `Uzupełnij: ${missingProfileFields(record)[0][1]}` : 'Edytuj profil'
                                    )
                                    .setEmoji(
                                        '✏️'
                                    )
                                    .setStyle(
                                        ButtonStyle.Success
                                    ),

                                new ButtonBuilder()
                                    .setCustomId(
                                        'botmenu:home'
                                    )
                                    .setLabel(
                                        'Menu'
                                    )
                                    .setEmoji(
                                        '⬅️'
                                    )
                                    .setStyle(
                                        ButtonStyle.Secondary
                                    )
                            ),
                    ],
                });

                return;
            }

            /*
             * MENU EDYCJI
             */
            if (
                interaction.customId ===
                    'botmenu:edit'
            ) {
                await interaction.update({
                    content:
                        '✏️ **Co chcesz zmienić w swoim profilu?**',
                    embeds: [],
                    components:
                        botMenuEditRows(),
                });

                return;
            }

            /*
             * KLASA
             */
            if (interaction.customId === 'botmenu:class') {
                await botMenuBeginProfileEdit(interaction,'🧙 **Wybierz swoją klasę:**',botMenuClassRows);return;
            }
            if ((interaction.customId === 'botmenu:classselect' || interaction.customId.startsWith('botmenu:classselect:')) && interaction.isStringSelectMenu()) {
                await botMenuSaveProfileEdit(interaction,'wow_class',interaction.customId.slice('botmenu:classselect:'.length),interaction.values?.[0],'✅ **Klasa została zaktualizowana.**');return;
            }

            /*
             * FUNKCJA
             */
            if (interaction.customId === 'botmenu:role') {
                await botMenuBeginProfileEdit(interaction,'⚔️ **Wybierz swoją funkcję:**',botMenuRoleRows);return;
            }
            if ((interaction.customId === 'botmenu:roleselect' || interaction.customId.startsWith('botmenu:roleselect:')) && interaction.isStringSelectMenu()) {
                await botMenuSaveProfileEdit(interaction,'wow_role',interaction.customId.slice('botmenu:roleselect:'.length),interaction.values?.[0],'✅ **Funkcja została zaktualizowana.**');return;
            }
            /* STYL */
            if (interaction.customId === 'botmenu:style') {
                await botMenuBeginProfileEdit(interaction,'🎯 **Wybierz styl gry. Możesz zaznaczyć kilka opcji:**',botMenuStyleRows);return;
            }
            if ((interaction.customId === 'botmenu:styleselect' || interaction.customId.startsWith('botmenu:styleselect:')) && interaction.isStringSelectMenu()) {
                await botMenuSaveProfileEdit(interaction,'interests',interaction.customId.slice('botmenu:styleselect:'.length),interaction.values,'✅ **Styl gry został zaktualizowany.**');return;
            }
            /* NICK: otwarcie formularza to osobne naciśnięcie, bo Discord wymaga odpowiedzi modalem bez wcześniejszego defer. */
            if (interaction.customId === 'botmenu:nick') {
                await botMenuBeginProfileEdit(interaction,'🎮 Otwórz formularz, aby zmienić nick.',botMenuNickOpenRows);return;
            }
            if (interaction.customId.startsWith('botmenu:nickopen:')) {
                const revision=interaction.customId.slice('botmenu:nickopen:'.length);
                if(!/^[a-f0-9]{64}$/.test(revision)){await interaction.reply({content:'To menu wygasło. Otwórz edycję ponownie.',flags:MessageFlags.Ephemeral});return;}
                await interaction.showModal(botMenuNickModal(interaction.user.id,revision));return;
            }
            if ((interaction.customId === 'botmenu:nickmodal' || interaction.customId.startsWith('botmenu:nickmodal:')) && interaction.isModalSubmit()) {
                await botMenuSaveProfileEdit(interaction,'game_nick',interaction.customId.slice('botmenu:nickmodal:'.length),interaction.fields.getTextInputValue('botmenu_nick'),'✅ **Nick został zaktualizowany.**',true);return;
            }
            /*
             * HELP
             */
            if (
                interaction.customId ===
                    'botmenu:help'
            ) {
                const polls =
                    getChannel(
                        interaction.guild,
                        'ankiety'
                    );

                const calendar =
                    getChannel(
                        interaction.guild,
                        'kalendarz'
                    );

                const state =
                    getChannel(
                        interaction.guild,
                        'stan-gildii'
                    );

                const lines = [
                    '❓ **SENTENCEDBOT • POMOC**',
                    '',
                    '👤 **Profil** — podgląd i edycja danych gildyjnych.',
                    '🧙 **Klasa** — wybór klasy WoW.',
                    '⚔️ **Funkcja** — Tank / DPS / Heal.',
                    '🎯 **Styl** — PvE / PvP / Raidy.',
                    '🌍 **Forever** — informacja, czy planujesz grać.',
                ];

                if (calendar) {
                    lines.push(
                        `☠️ **Raidy:** <#${calendar.id}>`
                    );
                }

                if (polls) {
                    lines.push(
                        `🗳️ **Ankiety:** <#${polls.id}>`
                    );
                }

                if (state) {
                    lines.push(
                        `📊 **Stan gildii:** <#${state.id}>`
                    );
                }

                lines.push(
                    '',
                    'Najprościej: wpisz zawsze **`/bot`**.'
                );

                await interaction.update({
                    content:
                        lines.join('\n'),
                    embeds: [],
                    components: [
                        new ActionRowBuilder()
                            .addComponents(
                                new ButtonBuilder()
                                    .setCustomId(
                                        'botmenu:home'
                                    )
                                    .setLabel(
                                        'Wróć do menu'
                                    )
                                    .setEmoji(
                                        '⬅️'
                                    )
                                    .setStyle(
                                        ButtonStyle.Secondary
                                    )
                            ),
                    ],
                });

                return;
            }

        } catch (error) {
            console.error(
                'BOT MENU:',
                error
            );

            if (
                interaction.isRepliable() &&
                !interaction.replied &&
                !interaction.deferred
            ) {
                await interaction.reply({
                    content:
                        '⚠️ Panel bota napotkał błąd. Spróbuj ponownie za chwilę.',
                    flags:
                        MessageFlags.Ephemeral,
                }).catch(
                    () => {}
                );
            }
        }
    }
);


client.login(
    process.env.DISCORD_TOKEN
);

/*
========================================================================
RĘCZNA ZMIANA RANGI → SYNCHRONIZACJA DOSTĘPU
========================================================================
GM może ręcznie nadać rangę gildyjną użytkownikowi bez formularza.
Bot:
- usuwa Oczekujący,
- oznacza profil jako approved,
- zachowuje puste dane profilu do późniejszego uzupełnienia.
*/

client.on(
    Events.GuildMemberUpdate,
    async (oldMember, newMember) => {
        try {
            const guildRanks = [
                'GM',
                'Oficer',
                'Raid Lider',
                'Member',
            ];

            const oldRanks =
                oldMember.roles.cache.filter(
                    role => guildRanks.includes(role.name)
                );

            const newRanks =
                newMember.roles.cache.filter(
                    role => guildRanks.includes(role.name)
                );

            /*
             * Jedna główna ranga gildyjna.
             * Kolejność powyżej = priorytet.
             */
            if (newRanks.size > 1) {
                const primaryName =
                    guildRanks.find(name =>
                        newRanks.some(
                            role => role.name === name
                        )
                    );

                const primary =
                    newRanks.find(
                        role => role.name === primaryName
                    );

                const redundant =
                    newRanks.filter(
                        role => role.id !== primary.id
                    );

                for (const role of redundant.values()) {
                    await newMember.roles.remove(
                        role,
                        `Hierarchia rang: pozostaje ${primary.name}`
                    );
                }

                console.log(
                    `🔄 Rangi: ${newMember.user.tag} → ${primary.name}`
                );
            }

            /*
             * Pierwsza normalna ranga = zaakceptowany członek.
             */
            if (
                !TS_ONBOARDING_V6_ENABLED &&
                oldRanks.size === 0 &&
                newRanks.size > 0
            ) {
                const waiting =
                    getRole(
                        newMember.guild,
                        'Oczekujący'
                    );

                if (
                    waiting &&
                    newMember.roles.cache.has(
                        waiting.id
                    )
                ) {
                    await newMember.roles.remove(
                        waiting,
                        'Nadano rangę gildyjną'
                    );
                }

                sql.upsert.run(
                    newMember.id,
                    newMember.user.tag,
                    newMember.displayName,
                    now(),
                    now()
                );

                db.prepare(`
                    UPDATE members
                    SET
                        onboarding_status = 'approved',
                        approved_at = COALESCE(
                            approved_at,
                            ?
                        ),
                        approved_by = COALESCE(
                            approved_by,
                            'MANUAL_ROLE'
                        )
                    WHERE user_id = ?
                `).run(
                    now(),
                    newMember.id
                );

                /*
                 * AUTO/MANUAL ROLE WELCOME
                 * Pierwsza normalna ranga = członek gildii.
                 */
                await sendPersonalizedWelcome(
                    newMember.guild,
                    newMember
                );
            }

            /*
             * GUILD STATE PRO v2 — synchronizacja rang.
             */
            await refreshGuildState(
                newMember.guild
            );

        } catch (error) {
            console.error(
                'GUILD ROLE SYNC:',
                error
            );
        }
    }
);

function integrationPairRows(userId,guild) {
 if(!integrationDevices)return [];
 const items=[new ButtonBuilder().setCustomId('integration:addon').setLabel('Połącz addon').setStyle(ButtonStyle.Secondary),new ButtonBuilder().setCustomId('integration:client').setLabel('Połącz program').setStyle(ButtonStyle.Secondary),new ButtonBuilder().setCustomId('integration:revoke').setLabel('Odłącz urządzenia').setStyle(ButtonStyle.Danger)];
 items.push(new ButtonBuilder().setCustomId('transfer:open').setLabel('Synchronizacja dodatku').setStyle(ButtonStyle.Primary));
 if(userId===guild.ownerId)items.push(new ButtonBuilder().setCustomId('integration:relay').setLabel('Połącz bramę gildii').setStyle(ButtonStyle.Secondary));
 return [new ActionRowBuilder().addComponents(...items)];
}
