const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
} = require('discord.js');

const { STAFF: MANAGER_ROLES, PLAYERS: PLAYER_ROLES, has } = require('./guild-core');

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

function ensureSchema(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS polls (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            channel_id TEXT,
            message_id TEXT,
            question TEXT NOT NULL,
            options_json TEXT NOT NULL,
            created_by TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            closed_at INTEGER,
            status TEXT NOT NULL DEFAULT 'OPEN'
        );

        CREATE TABLE IF NOT EXISTS poll_votes (
            poll_id INTEGER NOT NULL,
            user_id TEXT NOT NULL,
            option_index INTEGER NOT NULL,
            voted_at INTEGER NOT NULL,
            PRIMARY KEY (poll_id, user_id)
        );

        CREATE INDEX IF NOT EXISTS idx_poll_votes_poll
            ON poll_votes(poll_id);

        CREATE INDEX IF NOT EXISTS idx_polls_guild
            ON polls(guild_id);
    `);
}

async function isGuildPlayer(interaction) {
    const member =
        await getInteractionMember(
            interaction
        );

    if (member.id === member.guild.ownerId) {
        return true;
    }

    return member.roles.cache.some(
        role => PLAYER_ROLES.includes(role.name)
    );
}

async function isPollManager(interaction) {
    const member =
        await getInteractionMember(
            interaction
        );

    if (member.id === member.guild.ownerId) {
        return true;
    }

    return member.roles.cache.some(
        role => MANAGER_ROLES.includes(role.name)
    );
}

function getPoll(db, pollId, guildId) {
    return db.prepare(`
        SELECT *
        FROM polls
        WHERE id = ?
          AND guild_id = ?
    `).get(
        pollId,
        guildId
    );
}

// No await inside this transaction: closing, option edits and role changes
// while Discord acknowledges a click cannot authorize a stale vote.
function recordVote(db, interaction, pollId, optionIndex) {
    return db.transaction(() => {
        // Startup warms the guild cache. A removed member must not regain
        // authorization from the stale interaction snapshot after ACK.
        const member = interaction.guild.members.cache.get(interaction.user.id);
        if (!has(member, PLAYER_ROLES)) return { error: '❌ Głosowanie jest dostępne od rangi Trial.' };
        if (!Number.isSafeInteger(pollId) || !Number.isSafeInteger(optionIndex)) return { error: '❌ Nieprawidłowa odpowiedź.' };
        const poll = getPoll(db, pollId, interaction.guild.id);
        if (!poll) return { error: '❌ Ta ankieta już nie istnieje.' };
        if (poll.status !== 'OPEN') return { error: '🔒 Ta ankieta jest już zamknięta.' };
        let options;
        try { options = JSON.parse(poll.options_json); } catch { return { error: '❌ Ankieta ma nieprawidłowe opcje. Zgłoś to kadrze.' }; }
        if (!Array.isArray(options) || optionIndex < 0 || optionIndex >= options.length) return { error: '❌ Nieprawidłowa odpowiedź.' };
        db.prepare(`INSERT INTO poll_votes(poll_id,user_id,option_index,voted_at)
            VALUES(?,?,?,?) ON CONFLICT(poll_id,user_id) DO UPDATE SET
            option_index=excluded.option_index,voted_at=excluded.voted_at`).run(pollId,interaction.user.id,optionIndex,Date.now());
        return { poll, choice: options[optionIndex] };
    })();
}

function getVotes(db, pollId, optionCount) {
    const rows = db.prepare(`
        SELECT
            option_index,
            COUNT(*) AS count
        FROM poll_votes
        WHERE poll_id = ?
        GROUP BY option_index
    `).all(pollId);

    const counts =
        Array(optionCount).fill(0);

    for (const row of rows) {
        if (
            row.option_index >= 0 &&
            row.option_index < counts.length
        ) {
            counts[row.option_index] =
                Number(row.count);
        }
    }

    return counts;
}

function makeBar(value, total) {
    const width = 10;

    if (!total) {
        return '░'.repeat(width);
    }

    const filled =
        Math.round(
            (value / total) * width
        );

    return (
        '█'.repeat(filled) +
        '░'.repeat(width - filled)
    );
}

function buildPollEmbed(
    db,
    poll
) {
    const options =
        JSON.parse(poll.options_json);

    const votes =
        getVotes(
            db,
            poll.id,
            options.length
        );

    const total =
        votes.reduce(
            (sum, value) =>
                sum + value,
            0
        );

    const lines =
        options.map(
            (option, index) => {
                const count =
                    votes[index];

                const percent =
                    total
                        ? Math.round(
                            (count / total) * 100
                        )
                        : 0;

                return [
                    `**${index + 1}. ${option}**`,
                    `${makeBar(count, total)}  **${percent}%** — ${count} gł.`,
                ].join('\n');
            }
        );

    const closed =
        poll.status === 'CLOSED';

    return new EmbedBuilder()
        .setColor(
            closed
                ? 0x4F545C
                : 0x8B1E1E
        )
        .setTitle(
            closed
                ? `🔒 ANKIETA #${poll.id} ZAMKNIĘTA • ${poll.question}`
                : `📊 ANKIETA #${poll.id} • ${poll.question}`
        )
        .setDescription(
            lines.join('\n\n')
        )
        .addFields(
            {
                name: '🗳️ GŁOSY',
                value: `**${total}**`,
                inline: true,
            },
            {
                name: '📌 STATUS',
                value:
                    closed
                        ? '🔒 Zamknięta'
                        : '🟢 Otwarta',
                inline: true,
            },
            {
                name: '🔢 ID',
                value: `#${poll.id}`,
                inline: true,
            }
        )
        .setFooter({
            text:
                closed
                    ? `The Sentenced • ID #${poll.id} • Głosowanie zakończone`
                    : `The Sentenced • ID #${poll.id} • Wybierz odpowiedź poniżej`,
        })
        .setTimestamp(
            new Date(
                poll.created_at
            )
        );
}

