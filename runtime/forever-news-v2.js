'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { ChannelType } = require('discord.js');

const ICY_URL = 'https://www.icy-veins.com/wow-forever/';
const WOWHEAD_URL = 'https://www.wowhead.com/forever/news';
const WOWHEAD_RSS = 'https://www.wowhead.com/news/rss/all';

const CHECK_INTERVAL = 30 * 60 * 1000;
const STATE_FILE = path.join(__dirname, 'data', 'forever-news-v2.json');

let started = false;
let icyBackoffUntil = 0;
const {backoffFor} = require('./news/policy.cjs');

function unique(items) {
    const seen = new Set();

    return items.filter(item => {
        if (!item.url || seen.has(item.url)) return false;
        seen.add(item.url);
        return true;
    });
}

async function fetchText(url, accept = 'text/html,application/xhtml+xml') {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                'user-agent':
                    'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 Chrome/151 Safari/537.36 SentencedBot/1.0',
                'accept': accept,
                'accept-language': 'en-US,en;q=0.9'
            }
        });

        if (!response.ok) {
            throw new Error(`${response.status} ${response.statusText}`);
        }

        return await response.text();
    } finally {
        clearTimeout(timeout);
    }
}

async function fetchIcyVeins() {
    const html = await fetchText(ICY_URL);
    const $ = cheerio.load(html);

    const items = [];

    $('a[href*="/wow-forever/news/"]').each((_, element) => {
        const href = $(element).attr('href');
        const title = $(element).text().replace(/\s+/g, ' ').trim();

        if (!href || !title || title.length < 5) return;
        if (/view all/i.test(title)) return;

        try {
            const url = new URL(href, 'https://www.icy-veins.com');
            url.search = '';
            url.hash = '';

            items.push({
                source: 'Icy Veins',
                title,
                url: url.toString()
            });
        } catch {}
    });

    const result = unique(items).slice(0, 30);

    if (!result.length) {
        throw new Error('Icy Veins: nie znaleziono newsów Forever');
    }

    return result;
}

function parseWowheadHtml(html) {
    const $ = cheerio.load(html);
    const items = [];

    $('a[href*="/news/"]').each((_, element) => {
        const href = $(element).attr('href');
        const title = $(element).text().replace(/\s+/g, ' ').trim();

        if (!href || !title || title.length < 5) return;

        try {
            const url = new URL(href, 'https://www.wowhead.com');

            if (!/\/(?:forever\/)?news\/[^/?#]+-\d+/i.test(url.pathname)) {
                return;
            }

            url.search = '';
            url.hash = '';

            items.push({
                source: 'Wowhead',
                title,
                url: url.toString()
            });
        } catch {}
    });

    return unique(items).slice(0, 30);
}

function parseWowheadRss(xml) {
    const $ = cheerio.load(xml, { xmlMode: true });
    const items = [];

    $('item').each((_, element) => {
        const title = $(element).find('title').first().text().trim();
        const link = $(element).find('link').first().text().trim();
        const description = $(element).find('description').first().text();

        if (!title || !link) return;

        if (!/forever/i.test(`${title} ${link} ${description}`)) {
            return;
        }

        items.push({
            source: 'Wowhead',
            title,
            url: link
        });
    });

    return unique(items).slice(0, 30);
}

async function fetchWowhead() {
    const errors = [];

    try {
        const html = await fetchText(WOWHEAD_URL);
        const items = parseWowheadHtml(html);

        if (items.length) {
            return items;
        }

        errors.push('HTML: brak artykułów');
    } catch (error) {
        errors.push(`HTML: ${error.message}`);
    }

    try {
        const xml = await fetchText(
            WOWHEAD_RSS,
            'application/rss+xml,application/xml,text/xml,*/*'
        );

        const items = parseWowheadRss(xml);

        if (items.length) {
            return items;
        }

        errors.push('RSS: brak artykułów Forever');
    } catch (error) {
        errors.push(`RSS: ${error.message}`);
    }

    throw new Error(`Wowhead: ${errors.join(' | ')}`);
}

async function fetchForeverNewsV2() {
    const results = await Promise.allSettled([
        Date.now() >= icyBackoffUntil ? fetchIcyVeins() : Promise.resolve([]),
        fetchWowhead()
    ]);

    const items = [];
    const errors = [];

    for (const [index, result] of results.entries()) {
        if (index === 0 && result.status === 'rejected') icyBackoffUntil = Date.now() + backoffFor(result.reason);
        if (result.status === 'fulfilled') {
            items.push(...result.value);
        } else {
            errors.push(result.reason?.message || String(result.reason));
        }
    }

    const clean = unique(items);

    if (!clean.length) {
        throw new Error(errors.join(' | ') || 'Brak newsów');
    }

    return {
        items: clean,
        errors
    };
}

function loadState() {
    try {
        return {
            initialized: false,
            seen: [],
            count: 0,
            lastCheck: null,
            lastError: null,
            ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
        };
    } catch {
        return {
            initialized: false,
            seen: [],
            count: 0,
            lastCheck: null,
            lastError: null
        };
    }
}

function saveState(state) {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });

    const tmp = `${STATE_FILE}.tmp`;

    fs.writeFileSync(
        tmp,
        JSON.stringify(state, null, 2),
        'utf8'
    );

    fs.renameSync(tmp, STATE_FILE);
}

