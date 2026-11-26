'use strict';

const {channelId} = require('./guild-channel-ids.cjs');

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { DateTime } = require('luxon');
const {createHash}=require('node:crypto');
const {deliverOnce}=require('./delivery-guard');
const {missingProfileFields}=require('./guild-core');
let runtimeDb;

const {
    ChannelType,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} = require('discord.js');

const {
    fetchForeverNewsV2,
} = require('./forever-news-v2');

const TZ = 'Europe/Warsaw';

const {POLL_MS,PUBLISH_INTERVAL_MS} = require('./news/policy.cjs');

const NEWS_MAX_AGE_MS =
    24 * 60 * 60 * 1000;

const NEWS_MIN_SCORE = 2;

// Zachowane wyłącznie dla nieaktywnej, historycznej funkcji Daily poniżej.
const GENERAL_COOLDOWN_MS =
    72 * 60 * 60 * 1000;

const PROFILE_COOLDOWN_MS =
    14 * 24 * 60 * 60 * 1000;

const STATE_FILE =
    path.join(
        __dirname,
        'data',
        'guild-ops-v3.json'
    );

const OLD_NEWS_STATE =
    path.join(
        __dirname,
        'data',
        'forever-news-v2.json'
    );

let started = false;
let dailyRunning = false;
let pollRunning = false;

/*
|--------------------------------------------------------------------------
| HELPERS
|--------------------------------------------------------------------------
*/

function loadState() {
    try {
        const state = {
            version: 4,
            seen: [],
            seenTitles: [],
            pending: [],
            lastPollAt: null,
            lastNewsPublishedAt: null,
            lastDailyDate: null,
            profileReminders: {},
            ...JSON.parse(
                fs.readFileSync(
                    STATE_FILE,
                    'utf8'
                )
            ),
        };

        if (Number(state.version || 0) < 4) {
            const dropped =
                Array.isArray(state.pending)
                    ? state.pending.length
                    : 0;

            state.version = 4;
            state.pending = [];
            state.seenTitles = [];
            // Retain a valid publication timestamp while dropping stale backlog.
            if (!Number.isFinite(Date.parse(state.lastNewsPublishedAt || ''))) {
                state.lastNewsPublishedAt = null;
            }

            console.log(
                `📰 [OpsV3] migracja v4: odrzucono ${dropped} starych pozycji backlogu`
            );
        }

        return state;
    } catch {
        return {
            version: 4,
            seen: [],
            seenTitles: [],
            pending: [],
            lastPollAt: null,
            lastNewsPublishedAt: null,
            lastDailyDate: null,
            profileReminders: {},
        };
    }
}

function saveState(state) {
    fs.mkdirSync(
        path.dirname(STATE_FILE),
        {
            recursive: true,
        }
    );

    const tmp =
        `${STATE_FILE}.tmp`;

    fs.writeFileSync(
        tmp,
        JSON.stringify(
            state,
            null,
            2
        ),
        'utf8'
    );

    fs.renameSync(
        tmp,
        STATE_FILE
    );
}

function seedOldSeen(state) {
    if (
        Array.isArray(state.seen) &&
        state.seen.length
    ) {
        return;
    }

    try {
        const old =
            JSON.parse(
                fs.readFileSync(
                    OLD_NEWS_STATE,
                    'utf8'
                )
            );

        if (
            Array.isArray(old.seen) &&
            old.seen.length
        ) {
            state.seen =
                [...old.seen];

            console.log(
                `📰 [OpsV3] odziedziczono ${state.seen.length} znanych newsów z v2`
            );

            saveState(state);
        }
    } catch {}
}

function cleanTitle(value) {
    return String(value || '')
        .replace(
            /\s+\d+\s*(?:m|min|h|hr|hrs|d|days?)\s+ago\s+by\s+.+$/i,
            ''
        )
        .replace(
            /\s+/g,
            ' '
        )
        .trim();
}

function normalize(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(
            /[\u0300-\u036f]/g,
            ''
        )
        .toLowerCase()
        .replace(
            /[^a-z0-9]+/g,
            '-'
        )
        .replace(
            /^-+|-+$/g,
            ''
        );
}

function titleTokens(value) {
    const ignored = new Set([
        'a', 'an', 'and', 'are', 'at', 'for',
        'from', 'in', 'is', 'of', 'on', 'the',
        'to', 'with', 'wow', 'world', 'warcraft',
        'forever', 'beta', 'new',
    ]);

    return new Set(
        normalize(cleanTitle(value))
            .split('-')
            .filter(
                token =>
                    token.length >= 3 &&
                    !ignored.has(token)
            )
    );
}

function sameStory(left, right) {
    const a = titleTokens(left);
    const b = titleTokens(right);

    if (!a.size || !b.size) {
        return false;
    }

    const common =
        [...a].filter(token => b.has(token)).length;

    return common / Math.min(a.size, b.size) >= 0.7;
}

function sourceIcon(source) {
    return source === 'Wowhead'
        ? '🟠'
        : '🔵';
}