function buildPollButtons(
    poll
) {
    let options;
    try { options = JSON.parse(poll.options_json); } catch { options = []; }

    const closed =
        poll.status === 'CLOSED';

    if (closed) {
        return [];
    }

    const row =
        new ActionRowBuilder();

    options.forEach(
        (option, index) => {
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(
                        `poll:vote:${poll.id}:${index}`
                    )
                    .setLabel(
                        String(index + 1)
                    )
                    .setStyle(
                        ButtonStyle.Primary
                    )
            );
        }
    );

    return [row];
}

function buildPollPayload(
    db,
    poll
) {
    return {
        embeds: [
            buildPollEmbed(
                db,
                poll
            ),
        ],
        components:
            buildPollButtons(
                poll
            ),
    };
}

async function getPollChannel(
    interaction
) {
    const channels =
        await interaction.guild.channels.fetch();

    return [...channels.values()].find(
        channel =>
            channel?.name === 'ankiety'
    ) || null;
}

async function refreshPollMessageNow(
    interaction,
    db,
    poll
) {
    let message = null;

    if (
        interaction.message &&
        interaction.message.id ===
            poll.message_id
    ) {
        message =
            interaction.message;
    } else {
        const channel =
            await interaction.guild.channels.fetch(
                poll.channel_id
            );

        if (channel?.isTextBased()) {
            message =
                await channel.messages.fetch(
                    poll.message_id
                ).catch(() => null);
        }
    }

    if (!message) {
        return false;
    }

    await message.edit(
        buildPollPayload(
            db,
            poll
        )
    );
    return true;
}

const pollRefreshChains =
    new Map();

function refreshPollMessage(
    interaction,
    db,
    poll
) {
    const key =
        `${poll.guild_id}:${poll.id}`;

    const previous =
        pollRefreshChains.get(key) ||
        Promise.resolve();

    const current = previous
        .catch(() => {})
        .then(() => {
            const latest =
                getPoll(
                    db,
                    poll.id,
                    poll.guild_id
                );

            if (!latest) {
                return;
            }

            return refreshPollMessageNow(
                interaction,
                db,
                latest
            );
        })
        .finally(() => {
            if (
                pollRefreshChains.get(key) ===
                    current
            ) {
                pollRefreshChains.delete(key);
            }
        });

    pollRefreshChains.set(
        key,
        current
    );

    return current;
}

