'use strict';

const GUILD_ID = '1549146537802600568';

// Stable logical names used in the bot. A Discord rename only changes display text.
const CHANNEL_IDS = Object.freeze({
    'regulamin': '1573040361251672064',
    'start': '1549398541149933683',
    'poczekalnia': '1549398553313677355',
    'oficerka': '1549398574528339968',
    'ogólny': '1549398546896388276',
    'offtop': '1549398548494422086',
    'ogłoszenia-bota': '1549398543360462868',
    'stan-gildii': '1549398573009862727',
    'historia-gildii': '1553470706514395319',
    'czat-wow': '1568577268056596540',
    'forever-news': '1551660125935243426',
    'addony': '1568654994054451413',
    'opowiedz_cos_o_sobie': '1573062971100364942',
    'materiały-promocyjne': '1574150899331244066',
    'wybory': '1574129359604813844',
    'raid-ogłoszenia': '1574411709819523132',
    'kalendarz': '1549398556723384350',
    'zapisy': '1549398558380269649',
    'wyprawy': '1550939366698782811',
});

const CLASS_CHANNELS = Object.freeze([
    ['Druid', '1575532785962065950'],
    ['Czarnoksiężnik', '1575532799115399318'],
    ['Kapłan', '1575532794891997426'],
    ['Łotrzyk', '1575532796280049786'],
    ['Łowca', '1575532787476471909'],
    ['Mag', '1575532789036622024'],
    ['Paladyn', '1575532790433321034'],
    ['Szaman', '1575532797777412156'],
    ['Wojownik', '1575532800843583488'],
]);

function channelId(guild, key) {
    return guild.id === GUILD_ID && Object.hasOwn(CHANNEL_IDS, key) ? CHANNEL_IDS[key] : undefined;
}

const STAFF_POST_CHANNELS = Object.freeze({
    general: 'ogólny',
    calendar: 'kalendarz',
    expeditions: 'wyprawy',
    addons: 'addony',
});

module.exports = {CHANNEL_IDS, CLASS_CHANNELS, STAFF_POST_CHANNELS, channelId};