function scoreArticle(item) {
    const title =
        cleanTitle(item.title)
            .toLowerCase();

    let score = 0;

    const major = [
        'release',
        'launch',
        'premiere',
        'goes live',
        'release date',
        'beta access',
        'server',
        'realm',
        'ruleset',
        'maintenance',
        'outage',
        'latency',
        'hotfix',
        'patch notes',
        'class changes',
        'raid',
        'dungeon',
        'progression',
        'gdkp',
        'ban',
        'access',
        'reset',
        'wipe',
    ];

    const medium = [
        'blizzard',
        'official',
        'confirmed',
        'profession',
        'item set',
        'tier set',
        'pvp',
        'balance',
        'system',
        'phasing',
        'bank',
    ];

    const light = [
        'mount',
        'music',
        'sweepstakes',
        'interview',
        'cosmetic',
        'customization',
    ];

    for (const word of major) {
        if (title.includes(word)) {
            score += 3;
        }
    }

    for (const word of medium) {
        if (title.includes(word)) {
            score += 1;
        }
    }

    for (const word of light) {
        if (title.includes(word)) {
            score -= 1;
        }
    }

    return Math.max(
        0,
        score
    );
}

function isTextChannel(channel) {
    return Boolean(
        channel &&
        channel.isTextBased?.() &&
        !channel.isThread?.()
    );
}

function findTextChannel(
    guild,
    names
) {
    const ids = names.map(name => channelId(guild, name)).filter(Boolean);
    if (ids.length) {
        return ids.map(id => guild.channels.cache.get(id)).find(isTextChannel);
    }
    const wanted =
        new Set(
            names.map(normalize)
        );

    return guild.channels.cache.find(
        channel =>
            isTextChannel(channel) &&
            wanted.has(
                normalize(channel.name)
            )
    );
}

function findCategory(
    guild,
    predicate
) {
    return guild.channels.cache.find(
        channel =>
            channel.type ===
                ChannelType.GuildCategory &&
            predicate(channel)
    );
}

function isFunctionalChannel(name) {
    const n =
        normalize(name);

    const exact =
        new Set([
            'start',
            'stan-gildii',
            'ankiety',
            'bot',
            'bot-menu',
            'komendy-bota',
            'veteran',
            'weteran',
            'veteran-quiz',
            'oczekujacy',
            'oczekujacy-na-akceptacje',
            'raid-kalendarz',
            'raid-zapisy',
            'rajd-kalendarz',
            'rajd-zapisy',
            'expedycje',
            'ekspedycje',
        ]);

    if (exact.has(n)) {
        return true;
    }

    return (
        n.startsWith('bot-') ||
        n.startsWith('raid-') ||
        n.startsWith('rajd-') ||
        n.startsWith('veteran-') ||
        n.startsWith('weteran-')
    );
}

function memberHasNormalRole(member) {
    const allowed =
        new Set([
            'gm',
            'oficer',
            'officer',
            'raid lider',
            'raid leader',
            'member',
            'trial',
            'veteran',
        ]);

    return member.roles.cache.some(
        role =>
            allowed.has(
                role.name
                    .trim()
                    .toLowerCase()
            )
    );
}

/*
|--------------------------------------------------------------------------
| DISCORD LAYOUT
|--------------------------------------------------------------------------
*/

