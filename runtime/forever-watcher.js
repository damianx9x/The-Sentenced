const cheerio =
    require('cheerio');

const {
    EmbedBuilder,
} = require('discord.js');

const NEWS_URL =
    'https://worldofwarcraft.blizzard.com/en-us/news/';

const ORIGIN =
    'https://worldofwarcraft.blizzard.com';

const FOREVER_MILESTONES = {
    beta:
        '17 września 2026',

    launch:
        '4 listopada 2026',

    raids:
        '9 grudnia 2026',
};

function ensureSchema(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS forever_news (
            url TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            first_seen_at INTEGER NOT NULL,
            announced_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS forever_meta (
            key TEXT PRIMARY KEY,
            value TEXT
        );
    `);
}

function setMeta(
    db,
    key,
    value
) {
    db.prepare(`
        INSERT INTO forever_meta (
            key,
            value
        )

        VALUES (?, ?)

        ON CONFLICT(key)
        DO UPDATE SET
            value =
                excluded.value
    `).run(
        key,
        String(value)
    );
}

function getMeta(
    db,
    key
) {
    return (
        db.prepare(`
            SELECT value
            FROM forever_meta
            WHERE key = ?
        `).get(key)?.value ||
        null
    );
}

function clean(text) {
    return String(
        text || ''
    )
        .replace(
            /\s+/g,
            ' '
        )
        .trim();
}

function normalizeUrl(href) {
    if (!href) {
        return null;
    }

    try {
        const url =
            new URL(
                href,
                ORIGIN
            );

        url.hash = '';
        url.search = '';

        return url.toString();

    } catch (_) {
        return null;
    }
}

async function fetchForeverNews() {
    const response =
        await fetch(
            NEWS_URL,
            {
                headers: {
                    'user-agent':
                        'Mozilla/5.0 SentencedBot/0.7',
                    'accept':
                        'text/html,application/xhtml+xml',
                },
                signal: AbortSignal.timeout(15000),
            }
        );

    if (!response.ok) {
        throw new Error(
            `Blizzard HTTP ${response.status}`
        );
    }

    const html =
        await response.text();

    const $ =
        cheerio.load(
            html
        );

    const items =
        new Map();

    $('a[href]').each(
        (_, element) => {
            const href =
                $(element)
                    .attr('href');

            const url =
                normalizeUrl(
                    href
                );

            if (!url) {
                return;
            }

            if (
                !/\/news\/\d+/i.test(
                    url
                )
            ) {
                return;
            }

            let title =
                clean(
                    $(element).find('h2,h3,h4').first().text() || $(element).attr('aria-label') || $(element).text()
                );

            if (!title) {
                title =
                    clean(
                        $(element)
                            .attr(
                                'aria-label'
                            )
                    );
            }

            const context =
                clean(
                    $(element)
                        .parent()
                        .text()
                );

            const combined =
                `${title} ${context} ${url}`;

            if (
                !/world of warcraft:\s*forever|warcraft:\s*forever|\/forever/i.test(
                    combined
                )
            ) {
                return;
            }

            if (
                title.length < 5
            ) {
                title =
                    context;
            }

            if (
                title.length > 180
            ) {
                title =
                    title.slice(
                        0,
                        180
                    );
            }

            if (!title) {
                title =
                    'World of Warcraft: Forever';
            }

            const existing =
                items.get(
                    url
                );

            if (!existing || title.length < existing.title.length) {
                items.set(
                    url,
                    {
                        title,
                        url,
                    }
                );
            }
        }
    );

    return Array.from(
        items.values()
    );
}

async function checkForeverNews({
    db,
    guild,
    getChannel,
}) {
    if(require('./maintenance.cjs').maintenance(db))return;
    ensureSchema(db);

    try {
        const items =
            await fetchForeverNews();

        setMeta(
            db,
            'last_check',
            Date.now()
        );

        setMeta(
            db,
            'last_error',
            ''
        );

        if (!items.length) {
            throw new Error(
                'Brak artykułów Forever na stronie Blizzard.'
            );
        }

        const existingCount =
            db.prepare(`
                SELECT COUNT(*) AS c
                FROM forever_news
            `).get().c;

        /*
         * Pierwsze uruchomienie:
         * zapisujemy aktualny stan jako bazę,
         * bez zalewania kanału starymi newsami.
         */
        if (
            existingCount === 0
        ) {
            const insert =
                db.prepare(`
                    INSERT OR IGNORE INTO forever_news (
                        url,
                        title,
                        first_seen_at,
                        announced_at
                    )

                    VALUES (?, ?, ?, ?)
                `);

            for (
                const article of items
            ) {
                insert.run(
                    article.url,
                    article.title,
                    Date.now(),
                    Date.now()
                );
            }

            console.log(
                `✅ Forever Watcher baseline: ${items.length}`
            );

            return;
        }

        const channel =
            getChannel(
                guild,
                'ogłoszenia-bota'
            );

        const insert =
            db.prepare(`
                INSERT OR IGNORE INTO forever_news (
                    url,
                    title,
                    first_seen_at,
                    announced_at
                )

                VALUES (?, ?, ?, NULL)
            `);

        const mark =
            db.prepare(`
                UPDATE forever_news
                SET announced_at = ?
                WHERE url = ?
            `);

        for (
            const article of
            [...items].reverse()
        ) {
            const result =
                insert.run(
                    article.url,
                    article.title,
                    Date.now()
                );

            if (db.prepare('SELECT announced_at FROM forever_news WHERE url=?').get(article.url)?.announced_at) {
                continue;
            }

            if (channel) {
                const embed =
                    new EmbedBuilder()
                        .setColor(0x8B1E1E)
                        .setTitle(article.title.slice(0,256))

                        .setDescription(
                            `${polishNewsSummary(article.title)}\n\n[Przeczytaj u źródła](${article.url})`
                        )

                        .setURL(
                            article.url
                        )

                        .addFields({
                            name:
                                'Źródło',
                            value:
                                'Blizzard Entertainment',
                        })

                        .setFooter({
                            text:
                                'THE SENTENCED • Wieści z Azeroth • v1.2.0',
                        })

                        .setTimestamp();

                if(require('./maintenance.cjs').maintenance(db))return;
                await channel.send({
                    embeds: [
                        embed
                    ],
                });
            }

            if (channel) mark.run(
                Date.now(),
                article.url
            );

            console.log(
                `🌍 Forever news: ${article.title}`
            );
        }

    } catch (error) {
        setMeta(
            db,
            'last_check',
            Date.now()
        );

        setMeta(
            db,
            'last_error',
            error.message
        );

        console.error(
            'Forever Watcher:',
            error.message
        );
    }
}

function getForeverStatus(db) {
    ensureSchema(db);

    const count =
        db.prepare(`
            SELECT COUNT(*) AS c
            FROM forever_news
        `).get().c;

    return {
        count,

        lastCheck:
            getMeta(
                db,
                'last_check'
            ),

        lastError:
            getMeta(
                db,
                'last_error'
            ),
    };
}

function startForeverWatcher({
    db,
    guild,
    getChannel,
}) {
    ensureSchema(db);

    console.log(
        '✅ Forever Watcher online'
    );

    let running = false;

    const run = async () => {
        if (running) {
            console.log(
                '⏭️ Forever Watcher: poprzednie sprawdzenie nadal trwa'
            );

            return;
        }

        running = true;

        try {
            await checkForeverNews({
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

            60 * 60 * 1000
        );

    return timer;
}

module.exports = {
    startForeverWatcher,
    fetchForeverNews,
    getForeverStatus,
    FOREVER_MILESTONES,
};

function polishNewsSummary(title) {
    if (/gpu|requirements/i.test(title)) return 'Blizzard opublikował informacje o wymaganiach sprzętowych WoW Forever. Sprawdź wymagania przed wyprawą do Azeroth.';
    if (/beta/i.test(title)) return 'Nowa wiadomość Blizzarda dotycząca testów WoW Forever. Szczegóły dostępu i zmian znajdują się w artykule.';
    if (/raid|dungeon/i.test(title)) return 'Wieści o zawartości PvE w WoW Forever. Szczegóły przydadzą się przy planowaniu gildyjnych wypraw.';
    return 'Nowa publikacja Blizzarda dotycząca World of Warcraft: Forever. Poniżej znajdziesz oryginalne informacje od twórców.';
}