async function ensureChannel(guild) {
    await guild.channels.fetch().catch(() => {});

    const configuredId = process.env.FOREVER_NEWS_CHANNEL_ID;

    if (configuredId) {
        const configured = guild.channels.cache.get(configuredId);

        if (configured?.isTextBased()) {
            return configured;
        }
    }

    let channel = guild.channels.cache.find(
        c => c?.isTextBased?.() && c.name === 'forever-news'
    );

    if (channel) {
        return channel;
    }

    try {
        channel = await guild.channels.create({
            name: 'forever-news',
            type: ChannelType.GuildText,
            topic: 'Automatyczny feed WoW: Forever — Icy Veins + Wowhead'
        });

        console.log(`✅ [ForeverNewsV2] utworzono #${channel.name}`);

        return channel;
    } catch (error) {
        console.warn(
            `⚠️ [ForeverNewsV2] nie udało się utworzyć #forever-news: ${error.message}`
        );
    }

    channel = guild.channels.cache.find(
        c =>
            c?.isTextBased?.() &&
            ['ogłoszenia-bota', 'ogloszenia-bota'].includes(c.name)
    );

    if (channel) {
        console.log(
            `ℹ️ [ForeverNewsV2] używam istniejącego #${channel.name}`
        );

        return channel;
    }

    throw new Error(
        'Brak #forever-news i brak #ogłoszenia-bota'
    );
}

async function postArticle(channel, item) {
    const title = item.title.slice(0, 500);

    await channel.send({
        content:
            `📰 **${item.source} — WoW: Forever**\n` +
            `**${title}**\n` +
            `${item.url}`,
        allowedMentions: {
            parse: []
        }
    });
}

async function checkForeverNews(guild) {
    const state = loadState();

    state.lastCheck = new Date().toISOString();

    try {
        const { items, errors } = await fetchForeverNewsV2();
        const channel = await ensureChannel(guild);

        const oldSeen = new Set(state.seen || []);

        if (!state.initialized) {
            await channel.send({
                content:
                    '✅ **Forever News Watcher v2 online**\n' +
                    'Źródła: Icy Veins + Wowhead Forever\n' +
                    'Sprawdzanie: co 30 minut.',
                allowedMentions: {
                    parse: []
                }
            });

            for (const source of ['Icy Veins', 'Wowhead']) {
                const bootstrap = items
                    .filter(item => item.source === source)
                    .slice(0, 2)
                    .reverse();

                for (const item of bootstrap) {
                    await postArticle(channel, item);
                    state.count += 1;
                }
            }

            state.initialized = true;
        } else {
            const fresh = items
                .filter(item => !oldSeen.has(item.url))
                .slice(0, 10)
                .reverse();

            for (const item of fresh) {
                await postArticle(channel, item);
                state.count += 1;
            }

            if (fresh.length) {
                console.log(
                    `📰 [ForeverNewsV2] opublikowano ${fresh.length} nowych newsów`
                );
            }
        }

        state.seen = [
            ...new Set([
                ...items.map(item => item.url),
                ...(state.seen || [])
            ])
        ].slice(0, 500);

        state.lastError = errors.length
            ? errors.join(' | ')
            : null;

        saveState(state);

        console.log(
            `✅ [ForeverNewsV2] check OK | news=${items.length}` +
            (errors.length ? ` | warnings=${errors.join(' | ')}` : '')
        );
    } catch (error) {
        state.lastError = error.message;
        saveState(state);

        console.error(
            `❌ [ForeverNewsV2] ${error.stack || error.message}`
        );
    }
}

async function startForeverNewsV2({ guild }) {
    if (started) return;
    started = true;

    console.log(
        '✅ Forever News Watcher v2 online — Icy Veins + Wowhead / 30 min'
    );

    await checkForeverNews(guild);

    const timer = setInterval(
        () => checkForeverNews(guild),
        CHECK_INTERVAL
    );

    if (typeof timer.unref === 'function') {
        timer.unref();
    }
}

module.exports = {
    startForeverNewsV2,
    fetchForeverNewsV2
};