async function ensureLayout(
    guild,
    getChannel
) {

    /*
     * OPS_V3_SAFE_LAYOUT_FREEZE_20260921
     *
     * TYLKO ODCZYT.
     * Nie tworzy, nie przenosi i nie zmienia kanałów.
     */
    await guild.channels.fetch()
        .catch(() => {});

    /*
     * OPS_V3_FINAL_LAYOUT_ONCE_20260921
     *
     * Jednorazowe uporządkowanie serwera.
     * Po sukcesie tworzy flagę i nigdy więcej
     * automatycznie nie tasuje kanałów.
     */

    const finalLayoutFlag =
        path.join(
            __dirname,
            'data',
            'layout-final-v1.json'
        );

    if (!fs.existsSync(finalLayoutFlag)) {
        console.log(
            '🧹 [OpsV3] FINAL LAYOUT START'
        );

        const finalGet = id =>
            guild.channels.cache.get(id);

        const finalStartCategory =
            finalGet('1549398540026126448');

        const finalTextCategory =
            finalGet('1549398544421621791');

        const finalFunctionCategory =
            finalGet('1551669365454413885');

        const finalDuplicateCategory =
            finalGet('1551665024953745438');

        const finalRaidCategory =
            finalGet('1549398555175813160');

        const finalStaffCategory =
            finalGet('1549398560498253874');

        const finalVoiceCategory =
            finalGet('1549386960643297392');

        const requiredCategories = [
            ['START', finalStartCategory],
            ['TEXT', finalTextCategory],
            ['FUNCTION', finalFunctionCategory],
            ['RAID', finalRaidCategory],
            ['STAFF', finalStaffCategory],
            ['VOICE', finalVoiceCategory],
        ];

        for (const [name, category] of requiredCategories) {
            if (!category) {
                throw new Error(
                    `Brak kategorii ${name}`
                );
            }
        }

        await finalTextCategory.setName(
            '💬・CZATY TEKSTOWE'
        );

        await finalFunctionCategory.setName(
            '🛠️・BOT I FUNKCJE'
        );

        async function finalMove(
            channelId,
            category,
            position
        ) {
            const channel =
                finalGet(channelId);

            if (!channel) {
                console.warn(
                    `⚠️ Brak kanału ${channelId}`
                );
                return;
            }

            if (
                channel.parentId !==
                category.id
            ) {
                await channel.setParent(
                    category,
                    {
                        lockPermissions: false,
                    }
                );
            }

            await channel
                .setPosition(position)
                .catch(error => {
                    console.warn(
                        `[OpsV3] position ${channel.name}:`,
                        error.message
                    );
                });

            console.log(
                `✅ #${channel.name} → ${category.name}`
            );
        }

        /*
         * START
         */
        await finalMove(
            '1549398541149933683',
            finalStartCategory,
            0
        );

        await finalMove(
            '1549398553313677355',
            finalStartCategory,
            1
        );

        /*
         * CZATY TEKSTOWE
         */
        await finalMove(
            '1549398546896388276',
            finalTextCategory,
            0
        );

        await finalMove(
            '1549398548494422086',
            finalTextCategory,
            1
        );

        await finalMove(
            '1551660125935243426',
            finalTextCategory,
            2
        );

        /*
         * BOT I FUNKCJE
         */
        await finalMove(
            '1549398543360462868',
            finalFunctionCategory,
            0
        );

        await finalMove(
            '1549398549974749324',
            finalFunctionCategory,
            1
        );

        await finalMove(
            '1549398564080324729',
            finalFunctionCategory,
            2
        );

        await finalMove(
            '1549398573009862727',
            finalFunctionCategory,
            3
        );

        await finalMove(
            '1550939366698782811',
            finalFunctionCategory,
            4
        );

        /*
         * KATEGORIE
         */
        const categoryPositions = [
            [finalStartCategory, 0],
            [finalTextCategory, 1],
            [finalFunctionCategory, 2],
            [finalRaidCategory, 3],
            [finalStaffCategory, 4],
            [finalVoiceCategory, 5],
        ];

        for (
            const [category, position]
            of categoryPositions
        ) {
            await category
                .setPosition(position)
                .catch(error => {
                    console.warn(
                        `[OpsV3] category position ${category.name}:`,
                        error.message
                    );
                });
        }

        /*
         * Usuwamy TYLKO pusty duplikat.
         */
        if (finalDuplicateCategory) {
            const children =
                guild.channels.cache.filter(
                    channel =>
                        channel.parentId ===
                        finalDuplicateCategory.id
                );

            if (children.size === 0) {
                await finalDuplicateCategory.delete(
                    'Usunięcie pustego duplikatu kategorii OpsV3'
                );

                console.log(
                    '🗑️ [OpsV3] usunięto pustą zduplikowaną kategorię'
                );
            } else {
                console.warn(
                    '⚠️ Duplikat nie jest pusty — NIE usuwam.'
                );
            }
        }

        fs.writeFileSync(
            finalLayoutFlag,
            JSON.stringify(
                {
                    appliedAt:
                        new Date()
                            .toISOString(),
                    version:
                        1,
                },
                null,
                2
            )
        );

        console.log(
            '✅ [OpsV3] FINAL LAYOUT DONE'
        );
    }

    console.log('');
    console.log(
        '===== OPSV3 CURRENT DISCORD LAYOUT ====='
    );

    const frozenCategories =
        [...guild.channels.cache.values()]
            .filter(
                channel =>
                    channel.type ===
                    ChannelType.GuildCategory
            )
            .sort(
                (a, b) =>
                    a.rawPosition -
                    b.rawPosition
            );

    for (const frozenCategory of frozenCategories) {
        console.log(
            `📁 ${frozenCategory.name} | id=${frozenCategory.id} | pos=${frozenCategory.rawPosition}`
        );

        const frozenChildren =
            [...guild.channels.cache.values()]
                .filter(
                    channel =>
                        channel.parentId ===
                        frozenCategory.id
                )
                .sort(
                    (a, b) =>
                        a.rawPosition -
                        b.rawPosition
                );

        for (const frozenChannel of frozenChildren) {
            const frozenIcon =
                frozenChannel.type ===
                    ChannelType.GuildVoice
                    ? '🔊'
                    : '#';

            console.log(
                `   ${frozenIcon} ${frozenChannel.name} | id=${frozenChannel.id} | pos=${frozenChannel.rawPosition}`
            );
        }
    }

    const frozenLoose =
        [...guild.channels.cache.values()]
            .filter(
                channel =>
                    channel.type !==
                        ChannelType.GuildCategory &&
                    !channel.parentId
            )
            .sort(
                (a, b) =>
                    a.rawPosition -
                    b.rawPosition
            );

    if (frozenLoose.length) {
        console.log('📁 BEZ KATEGORII');

        for (const frozenChannel of frozenLoose) {
            console.log(
                `   # ${frozenChannel.name} | id=${frozenChannel.id} | pos=${frozenChannel.rawPosition}`
            );
        }
    }

    console.log(
        '===== OPSV3 END DISCORD LAYOUT ====='
    );
    console.log('');

    const frozenGeneral =
        getChannel?.(
            guild,
            'ogólny'
        ) ||
        findTextChannel(
            guild,
            [
                'ogólny',
                'ogolny',
                'general',
            ]
        );

    const frozenNewsChannel =
        findTextChannel(
            guild,
            [
                'forever-news',
            ]
        );

    const frozenFunctionalCategory =
        findCategory(
            guild,
            channel =>
                normalize(
                    channel.name
                ).includes(
                    'kanaly-funkcyjne'
                )
        );

    return {
        general:
            frozenGeneral,
        newsChannel:
            frozenNewsChannel,
        textCategory:
            frozenGeneral?.parent ||
            null,
        functionalCategory:
            frozenFunctionalCategory,
    };

    await guild.channels.fetch()
        .catch(() => {});

    const general =
        getChannel?.(
            guild,
            'ogólny'
        ) ||
        findTextChannel(
            guild,
            [
                'ogólny',
                'ogolny',
                'general',
            ]
        );

    let textCategory =
        general?.parent || null;

    if (!textCategory) {
        textCategory =
            await guild.channels.create({
                name:
                    '💬・CZATY TEKSTOWE',
                type:
                    ChannelType.GuildCategory,
            });

        console.log(
            '✅ [OpsV3] utworzono kategorię 💬 CZATY TEKSTOWE'
        );

        if (general) {
            await general.setParent(
                textCategory,
                {
                    lockPermissions:
                        false,
                }
            );
        }
    } else if (
        !textCategory.name.includes(
            '💬'
        )
    ) {
        const clean =
            textCategory.name
                .replace(
                    /^[-–—•・\s]+/,
                    ''
                );

        await textCategory
            .setName(
                `💬・${clean}`.slice(
                    0,
                    100
                )
            )
            .catch(error =>
                console.warn(
                    '[OpsV3] rename text category:',
                    error.message
                )
            );
    }

    let functionalCategory =
        findCategory(
            guild,
            channel =>
                normalize(
                    channel.name
                ).includes(
                    'kanaly-funkcyjne'
                )
        );

    if (!functionalCategory) {
        functionalCategory =
            await guild.channels.create({
                name:
                    '🛠️・KANAŁY FUNKCYJNE',
                type:
                    ChannelType.GuildCategory,
            });

        console.log(
            '✅ [OpsV3] utworzono kategorię 🛠️ KANAŁY FUNKCYJNE'
        );
    }

    let newsChannel =
        findTextChannel(
            guild,
            ['forever-news']
        );

    if (!newsChannel) {
        newsChannel =
            await guild.channels.create({
                name:
                    'forever-news',
                type:
                    ChannelType.GuildText,
                topic:
                    '📰 WoW: Forever • najważniejszy materiał • maks. 1 na godzinę',
            });
    }

    if (
        newsChannel.parentId !==
        textCategory.id
    ) {
        await newsChannel.setParent(
            textCategory,
            {
                lockPermissions:
                    false,
            }
        );

        console.log(
            '✅ [OpsV3] #forever-news przeniesiony do czatów tekstowych'
        );
    }

    await newsChannel
        .setTopic(
            '📰 THE SENTENCED • FOREVER NEWS • maks. 1 ważny materiał na 15 minut'
        )
        .catch(() => {});

    /*
     * Przenosimy tylko znane kanały
     * techniczne/funkcyjne.
     *
     * Nie robimy hurtowego shuffle
     * wszystkich kanałów.
     */
    for (
        const channel
        of guild.channels.cache.values()
    ) {
        if (
            !isTextChannel(channel) ||
            channel.id ===
                newsChannel.id ||
            channel.id ===
                general?.id ||
            !isFunctionalChannel(
                channel.name
            )
        ) {
            continue;
        }

        if (
            channel.parentId ===
            functionalCategory.id
        ) {
            continue;
        }

        await channel.setParent(
            functionalCategory,
            {
                lockPermissions:
                    false,
            }
        ).then(() => {
            console.log(
                `🛠️ [OpsV3] #${channel.name} → KANAŁY FUNKCYJNE`
            );
        }).catch(error => {
            console.warn(
                `⚠️ [OpsV3] move #${channel.name}:`,
                error.message
            );
        });
    }

    if (
        textCategory &&
        functionalCategory
    ) {
        await functionalCategory
            .setPosition(
                textCategory.rawPosition +
                    1
            )
            .catch(() => {});
    }

    return {
        general,
        newsChannel,
        textCategory,
        functionalCategory,
    };
}

