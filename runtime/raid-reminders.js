const {deliverOnce}=require('./delivery-guard');
const {DateTime}=require('luxon');
const {
    EmbedBuilder,
} = require('discord.js');

function ensureSchema(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS raid_reminders (
            raid_id INTEGER NOT NULL,
            reminder_type TEXT NOT NULL,
            scheduled_ts INTEGER NOT NULL,
            sent_at INTEGER NOT NULL,

            PRIMARY KEY (
                raid_id,
                reminder_type,
                scheduled_ts
            )
        );
    `);
}

function wasSent(
    db,
    raidId,
    type,
    scheduledTs
) {
    return Boolean(
        db.prepare(`
            SELECT 1
            FROM raid_reminders
            WHERE
                raid_id = ?
                AND reminder_type = ?
                AND scheduled_ts = ?
        `).get(
            raidId,
            type,
            scheduledTs
        )
    );
}

function markSent(
    db,
    raidId,
    type,
    scheduledTs
) {
    db.prepare(`
        INSERT OR IGNORE INTO raid_reminders (
            raid_id,
            reminder_type,
            scheduled_ts,
            sent_at
        )
        VALUES (?, ?, ?, ?)
    `).run(
        raidId,
        type,
        scheduledTs,
        Date.now()
    );
}

function getRoster(
    db,
    raidId
) {
    return db.prepare(`
        SELECT
            rs.user_id,
            rs.status,
            m.wow_class,
            m.wow_role

        FROM raid_signups rs

        LEFT JOIN members m
            ON m.user_id = rs.user_id

        WHERE
            rs.raid_id = ?
            AND rs.status = 'YES'
    `).all(
        raidId
    );
}

async function checkRaidReminders({
    db,
    guild,
    getChannel,
}) {
    if(require('./maintenance.cjs').maintenance(db))return;
    const now =
        Math.floor(
            Date.now() / 1000
        );

    const next24h =
        now + 86400;

    const raids =
        db.prepare(`
            SELECT *
            FROM raids

            WHERE
                status IN (
                    'ACTIVE',
                    'CLOSED'
                )

                AND scheduled_ts > ?
                AND scheduled_ts <= ?

            ORDER BY scheduled_ts ASC
        `).all(
            now,
            next24h
        );

    const channel =
        getChannel(
            guild,
            'raid-ogłoszenia'
        );

    if (!channel) {
        return;
    }

    for (const raid of raids) {
        const secondsLeft =
            raid.scheduled_ts - now;

        let type = null;
        let title = null;

        if (
            secondsLeft <= 7200
        ) {
            type = '2H';

            title =
                '⏰ RAID ZA OKOŁO 2 GODZINY';
        } else {
            type = '24H';

            title =
                '📅 RAID W CIĄGU 24 GODZIN';
        }

        if (
            wasSent(
                db,
                raid.id,
                type,
                raid.scheduled_ts
            )
        ) {
            continue;
        }

        const roster =
            getRoster(
                db,
                raid.id
            );

        const tanks =
            roster.filter(
                x =>
                    x.wow_role ===
                    'TANK'
            );

        const heals =
            roster.filter(
                x =>
                    x.wow_role ===
                    'HEAL'
            );

        const dps =
            roster.filter(
                x =>
                    x.wow_role ===
                    'DPS'
            );

        const unknown =
            roster.filter(
                x =>
                    ![
                        'TANK',
                        'HEAL',
                        'DPS',
                    ].includes(
                        x.wow_role
                    )
            );

        const free =
            raid.player_limit
                ? Math.max(
                    0,
                    raid.player_limit -
                    roster.length
                )
                : null;

        const mentions =
            roster.map(
                x =>
                    `<@${x.user_id}>`
            );

        const embed =
            new EmbedBuilder()
                .setTitle(
                    title
                )

                .setDescription(
                    [
                        `⚔️ **${raid.name}**`,
                        `📅 <t:${raid.scheduled_ts}:F>`,
                        `⏳ <t:${raid.scheduled_ts}:R>`,
                    ].join('\n')
                )

                .addFields(
                    {
                        name:
                            '🛡️ Tank',
                        value:
                            String(
                                tanks.length
                            ),
                        inline: true,
                    },

                    {
                        name:
                            '💚 Heal',
                        value:
                            String(
                                heals.length
                            ),
                        inline: true,
                    },

                    {
                        name:
                            '⚔️ DPS',
                        value:
                            String(
                                dps.length
                            ),
                        inline: true,
                    },

                    {
                        name:
                            '👥 Potwierdzeni',
                        value:
                            raid.player_limit
                                ? `${roster.length}/${raid.player_limit}`
                                : String(
                                    roster.length
                                ),
                        inline: true,
                    },

                    {
                        name:
                            '🪑 Wolne miejsca',
                        value:
                            free === null
                                ? '—'
                                : String(
                                    free
                                ),
                        inline: true,
                    },

                    {
                        name:
                            '❓ Bez funkcji',
                        value:
                            String(
                                unknown.length
                            ),
                        inline: true,
                    }
                )

                .setFooter({
                    text:
                        `The Sentenced • Raid #${raid.id}`,
                })

                .setTimestamp();

        const content =
            mentions.length
                ? `🔔 ${mentions.join(' ')}`
                : undefined;

        if(require('./maintenance.cjs').maintenance(db))return;
        const effect = await deliverOnce(db,{
            key:`raid-public:${raid.id}:${type}:${raid.scheduled_ts}`,
            kind:'raid_public',recipient:channel.id,
            day:DateTime.now().setZone('Europe/Warsaw').toISODate(),
        },()=>channel.send({
            content,

            embeds: [
                embed
            ],

            allowedMentions: {
                users:
                    roster.map(
                        x =>
                            x.user_id
                    ),
            },
        }));

        if(effect.status!=='sent')continue;

        markSent(
            db,
            raid.id,
            type,
            raid.scheduled_ts
        );

        console.log(
            `⏰ Raid #${raid.id}: reminder ${type}`
        );
    }
}

function startRaidReminderEngine({
    db,
    guild,
    getChannel,
}) {
    ensureSchema(db);

    console.log(
        '✅ Raid Reminder Engine online'
    );

    let running = false;

    const run = async () => {
        if (running) {
            console.log(
                '⏭️ Raid Reminder Engine: poprzednie sprawdzenie nadal trwa'
            );

            return;
        }

        running = true;

        try {
            await checkRaidReminders({
                db,
                guild,
                getChannel,
            });
        } finally {
            running = false;
        }
    };

    run().catch(
        console.error
    );

    const timer =
        setInterval(
            () => {
                run().catch(
                    console.error
                );
            },

            60 * 1000
        );

    return timer;
}

module.exports = {
    startRaidReminderEngine,
};
