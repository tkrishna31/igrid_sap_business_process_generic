// scripts/check-btp-bindings.js
'use strict';

let vcap = {};
try { vcap = JSON.parse(process.env.VCAP_SERVICES || '{}'); } catch { /* ignore */ }
const labels = Object.keys(vcap);
const required = ['xsuaa', 'destination', 'connectivity'];
const missing = required.filter(x => !labels.includes(x));

console.log(JSON.stringify({
  ok: missing.length === 0,
  required,
  found: labels,
  missing,
  destinationName: process.env.SAP_DESTINATION || 'ABAP_TOOL_CC'
}, null, 2));

if (missing.length) process.exitCode = 1;