/*
|--------------------------------------------------------------------------
| NEWS
|--------------------------------------------------------------------------
*/

async function pollNews(state, layout) {
    if(runtimeDb&&require('./maintenance.cjs').maintenance(runtimeDb))return;
    if (pollRunning) {
        return;
    }

    pollRunning = true;

    try {
        const result =
            await fetchForeverNewsV2();

        const normalized =
            result.items.map(
                item => ({
                    source:
                        item.source,
                    title:
                        cleanTitle(
                            item.title
                        ),
                    url:
                        item.url,
                })
            );

        const current = [];

        for (const item of normalized) {
            if (
                current.some(
                    existing =>
                        existing.url === item.url ||
                        sameStory(
                            existing.title,
                            item.title
                        )
                )
            ) {
                continue;
            }

            current.push(item);
        }

        /*
         * Pierwszy start v3 bez historii:
         * uznajemy bieżące newsy za znane.
         * Nie robimy ściany starych postów.
         */
        if (!state.seen.length) {
            state.seen =
                current.map(
                    item => item.url
                );
            state.seenTitles =
                current.map(
                    item => item.title
                );

            state.lastPollAt =
                new Date()
                    .toISOString();

            saveState(state);

            console.log(
                `📰 [OpsV3] seed news: ${current.length}`
            );

            return;
        }

        const seen =
            new Set(
                state.seen
            );

        const seenTitles =
            Array.isArray(state.seenTitles)
                ? state.seenTitles
                : [];

        const fresh =
            current.filter(
                item =>
                    !seen.has(
                        item.url
                    ) &&
                    !seenTitles.some(
                        title =>
                            sameStory(
                                title,
                                item.title
                            )
                    )
            );

        for (const item of fresh) {
            const score =
                scoreArticle(item);

            if (score >= NEWS_MIN_SCORE) {
                state.pending.push({
                    ...item,
                    score,
                    discoveredAt:
                        new Date()
                            .toISOString(),
                });
            }
        }

        state.pending =
            state.pending
                .filter(
                    (
                        item,
                        index,
                        array
                    ) => {
                        const discoveredAt =
                            Date.parse(
                                item.discoveredAt || ''
                            );

                        if (
                            !Number.isFinite(discoveredAt) ||
                            Date.now() - discoveredAt >
                                NEWS_MAX_AGE_MS
                        ) {
                            return false;
                        }

                        return array.findIndex(
                            x =>
                                x.url === item.url ||
                                sameStory(
                                    x.title,
                                    item.title
                                )
                        ) === index;
                    }
                )
                .slice(-24);

        state.seen = [
            ...new Set([
                ...current.map(
                    item => item.url
                ),
                ...state.seen,
            ]),
        ].slice(0, 1000);

        state.seenTitles = [
            ...current.map(
                item => item.title
            ),
            ...seenTitles,
        ].slice(0, 1000);

        state.lastPollAt =
            new Date()
                .toISOString();

        saveState(state);

        console.log(
            `📰 [OpsV3] poll OK | total=${current.length} | nowe=${fresh.length} | wartościowe=${fresh.filter(item => scoreArticle(item) >= NEWS_MIN_SCORE).length} | kolejka=${state.pending.length}`
        );

        await publishTopNews(
            state,
            layout
        );
    } catch (error) {
        console.error(
            '❌ [OpsV3] news poll:',
            error.stack ||
                error.message ||
                error
        );
    } finally {
        pollRunning = false;
    }
}

