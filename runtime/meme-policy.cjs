'use strict';
// Community provenance + title signals + guild feedback. Humor is subjective, never a guaranteed score.
const THEMES=[['healer',/\b(heal(?:er|ing)?|priest|mana|rez|resurrect)\b/i],['tank',/\b(tank|aggro|threat|taunt)\b/i],['loot',/\b(loot|ninja|roll|need|greed|drop|gear|dkp|bis)\b/i],['raid',/\b(raid|boss|wipe|dungeon|pull|dps|parse|damage|party|pug)\b/i],['pvp',/\b(pvp|gank|arena|battleground|honor|horde|alliance|orc|tauren|undead)\b/i],['quest',/\b(quest|level(?:ing)?|grind|alt|mount|flight|travel|portal|corpse)\b/i],['economy',/\b(gold|auction|ah|craft|profession|bank|repair|enchant)\b/i],['warcraft',/\b(wow|warcraft|azeroth|thrall|sylvanas|stormwind|orgrimmar|classic|forever|paladin|mage|warlock|rogue|hunter|druid|shaman|warrior)\b/i]];
function classify(title){const text=String(title||'');const matched=THEMES.filter(([,re])=>re.test(text)).map(([name])=>name);return {theme:matched[0]||null,signals:matched.length}}
function rankMemes(candidates,{lastThemes=[],feedback={}}={}){
 return candidates.map(m=>{const theme=classify(m.title);const votes=feedback[theme.theme]||{up:0,down:0};const score=theme.signals*12+(m.top_period==='week'?35:m.top_period==='month'?20:0)+Math.max(0,25-(m.top_rank||999))+Math.min(20,Math.log2(Math.max(1,m.ups||0)))+Math.min(15,votes.up*3)-Math.min(35,votes.down*7)-(lastThemes.includes(theme.theme)?18:0);return {...m,theme:theme.theme,selectionScore:score}}).filter(m=>m.theme).sort((a,b)=>b.selectionScore-a.selectionScore||a.id-b.id);
}
module.exports={classify,rankMemes};
