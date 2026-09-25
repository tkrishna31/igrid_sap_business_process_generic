'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const proxy = require('../srv/lib/sap-proxy');

const root = path.join(__dirname, '..');

test('project has no CAP domain mapping modules', () => {
  assert.equal(fs.existsSync(path.join(root, 'srv', 'mappings')), false);
  assert.equal(fs.existsSync(path.join(root, 'config', 'mappings.json')), false);
  assert.equal(fs.existsSync(path.join(root, 'config', 'igrid-contract.json')), false);
});

test('project has no HANA/db deployment dependency', () => {
  assert.equal(fs.existsSync(path.join(root, 'db')), false);
  const mta = fs.readFileSync(path.join(root, 'mta.yaml'), 'utf8');
  assert.equal(mta.includes('hdi-container'), false);
  assert.equal(mta.includes('db-deployer'), false);
});

test('status declares raw proxy ownership boundary', () => {
  const s = proxy.getStatus();
  assert.equal(s.architecture, 'proxy-with-writes');
  assert.equal(s.mapping, 'none-in-cap');
  assert.equal(s.insertion, 'sap-write-through-when-api-supported');
});

test('all current S4 domains except Ariba contracts are registered', () => {
  assert.deepEqual(Object.keys(proxy.catalog).sort(), [
    'assets', 'inventory', 'invoices', 'notifications', 'service_requests', 'timesheets', 'work_orders'
  ]);
});