async function createPoll({
    interaction,
    db,
    getChannel,
}) {
    await interaction.deferReply({
        flags:
            MessageFlags.Ephemeral,
    });

    if (
        !(await isPollManager(
            interaction
        ))
    ) {
        await interaction.editReply({
            content:
                '❌ Ankiety może tworzyć GM, Oficer lub Raid Lider.',
        });

        return;
    }

    const question =
        interaction.options
            .getString(
                'pytanie',
                true
            )
            .trim();

    const options = [];

    for (
        let index = 1;
        index <= 5;
        index++
    ) {
        const value =
            interaction.options
                .getString(
                    `opcja${index}`
                );

        if (
            value &&
            value.trim()
        ) {
            options.push(
                value.trim()
            );
        }
    }

    if (options.length < 2) {
        await interaction.editReply({
            content:
                '❌ Ankieta potrzebuje co najmniej dwóch odpowiedzi.',
        });

        return;
    }

    const channel =
        await getPollChannel(
            interaction
        );

    if (
        !channel ||
        !channel.isTextBased()
    ) {
        await interaction.editReply({
            content:
                '❌ Nie znalazłem kanału #ankiety.',
        });

        return;
    }

    const result =
        db.prepare(`
            INSERT INTO polls (
                guild_id,
                question,
                options_json,
                created_by,
                created_at,
                status
            )
            VALUES (?, ?, ?, ?, ?, 'OPEN')
        `).run(
            interaction.guild.id,
            question,
            JSON.stringify(options),
            interaction.user.id,
            Date.now()
        );

    const pollId =
        Number(
            result.lastInsertRowid
        );

    let poll =
        getPoll(
            db,
            pollId,
            interaction.guild.id
        );

    const message =
        await channel.send(
            buildPollPayload(
                db,
                poll
            )
        );

    db.prepare(`
        UPDATE polls
        SET
            channel_id = ?,
            message_id = ?
        WHERE id = ?
    `).run(
        channel.id,
        message.id,
        pollId
    );

    await interaction.editReply({
        content:
            `✅ Ankieta **#${pollId}** utworzona na ${channel}.\n${message.url}`,
    });
}

async function votePoll({
    interaction,
    db,
}) {
    if (!(await isGuildPlayer(interaction))) {
        await interaction.reply({
            content:
                '❌ Głosowanie jest dostępne od rangi Trial.',
            flags:
                MessageFlags.Ephemeral,
        });

        return;
    }

    const parts =
        interaction.customId.split(':');

    const pollId =
        Number(parts[2]);

    const optionIndex =
        Number(parts[3]);

    const poll =
        getPoll(
            db,
            pollId,
            interaction.guild.id
        );

    if (!poll) {
        await interaction.reply({
            content:
                '❌ Ta ankieta już nie istnieje.',
            flags:
                MessageFlags.Ephemeral,
        });

        return;
    }

    if (
        poll.status !== 'OPEN'
    ) {
        await interaction.reply({
            content:
                '🔒 Ta ankieta jest już zamknięta.',
            flags:
                MessageFlags.Ephemeral,
        });

        return;
    }

    let options;
    try { options = JSON.parse(poll.options_json); } catch { options = []; }

    if (
        !Number.isSafeInteger(pollId) || !Number.isSafeInteger(optionIndex) || !Array.isArray(options) || optionIndex < 0 ||
        optionIndex >=
            options.length
    ) {
        await interaction.reply({
            content:
                '❌ Nieprawidłowa odpowiedź.',
            flags:
                MessageFlags.Ephemeral,
        });

        return;
    }

    await interaction.deferUpdate();

    const outcome = recordVote(db, interaction, pollId, optionIndex);
    if (outcome.error) {
        await interaction.followUp({content: outcome.error, flags: MessageFlags.Ephemeral});
        return;
    }

    const updated =
        getPoll(
            db,
            pollId,
            interaction.guild.id
        );

    await refreshPollMessage(
        interaction,
        db,
        updated
    );

    await interaction.followUp({
        content:
            `✅ Twój głos: **${outcome.choice}**`,
        flags:
            MessageFlags.Ephemeral,
    });
}

