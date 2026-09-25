'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const proxy = require('../srv/lib/sap-proxy');

test('work order path rewrites to SAP OData root and preserves query', () => {
  assert.equal(
    proxy.rewriteLegacyUrl('/API_MAINTENANCEORDER/MaintenanceOrder?$top=25&$format=json'),
    '/sap/opu/odata/sap/API_MAINTENANCEORDER/MaintenanceOrder?$top=25&$format=json'
  );
});

test('inventory path rewrites unchanged apart from SAP OData prefix', () => {
  assert.equal(
    proxy.rewriteLegacyUrl('/API_MATERIAL_STOCK_SRV/A_MatlStkInAcctMod?$top=25&$format=json'),
    '/sap/opu/odata/sap/API_MATERIAL_STOCK_SRV/A_MatlStkInAcctMod?$top=25&$format=json'
  );
});

test('supplier invoice path rewrites correctly', () => {
  assert.equal(
    proxy.rewriteLegacyUrl('/API_SUPPLIERINVOICE_PROCESS_SRV/A_SupplierInvoice?$top=25&$format=json'),
    '/sap/opu/odata/sap/API_SUPPLIERINVOICE_PROCESS_SRV/A_SupplierInvoice?$top=25&$format=json'
  );
});

test('service request path rewrites correctly', () => {
  assert.equal(
    proxy.rewriteLegacyUrl('/API_SERVICE_REQUEST_SRV/A_ServiceRequest?$top=25&$format=json'),
    '/sap/opu/odata/sap/API_SERVICE_REQUEST_SRV/A_ServiceRequest?$top=25&$format=json'
  );
});

test('metadata path rewrites correctly', () => {
  assert.equal(
    proxy.rewriteLegacyUrl('/API_MAINTENANCEORDER/$metadata'),
    '/sap/opu/odata/sap/API_MAINTENANCEORDER/$metadata'
  );
});

test('old notification path rewrites to API_MAINTNOTIFICATION V2 service', () => {
  assert.equal(
    proxy.rewriteLegacyUrl('/api_maintnotification/srvd_a2x/sap/maintenancenotification/0001/MaintenanceNotification?$top=25'),
    '/sap/opu/odata/sap/API_MAINTNOTIFICATION/MaintenanceNotification?$top=25'
  );
});

test('unrelated paths are rejected by compatibility rewrite', () => {
  assert.equal(proxy.rewriteLegacyUrl('/api/hub/datasets'), null);
});
