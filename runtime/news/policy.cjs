'use strict';
const POLL_MS=10*60*1000;
const PUBLISH_INTERVAL_MS=15*60*1000;
function backoffFor(error){return /\b403\b/.test(String(error?.message||error))?6*60*60*1000:15*60*1000;}
module.exports={POLL_MS,PUBLISH_INTERVAL_MS,backoffFor};