async function closePoll({
    interaction,
    db,
}) {
    await interaction.deferReply({
        flags:
            MessageFlags.Ephemeral,
    });

    if (
        !(await isPollManager(
            interaction
        ))
    ) {
        await interaction.editReply({
            content:
                '❌ Ankietę może zamknąć GM, Oficer lub Raid Lider.',
        });

        return;
    }

    const pollId =
        interaction.options
            .getInteger(
                'id',
                true
            );

    let poll =
        getPoll(
            db,
            pollId,
            interaction.guild.id
        );

    if (!poll) {
        await interaction.editReply({
            content:
                `❌ Ankieta #${pollId} nie istnieje.`,
        });

        return;
    }

    if (
        poll.status === 'CLOSED'
    ) {
        await interaction.editReply({
            content:
                `ℹ️ Ankieta #${pollId} jest już zamknięta.`,
        });

        return;
    }

    db.prepare(`
        UPDATE polls
        SET
            status = 'CLOSED',
            closed_at = ?
        WHERE id = ? AND guild_id = ? AND status = 'OPEN'
    `).run(
        Date.now(),
        pollId,
        interaction.guild.id
    );

    poll =
        getPoll(
            db,
            pollId,
            interaction.guild.id
        );

    await refreshPollMessage(
        interaction,
        db,
        poll
    );

    await interaction.editReply({
        content:
            `🔒 Ankieta **#${pollId}** została zamknięta.`,
    });
}

async function showResults({
    interaction,
    db,
}) {
    if (!(await isGuildPlayer(interaction))) {
        await interaction.reply({
            content:
                '❌ Wyniki ankiet są dostępne od rangi Trial.',
            flags:
                MessageFlags.Ephemeral,
        });

        return;
    }

    const pollId =
        interaction.options
            .getInteger(
                'id',
                true
            );

    const poll =
        getPoll(
            db,
            pollId,
            interaction.guild.id
        );

    if (!poll) {
        await interaction.reply({
            content:
                `❌ Ankieta #${pollId} nie istnieje.`,
            flags:
                MessageFlags.Ephemeral,
        });

        return;
    }

    await interaction.reply({
        embeds: [
            buildPollEmbed(
                db,
                poll
            ),
        ],
        flags:
            MessageFlags.Ephemeral,
    });
}

async function handlePollInteraction({
    interaction,
    db,
    getChannel,
}) {
    ensureSchema(db);

    if (
        interaction.isButton() &&
        interaction.customId.startsWith(
            'poll:vote:'
        )
    ) {
        await votePoll({
            interaction,
            db,
        });

        return true;
    }

    if (
        !interaction.isChatInputCommand() ||
        interaction.commandName !==
            'ankieta'
    ) {
        return false;
    }

    const subcommand =
        interaction.options
            .getSubcommand();

    if (
        subcommand === 'utworz'
    ) {
        await createPoll({
            interaction,
            db,
            getChannel,
        });

        return true;
    }

    if (
        subcommand === 'zamknij'
    ) {
        await closePoll({
            interaction,
            db,
        });

        return true;
    }

    if (
        subcommand === 'wyniki'
    ) {
        await showResults({
            interaction,
            db,
        });

        return true;
    }

    return false;
}

async function refreshAllPollMessages({
    guild,
    db,
}) {
    const polls =
        db.prepare(`
            SELECT *
            FROM polls
            WHERE guild_id = ?
              AND channel_id IS NOT NULL
              AND message_id IS NOT NULL
        `).all(
            guild.id
        );

    let refreshed = 0;

    for (const poll of polls) {
        try {
            const channel =
                await guild.channels.fetch(
                    poll.channel_id
                ).catch(() => null);

            if (
                !channel ||
                !channel.isTextBased()
            ) {
                continue;
            }

            const message =
                await channel.messages.fetch(
                    poll.message_id
                ).catch(() => null);

            if (!message) {
                continue;
            }

            await message.edit(
                buildPollPayload(
                    db,
                    poll
                )
            );

            refreshed++;

        } catch (error) {
            console.error(
                `Poll #${poll.id} refresh:`,
                error.message
            );
        }
    }

    return refreshed;
}

module.exports = {
    handlePollInteraction,
    refreshAllPollMessages,
    recordVote,
    refreshPollMessage,
};