async function fetchArticleMeta(url) {
    const controller =
        new AbortController();

    const timeout =
        setTimeout(
            () =>
                controller.abort(),
            10000
        );

    try {
        const response =
            await fetch(
                url,
                {
                    signal:
                        controller.signal,
                    headers: {
                        'user-agent':
                            'Mozilla/5.0 TheSentencedBot/3.0',
                        accept:
                            'text/html,application/xhtml+xml',
                    },
                }
            );

        if (!response.ok) {
            throw new Error(
                `${response.status}`
            );
        }

        const html =
            await response.text();

        const $ =
            cheerio.load(html);

        const description =
            $(
                'meta[property="og:description"]'
            ).attr('content') ||
            $(
                'meta[name="description"]'
            ).attr('content') ||
            '';

        const image =
            $(
                'meta[property="og:image"]'
            ).attr('content') ||
            '';

        return {
            description:
                description
                    .replace(
                        /\s+/g,
                        ' '
                    )
                    .trim(),
            image,
        };
    } catch {
        return {
            description: '',
            image: '',
        };
    } finally {
        clearTimeout(timeout);
    }
}

async function buildArticleEmbed(
    item
) {
    const meta =
        await fetchArticleMeta(
            item.url
        );

    const embed =
        new EmbedBuilder()
            .setTitle(
                cleanTitle(
                    item.title
                ).slice(
                    0,
                    250
                )
            )
            .setURL(
                item.url
            )
            .setColor(
                item.source ===
                    'Wowhead'
                    ? 0xe67e22
                    : 0x3498db
            )
            .setAuthor({
                name:
                    `${sourceIcon(item.source)} ${item.source} • WoW: Forever`,
            })
            .setFooter({
                text:
                    'THE SENTENCED • FOREVER NEWS',
            })
            .setTimestamp();

    if (meta.description) {
        embed.setDescription(
            meta.description
                .slice(
                    0,
                    550
                )
        );
    } else {
        embed.setDescription(
            'Najważniejszy materiał wykryty przez Forever Watcher.'
        );
    }

    if (
        meta.image &&
        /^https?:\/\//i.test(
            meta.image
        )
    ) {
        embed.setImage(
            meta.image
        );
    }

    return embed;
}

async function publishTopNews(
    state,
    layout
) {
    if(runtimeDb&&require('./maintenance.cjs').maintenance(runtimeDb))return false;
    // Preserve the pre-ledger state across upgrades; the durable ledger below
    // provides the atomic guard after a process restart or concurrent poll.
    const lastNewsAt=Date.parse(state.lastNewsPublishedAt || '');
    if(Number.isFinite(lastNewsAt)&&Date.now()-lastNewsAt<PUBLISH_INTERVAL_MS)return false;
    if (!layout?.newsChannel) {
        throw new Error(
            'Brak kanału #forever-news'
        );
    }

    const ranked =
        [...state.pending]
            .filter(
                item =>
                    Number(item.score || 0) >=
                    NEWS_MIN_SCORE
            )
            .sort(
                (a, b) =>
                    Number(b.score || 0) -
                        Number(a.score || 0) ||
                    Date.parse(
                        b.discoveredAt || ''
                    ) -
                        Date.parse(
                            a.discoveredAt || ''
                        )
            );

    const best = ranked[0];

    if (!best) {
        console.log(
            '📰 [OpsV3] brak wartościowego nowego materiału — cisza'
        );
        return false;
    }

    const embed =
        await buildArticleEmbed(
            best
        );

    if(runtimeDb&&require('./maintenance.cjs').maintenance(runtimeDb))return false;
    const effectKey=`news:${createHash('sha256').update(best.url).digest('hex')}`;
    const effect=await deliverOnce(runtimeDb,{key:effectKey,kind:'news',recipient:layout.newsChannel.id,day:DateTime.now().setZone(TZ).toISODate(),minIntervalMs:PUBLISH_INTERVAL_MS},()=>layout.newsChannel.send({
        embeds: [embed],
        allowedMentions: {
            parse: [],
        },
    }));
    if(effect.status==='rate_limited')return false; // Keep pending until the next poll.
    if(effect.status!=='sent')console.warn(`🛡️ News delivery ${effect.status}: ${effectKey}`);

    state.pending =
        state.pending.filter(
            item =>
                item.url !== best.url
        );
    state.lastNewsPublishedAt =
        new Date().toISOString();

    saveState(state);

    console.log(
        effect.status==='sent'?`📰 [OpsV3] opublikowano TOP 1 | score=${best.score} | ${cleanTitle(best.title)}`:`🛡️ [OpsV3] pominięto niepewny/poprzedni efekt publikacji (${effect.status})`
    );

    return effect.status==='sent';
}

