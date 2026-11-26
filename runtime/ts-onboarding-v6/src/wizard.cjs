'use strict';
/** Data-only wizard specification for existing discord.js 14 handlers. No network or writes. */
const STEPS=Object.freeze({BRANCH:'BRANCH',OLD_NICK:'OLD_NICK',FIRST_NAME:'FIRST_NAME',AGE:'AGE',CLASS:'CLASS',RACE:'RACE',SPEC:'SPEC',PROFESSIONS:'PROFESSIONS',STYLE:'STYLE',RAID:'RAID',HOURS:'HOURS',DAYS:'DAYS',ABOUT:'ABOUT',REVIEW:'REVIEW'});
const PLAYSTYLES=Object.freeze(['Casual','Raidowanie','PvP']);
const DAYS=Object.freeze(['pon','wt','sr','czw','pt','sob','nd']);
const labels=Object.freeze({pon:'Poniedziałek',wt:'Wtorek',sr:'Środa',czw:'Czwartek',pt:'Piątek',sob:'Sobota',nd:'Niedziela'});
function nextStep(step,draft={}) {
 const seq= draft.wasMember==='TAK'?[STEPS.BRANCH,STEPS.OLD_NICK,STEPS.REVIEW]:
 [STEPS.BRANCH,STEPS.FIRST_NAME,STEPS.AGE,STEPS.CLASS,STEPS.RACE,STEPS.SPEC,STEPS.PROFESSIONS,STEPS.STYLE,STEPS.RAID,
  ...(draft.raidPlan===true?[STEPS.HOURS,STEPS.DAYS]:[]),STEPS.ABOUT,STEPS.REVIEW];
 if (step===STEPS.BRANCH && !['TAK','NIE'].includes(draft.wasMember)) return STEPS.BRANCH;
 if(step===STEPS.RAID && ![true,false].includes(draft.raidPlan))return STEPS.RAID;
 const n=seq.indexOf(step);return n<0?STEPS.BRANCH:seq[Math.min(seq.length-1,n+1)];
}
const views={
 [STEPS.BRANCH]:{type:'buttons',label:'Czy jesteś starym członkiem The Sentenced?',options:[{label:'TAK',value:'TAK'},{label:'NIE',value:'NIE'}]},
 [STEPS.OLD_NICK]:{type:'text',label:'Jaki był Twój dawny nick?',maxLength:60},
 [STEPS.FIRST_NAME]:{type:'text',label:'Jak masz na imię?',maxLength:80},
 [STEPS.AGE]:{type:'number',label:'Ile masz lat?',min:1,max:120},
 [STEPS.CLASS]:{type:'select',label:'Jaka klasa?',options:['Warrior','Paladin','Hunter','Rogue','Priest','Shaman','Mage','Warlock','Druid']},
 [STEPS.RACE]:{type:'text',label:'Jaką grasz rasą?',maxLength:80},
 [STEPS.SPEC]:{type:'text',label:'Jaka specjalizacja?',maxLength:80},
 [STEPS.PROFESSIONS]:{type:'text',label:'Jakie profesje?',maxLength:200},
 [STEPS.STYLE]:{type:'multi-select',label:'Jaki styl gry preferujesz?',options:PLAYSTYLES,min:1,max:3},
 [STEPS.RAID]:{type:'buttons',label:'Czy planujesz raidować?',options:[{label:'Tak',value:true},{label:'Nie',value:false}]},
 [STEPS.HOURS]:{type:'number',label:'Ile godzin w tygodniu możesz raidować?',min:0.5,max:168},
 [STEPS.DAYS]:{type:'multi-select',label:'Jakie dni najbardziej Ci pasują?',options:DAYS.map(d=>({label:labels[d],value:d})),min:1,max:7},
 [STEPS.ABOUT]:{type:'paragraph',label:'Napisz coś o sobie, żebyśmy mogli Cię lepiej poznać',maxLength:1200},
 [STEPS.REVIEW]:{type:'review',label:'Sprawdź i wyślij wniosek do kadry'}
};
function view(step){if(!views[step])throw Error('UNKNOWN_WIZARD_STEP');return JSON.parse(JSON.stringify(views[step]));}
/** Escape all mentions for staff previews. Never enable allowedMentions for applicant fields. */
function safeText(s){if(typeof s!=='string')return '';return s.replace(/@/g,'＠').replace(/`/g,'ˋ').replace(/[\u0000-\u001f]/g,' ').slice(0,1200);}
module.exports={STEPS,PLAYSTYLES,DAYS,nextStep,view,safeText};
