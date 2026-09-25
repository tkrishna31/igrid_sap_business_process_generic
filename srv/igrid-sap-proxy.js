// srv/igrid-sap-proxy.js
'use strict';

const cds = require('@sap/cds');
const proxy = require('./lib/sap-proxy');
const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');
module.exports = cds.service.impl(function () {
  this.on('status', () => {
    const s = proxy.getStatus();
    return {
      ok: s.ok,
      destinationName: s.destinationName,
      message: s.message
    };
  });

  this.on('testConnection', async () => {
    const r = await proxy.testConnection();
    return {
      ok: r.ok,
      destinationName: r.destinationName,
      message: r.message
    };
  });
   this.on('testSapConnection', async () => {

    const response = await executeHttpRequest(
      { destinationName: 'ABAP_TOOL_CC' },
      {
        method: 'GET',
        url: '/sap/opu/odata/sap/API_PURCHASEREQ_PROCESS_SRV/A_PurchaseRequisitionHeader?$top=1',
        headers: {
          Accept: 'application/json'
        }
      }
    );

  return JSON.stringify({
    status: response.status,
    data: response.data
  });
  });

  this.on('testSapConnectionResolved', async () => {
  const destination = await require('@sap-cloud-sdk/connectivity').getDestination({
    destinationName: 'ABAP_TOOL_CC',
    useCache: false
  });

  console.log('[TEST-DEST]', JSON.stringify({
    name: destination?.name,
    url: destination?.url,
    proxyType: destination?.proxyConfiguration?.proxyType,
    proxyHost: destination?.proxyConfiguration?.host,
    proxyPort: destination?.proxyConfiguration?.port,
    authentication: destination?.authentication,
    username: destination?.username
  }, null, 2));

  const response = await executeHttpRequest(
    destination,
    {
      method: 'GET',
      url: '/sap/opu/odata/sap/API_PURCHASEREQ_PROCESS_SRV/A_PurchaseRequisitionHeader?$top=1',
      headers: {
        Accept: 'application/json'
      }
    }
  );

  return JSON.stringify({
    status: response.status,
    data: response.data
  });
});
});