async function sendDailyDigest(
    state,
    layout
) {
    if(runtimeDb&&require('./maintenance.cjs').maintenance(runtimeDb))return false;
    const pending =
        [...state.pending];

    const ranked =
        [...pending]
            .sort(
                (a, b) =>
                    b.score -
                    a.score
            );

    const important =
        ranked.filter(
            item =>
                item.score >= 4
        );

    const top =
        (
            important.length
                ? important
                : ranked
        ).slice(
            0,
            3
        );

    const now =
        DateTime.now()
            .setZone(TZ);

    const summary =
        new EmbedBuilder()
            .setTitle(
                '🌙 WoW: Forever • Daily • 21:00'
            )
            .setColor(
                important.length
                    ? 0xf1c40f
                    : 0x2ecc71
            )
            .setFooter({
                text:
                    'The Sentenced • WoW: Forever',
            })
            .setTimestamp();

    if (!pending.length) {
        summary.setDescription(
            '🟢 **Spokojny dzień.**\n\nOd ostatniego podsumowania nie pojawiło się nic nowego w monitorowanych feedach.'
        );
    } else if (
        !important.length
    ) {
        summary.setDescription(
            `📰 **WoW: Forever — nowości • ${pending.length}**\n\nPojawiły się nowe materiały dotyczące **WoW: Forever**. Zebrałem je poniżej, żeby wszystko było w jednym miejscu.`
        );
    } else {
        summary.setDescription(
            `🟡 Wykryłem **${pending.length} nowych materiałów**.\n\n**${important.length}** wygląda na istotne dla WoW: Forever.`
        );
    }

    if (top.length) {
        summary.addFields({
            name:
                '📌 Najciekawsze dziś',
            value:
                top.map(
                    (item, index) =>
                        `**${index + 1}.** ${sourceIcon(item.source)} [${cleanTitle(item.title)}](${item.url})`
                ).join('\n')
                .slice(
                    0,
                    1024
                ),
        });
    }

    summary.addFields({
        name:
            '📡 Monitoring',
        value:
            'WoW: Forever • sprawdzanie co 30 min • podsumowanie codziennie o 21:00',
    });

    const embeds =
        [summary];

    /*
     * Pełne graficzne karty
     * pokazujemy tylko wtedy,
     * gdy naprawdę coś ważnego wyszło.
     */
    for (
        const item
        of important.slice(0, 3)
    ) {
        embeds.push(
            await buildArticleEmbed(
                item
            )
        );
    }

    const buttons =
        top.map(
            (item, index) =>
                new ButtonBuilder()
                    .setStyle(
                        ButtonStyle.Link
                    )
                    .setLabel(
                        `${index + 1} • ${item.source}`.slice(
                            0,
                            80
                        )
                    )
                    .setURL(
                        item.url
                    )
        );

    const components = [];

    if (buttons.length) {
        components.push(
            new ActionRowBuilder()
                .addComponents(
                    ...buttons
                )
        );
    }

    await layout.newsChannel.send({
        embeds,
        components,
        allowedMentions: {
            parse: [],
        },
    });

    /*
     * Najważniejszy news:
     * max raz na 72h na #ogólny.
     */
    const best =
        important[0];

    if (
        best &&
        best.score >= 7 &&
        layout.general &&
        Date.now() -
            Number(
                state.lastGeneralAt ||
                0
            ) >=
            GENERAL_COOLDOWN_MS
    ) {
        const teaser =
            new EmbedBuilder()
                .setTitle(
                    '📣 Warto zerknąć'
                )
                .setDescription(
                    `Na **#forever-news** pojawiła się nowa informacja dotycząca **WoW: Forever**.\n\n**${cleanTitle(best.title)}**\n\nWięcej materiałów i wieczorne podsumowanie znajdziesz na ${layout.newsChannel}.`
                )
                .setURL(
                    best.url
                )
                .setColor(
                    0xf39c12
                )
                .setFooter({
                    text:
                        'Bez @everyone • tylko istotne rzeczy',
                });

        const row =
            new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setStyle(
                            ButtonStyle.Link
                        )
                        .setLabel(
                            'Czytaj'
                        )
                        .setURL(
                            best.url
                        )
                );

        await layout.general.send({
            embeds:
                [teaser],
            components:
                [row],
            allowedMentions: {
                parse: [],
            },
        });

        state.lastGeneralAt =
            Date.now();
    }

    state.pending = [];
    state.lastDailyDate =
        now.toISODate();

    saveState(state);

    console.log(
        `🌙 [OpsV3] Daily wysłany | nowe=${pending.length} | ważne=${important.length}`
    );
}

/*
|--------------------------------------------------------------------------
| WELCOME CATCH-UP
|--------------------------------------------------------------------------
*/

