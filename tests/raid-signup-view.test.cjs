'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {signupPayload}=require('../runtime/raid-signup-view.cjs');
function embed(){return {setTitle(x){this.title=x;return this},setDescription(x){this.description=x;return this}}}
const raid={id:5,name:'Hyjal',scheduled_ts:1797102000};
test('only active raids expose signup buttons, including after a restart refresh',()=>{
 let calls=0;const buttons=id=>{calls++;return [{id}]};
 assert.deepEqual(signupPayload({...raid,status:'ACTIVE'},embed(),buttons).components,[{id:5}]);
 for(const status of ['CLOSED','CANCELLED','UNKNOWN'])assert.deepEqual(signupPayload({...raid,status},embed(),buttons).components,[]);
 assert.equal(calls,1);
});
test('closed and cancelled raids show their actual state without pinging members',()=>{
 let view=signupPayload({...raid,status:'CLOSED'},embed(),()=>{throw Error('must not build buttons')});
 assert.match(view.embeds[0].title,/ZAMKNIĘTE/);assert.match(view.embeds[0].description,/zamknięte/);assert.deepEqual(view.allowedMentions,{parse:[]});
 view=signupPayload({...raid,status:'CANCELLED',cancel_reason:'Zmiana planu'},embed(),()=>{throw Error('must not build buttons')});
 assert.match(view.embeds[0].title,/ANULOWANY/);assert.match(view.embeds[0].description,/Zmiana planu/);
});