async function catchUpMissedWelcomes({
    guild,
    db,
    sendPersonalizedWelcome,
}) {
    if(require('./maintenance.cjs').maintenance(db))return;
    // Main startup cache/events own member discovery; no second full fetch.
    require('./guild-notifications').ensureSchema(db);

    const rows =
        db.prepare(`
            SELECT
                user_id,
                game_nick,
                display_name,
                onboarding_status,
                approved_at,
                welcomed_at,
                left_at
            FROM members
            WHERE welcomed_at IS NULL
        `).all();

    let sent = 0;

    for (const row of rows) {
        let member;

        try {
            member =
                guild.members.cache.get(
                    row.user_id
                ) ||
                await guild.members.fetch(
                    row.user_id
                );
        } catch {
            continue;
        }

        if (
            !member ||
            member.user.bot
        ) {
            continue;
        }

        const eligible = process.env.TS_ONBOARDING_V6_ENABLED === 'true'
            ? (row.onboarding_status === 'approved' && !!row.approved_at)
            : (row.onboarding_status === 'approved' || memberHasNormalRole(member));

        if (!eligible) {
            continue;
        }

        try {
            // The member lookup above can yield while maintenance is enabled.
            if(require('./maintenance.cjs').maintenance(db))return sent;
            const didSend =
                await sendPersonalizedWelcome(
                    guild,
                    member
                );

            if (didSend) {
                sent += 1;

                console.log(
                    `👋 [OpsV3] catch-up welcome: ${member.user.tag}`
                );
            }
        } catch (error) {
            console.error(
                `❌ [OpsV3] welcome ${member.id}:`,
                error.message
            );
        }
    }

    console.log(
        `👋 [OpsV3] catch-up zakończony | wysłano=${sent}`
    );

    return sent;
}

/*
|--------------------------------------------------------------------------
| PRIVATE PROFILE REMINDERS
|--------------------------------------------------------------------------
*/

function isMissing(value) {
    if (
        value === null ||
        value === undefined
    ) {
        return true;
    }

    const text =
        String(value)
            .trim();

    return (
        !text ||
        text === '[]' ||
        text === '{}'
    );
}

async function sendProfileReminders({
    guild,
    db,
    state,
}) {
    if(require('./maintenance.cjs').maintenance(db))return;
    await guild.members.fetch()
        .catch(() => {});

    const rows =
        db.prepare(`
            SELECT
                user_id,
                display_name,
                onboarding_status,
                welcomed_at,
                left_at,
                game_nick,
                plans_forever,
                wow_class,
                wow_role,
                interests,
                played_before_ts
            FROM members
            WHERE
                left_at IS NULL
                OR left_at = 0
        `).all();

    const due = [];

    for (const row of rows) {
        let member;

        try {
            member =
                guild.members.cache.get(
                    row.user_id
                ) ||
                await guild.members.fetch(
                    row.user_id
                );
        } catch {
            continue;
        }

        if (
            !member ||
            member.user.bot ||
            !memberHasNormalRole(
                member
            )
        ) {
            continue;
        }

        if(!db.prepare('SELECT notify_profile FROM member_preferences WHERE user_id=?').get(row.user_id)?.notify_profile)continue;
        const missing = missingProfileFields(row).length;

        if (!missing) {
            continue;
        }

        const last =
            Number(
                state
                    .profileReminders?.[
                        row.user_id
                    ] ||
                0
            );

        if (
            Date.now() -
                last <
            PROFILE_COOLDOWN_MS
        ) {
            continue;
        }

        due.push({
            row,
            member,
            missing,
        });
    }

    /*
     * Maksymalnie 3 DM-y
     * podczas jednego Daily.
     */
    // A candidate may be ineligible under the durable 14-day guard.
    // Continue to later candidates; the ledger enforces the daily cap.
    const selected = due;

    let sent = 0;

    for (const selectedItem of selected) {
        let {row, member, missing} = selectedItem;
        // A previous DM can yield while this player revokes consent or leaves.
        try {
            const currentDay=DateTime.now().setZone(TZ).toISODate();
            if (db.prepare('SELECT count(*) n FROM delivery_effects WHERE kind=? AND day=?').get('profile_reminder',currentDay).n >= 3) break;
            member = await guild.members.fetch({user:row.user_id,force:true});
            row = db.prepare('SELECT * FROM members WHERE user_id=? AND (left_at IS NULL OR left_at=0)').get(row.user_id);
            if (!row || !member || member.user?.bot || !memberHasNormalRole(member) ||
                db.prepare('SELECT notify_profile FROM member_preferences WHERE user_id=?').get(row.user_id)?.notify_profile !== 1) continue;
            missing = missingProfileFields(row).length;
            if (!missing) continue;
        } catch (error) {
            console.warn('[OpsV3] profile reminder eligibility unavailable:', error.message);
            continue;
        }
        const embed =
            new EmbedBuilder()
                .setTitle(
                    '📝 Małe przypomnienie od The Sentenced'
                )
                .setColor(
                    0x5865f2
                )
                .setDescription(
                    `Hej ${member.displayName}! 👋\n\nTwój profil gildyjny nie jest jeszcze kompletny (**${missing} brakujące pola**).\n\nNie ma pośpiechu — przy okazji wejdź na serwer i użyj **/bot → Profil**, żeby go uzupełnić. Dzięki temu łatwiej będzie ogarniać skład, role i wspólne granie.`
                )
                .setFooter({
                    text:
                        'To prywatne przypomnienie • maks. raz na 14 dni',
                });

        try {
            const day=DateTime.now().setZone(TZ).toISODate();
            if(require('./maintenance.cjs').maintenance(db))return;
            const effect=await deliverOnce(db,{key:`profile:${day}:${row.user_id}`,kind:'profile_reminder',recipient:row.user_id,day,limit:3,userLimit:1,minRecipientIntervalMs:PROFILE_COOLDOWN_MS},()=>{
                const current=db.prepare('SELECT * FROM members WHERE user_id=? AND (left_at IS NULL OR left_at=0)').get(row.user_id);
                const consent=db.prepare('SELECT notify_profile FROM member_preferences WHERE user_id=?').get(row.user_id)?.notify_profile;
                const currentMember=guild.members.cache.get(row.user_id);
                if(require('./maintenance.cjs').maintenance(db)||!current||consent!==1||!currentMember||currentMember.user?.bot||!memberHasNormalRole(currentMember)||!missingProfileFields(current).length){
                    const error=Error('Profile reminder no longer eligible');error.code='NOT_ELIGIBLE';throw error;
                }
                return currentMember.send({embeds:[embed],allowedMentions:{parse:[]}});
            });
            if(effect.status!=='sent')continue;

            state.profileReminders[
                row.user_id
            ] =
                Date.now();

            sent += 1;

            console.log(
                `📝 [OpsV3] profile DM: ${member.user.tag}`
            );
        } catch (error) {
            console.log(
                `ℹ️ [OpsV3] DM niedostępny: ${member.user.tag}`
            );
        }
    }

    saveState(state);

    console.log(
        `📝 [OpsV3] profile reminders | wysłano=${sent} | oczekuje=${due.length}`
    );

    return sent;
}

/*
|--------------------------------------------------------------------------
| DAILY 21:00
|--------------------------------------------------------------------------
*/

async function runDaily(
    context,
    state
) {
    if(require('./maintenance.cjs').maintenance(context.db))return;
    if (dailyRunning) {
        return;
    }

    dailyRunning = true;

    try {
        const now =
            DateTime.now()
                .setZone(TZ);

        console.log(
            `🌙 [OpsV3] DAILY START ${now.toFormat('yyyy-LL-dd HH:mm:ss')}`
        );

        try {
            if (context.manageLayout) await ensureLayout(context.guild, context.getChannel);
        } catch (error) {
            console.error(
                '❌ [OpsV3] layout:',
                error.stack ||
                    error.message
            );
        }

        try {
            await catchUpMissedWelcomes({
                guild:
                    context.guild,
                db:
                    context.db,
                sendPersonalizedWelcome:
                    context
                        .sendPersonalizedWelcome,
            });
        } catch (error) {
            console.error(
                '❌ [OpsV3] welcome catch-up:',
                error.stack ||
                    error.message
            );
        }

        try {
            await context
                .refreshGuildStateNow(
                    context.guild
                );

            console.log(
                '✅ [OpsV3] Guild State 21:00 refreshed'
            );
        } catch (error) {
            console.error(
                '❌ [OpsV3] Guild State daily:',
                error.message
            );
        }

        try {
            await sendProfileReminders({
                guild:
                    context.guild,
                db:
                    context.db,
                state,
            });
        } catch (error) {
            console.error(
                '❌ [OpsV3] profile reminders:',
                error.stack ||
                    error.message
            );
        }

        /*
         * Daily pozostaje oknem housekeeping.
         * Newsy mają osobny godzinny pipeline
         * i nie są już publikowane zbiorczo.
         */
        if (
            state.lastDailyDate !==
            now.toISODate()
        ) {
            state.lastDailyDate =
                now.toISODate();

            saveState(state);
        }

        console.log(
            '🌙 [OpsV3] DAILY END'
        );
    } finally {
        dailyRunning = false;
    }
}

async function dailyTick(
    context,
    state
) {
    if(require('./maintenance.cjs').maintenance(context.db))return;
    const now =
        DateTime.now()
            .setZone(TZ);

    const today =
        now.toISODate();

    /*
     * 21:00 jest normalną porą.
     *
     * Jeśli bot był wyłączony o 21:00,
     * po późniejszym restarcie wykona
     * brakujący Daily tego samego dnia.
     */
    if (
        now.hour >= 21 &&
        state.lastDailyDate !==
            today
    ) {
        await runDaily(
            context,
            state
        );
    }
}

/*
|--------------------------------------------------------------------------
| START
|--------------------------------------------------------------------------
*/

async function startGuildOpsV3(
    context
) {
    if (started) {
        return;
    }

    started = true;
    runtimeDb = context.db;

    const state =
        loadState();

    seedOldSeen(
        state
    );

    console.log('');
    console.log(
        '✅ Guild Operations v3 online'
    );
    console.log(
        '   📡 news: kontrola co 10 min, maks. 1 materiał na 15 min'
    );
    console.log(
        '   🌙 Daily housekeeping: 21:00 Europe/Warsaw'
    );
    console.log(
        '   👋 missed welcome reconciliation: 21:00'
    );
    console.log(
        '   📝 private profile reminders: max 3/day, 14d/user'
    );
    /*
     * Układ Discorda możemy poprawić
     * natychmiast — bez czekania do 21.
     */
    const currentLayout = () => ({
        general: context.getChannel?.(context.guild, 'ogólny'),
        newsChannel: findTextChannel(context.guild, ['forever-news']),
    });
    let layout;

    try {
        layout = context.manageLayout ? await ensureLayout(context.guild, context.getChannel) : currentLayout();
    } catch (error) {
        console.error(
            '❌ [OpsV3] startup layout:',
            error.stack ||
                error.message
        );

        layout = currentLayout();
    }

    /*
     * Poll jest cichy.
     */
    await pollNews(
        state,
        layout
    );

    const pollTimer =
        setInterval(
            () =>
                pollNews(
                    state,
                    layout
                ),
            POLL_MS
        );

    const dailyTimer =
        setInterval(
            () =>
                dailyTick(
                    context,
                    state
                ).catch(
                    console.error
                ),
            30 * 1000
        );

    pollTimer.unref?.();
    dailyTimer.unref?.();

    /*
     * Jeżeli wdrożenie robimy po 21,
     * Daily odpali od razu.
     */
    await dailyTick(
        context,
        state
    );
}

module.exports = {
    startGuildOpsV3,
};
