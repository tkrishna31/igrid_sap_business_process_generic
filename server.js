//server.js
'use strict';

const cds = require('@sap/cds');
const express = require('express');
const proxy = require('./srv/lib/sap-proxy');

function requireTechnicalClient(req, res, next) {
  if (process.env.NODE_ENV !== 'production') return next();
  const user = cds.context?.user;
  if (!user || !user.is?.('system-user')) return res.status(403).json({ ok: false, error: 'Technical OAuth client required. Use client_credentials from the XSUAA instance bound to this CAP application.' });
  next();
}
function copyResponseHeaders(res, headers = {}) {
  const allowed = ['content-type', 'odata-version', 'dataserviceversion', 'etag', 'sap-message', 'location'];
  for (const key of allowed) {
    const value = headers[key] ?? headers[key.toLowerCase()] ?? headers[key.toUpperCase()];
    if (value !== undefined) res.set(key, String(value));
  }
}
function sendRaw(res, result) {
  copyResponseHeaders(res, result.headers);
  res.set('x-igrid-cap-proxy', result.status >= 200 && result.status < 300 ? 'sap-write-through' : 'sap-downstream-response');
  if (result.data === undefined || result.data === null) return res.status(result.status).end();
  if (Buffer.isBuffer(result.data) || typeof result.data === 'string') return res.status(result.status).send(result.data);
  return res.status(result.status).json(result.data);
}
function sendDownstreamError(res, err, requestPath) {
  const status = err?.response?.status || err?.statusCode || 502;
  const headers = err?.response?.headers || {};
  const data = err?.response?.data;
  copyResponseHeaders(res, headers);
  res.set('x-igrid-cap-proxy', 'sap-downstream-error');
  if (data !== undefined && data !== null) return Buffer.isBuffer(data) || typeof data === 'string' ? res.status(status).send(data) : res.status(status).json(data);
  return res.status(status).json({ ok: false, error: String(err?.message || err), code: err?.code || null, path: requestPath });
}

async function compatibilityHandler(req, res) {
  if (!['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) return res.status(405).json({ ok: false, error: `HTTP method ${req.method} is not enabled.` });
  try { return sendRaw(res, await proxy.proxyLegacy(req.originalUrl, req.method, req.headers, req.body)); }
  catch (err) { return sendDownstreamError(res, err, req.originalUrl); }
}

cds.on('bootstrap', app => {
  app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '2mb', strict: false }));
  if (proxy.isCompatEnabled()) for (const prefix of proxy.supportedPrefixes()) app.use(prefix, ...cds.middlewares.before, requireTechnicalClient, compatibilityHandler);

  const router = express.Router();
  router.get('/status', (_req, res) => res.json(proxy.getStatus()));
  router.post('/test', async (_req, res) => { const result = await proxy.testConnection(); res.status(result.ok ? 200 : (result.error?.status || 502)).json(result); });
  router.get('/routes', (_req, res) => res.json({ ok: true, mapping: 'none-in-cap', writeThrough: true, domains: proxy.catalog, compatibilityPrefixes: proxy.supportedPrefixes(), maintenanceOrderActions: Object.keys(proxy.MAINT_ACTIONS) }));
  router.get('/raw/:domain', async (req, res) => { try { const q = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : ''; return sendRaw(res, await proxy.proxyDomain(req.params.domain, q, req.headers)); } catch (err) { return sendDownstreamError(res, err, req.originalUrl); } });
  // 05-09 update 
  // Generic SAP READ support.
  //
  // Supported forms:
  //
  // 1. GET /api/sap/read/<SAP-relative-path>
  //
  // 2. GET /api/sap/read?path=<SAP-relative-path>
  //
  // 3. GET /api/sap/read
  //    Content-Type: application/json
  //
  //    {
  //      "path": "...",
  //      "parameters": {...},
  //      "query": {...}
  //    }
  //
  // parameters and query are optional.

  async function sapReadHandler(
    req,
    res,
    sapPath,
    options = {}
  ) {
    try {
      return sendRaw(
        res,
        await proxy.readSap(
          sapPath,
          req.headers,
          {
            parameters:
              options.parameters || {},
            query:
              options.query || {}
          }
        )
      );
    } catch (err) {
      return sendDownstreamError(
        res,
        err,
        req.originalUrl
      );
    }
  }


  /*
   * GET /api/sap/read
   *
   * Supports:
   *
   *   /api/sap/read?path=/API_MAINTENANCEORDER/MaintenanceOrder
   *
   * and JSON body:
   *
   *   {
   *     "path": "/ZC_SLOWORNONMOVE_MAT/...",
   *     "parameters": {...},
   *     "query": {...}
   *   }
   */
  router.get('/read', async (req, res) => {
    try {
      const body =
        req.body &&
          typeof req.body === 'object' &&
          !Array.isArray(req.body)
          ? req.body
          : {};

      /*
       * Supports:
       *
       * GET /api/sap/read?path=/API_MAINTENANCEORDER/MaintenanceOrder
       *
       * OR:
       *
       * GET /api/sap/read
       * {
       *   "path": "/...",
       *   "parameters": {...},
       *   "query": {...}
       * }
       */
      let sapPath =
        typeof body.path === 'string'
          ? body.path
          : req.query?.path;

      if (!sapPath || typeof sapPath !== 'string') {
        return res.status(400).json({
          ok: false,
          error: 'SAP read path is required.',
          examples: {
            path:
              '/api/sap/read?path=/API_MAINTENANCEORDER/MaintenanceOrder',

            json: {
              path:
                '/ZC_SLOWORNONMOVE_MAT/ZC_SlowOrNonMovingMatlQry/Results',
              parameters: {
                P_NumberOfDays: 400,
                P_KeyDate: '2026-09-07',
                P_DisplayCurrency: 'USD',
                P_InventoryConsumptionGroup: '0'
              },
              query: {
                '$filter': "Plant eq 'HR11'",
                '$top': 100
              }
            }
          }
        });
      }

      if (!sapPath.startsWith('/')) {
        return res.status(400).json({
          ok: false,
          error: 'SAP read path must begin with /.'
        });
      }

      /*
       * Preserve existing ?path= behavior.
       */
      const originalUrl = req.originalUrl;
      const queryIndex = originalUrl.indexOf('?');

      if (queryIndex >= 0 && !body.path) {
        const rawQuery =
          originalUrl.slice(queryIndex + 1);

        if (rawQuery.startsWith('path=')) {
          try {
            const decodedPath =
              decodeURIComponent(
                rawQuery.slice('path='.length)
              );

            if (decodedPath.startsWith('/')) {
              sapPath = decodedPath;
            }
          } catch {
            return res.status(400).json({
              ok: false,
              error: 'Invalid URL encoding in path.'
            });
          }
        }
      }

      /*
       * parameters and query are optional.
       */
      const parameters =
        body.parameters &&
          typeof body.parameters === 'object' &&
          !Array.isArray(body.parameters)
          ? body.parameters
          : {};

      const query =
        body.query &&
          typeof body.query === 'object' &&
          !Array.isArray(body.query)
          ? body.query
          : {};

      return sapReadHandler(
        req,
        res,
        sapPath,
        {
          parameters,
          query
        }
      );

    } catch (err) {
      return sendDownstreamError(
        res,
        err,
        req.originalUrl
      );
    }
  });


  /*
   * GET /api/sap/read/<SAP-relative-path>
   *
   * Existing behavior remains supported.
   *
   * Example:
   *
   * /api/sap/read/API_MAINTENANCEORDER/MaintenanceOrder
   */
  router.use('/read', async (req, res, next) => {
    if (req.method !== 'GET') {
      return res.status(405).json({
        ok: false,
        error:
          `HTTP method ${req.method} is not enabled for SAP read.`
      });
    }

    const prefix = '/api/sap/read';
    const originalUrl = req.originalUrl;

    const queryIndex =
      originalUrl.indexOf('?');

    const pathWithoutQuery =
      queryIndex >= 0
        ? originalUrl.slice(0, queryIndex)
        : originalUrl;

    const urlQuery =
      queryIndex >= 0
        ? originalUrl.slice(queryIndex)
        : '';

    const sapPath =
      pathWithoutQuery.slice(prefix.length) +
      urlQuery;

    /*
     * /api/sap/read itself is handled by router.get('/read').
     */
    if (!sapPath || sapPath === '/') {
      return next();
    }

    /*
     * Read optional JSON body.
     */
    const body =
      req.body &&
        typeof req.body === 'object' &&
        !Array.isArray(req.body)
        ? req.body
        : {};

    const parameters =
      body.parameters &&
        typeof body.parameters === 'object' &&
        !Array.isArray(body.parameters)
        ? body.parameters
        : {};

    const query =
      body.query &&
        typeof body.query === 'object' &&
        !Array.isArray(body.query)
        ? body.query
        : {};

    return sapReadHandler(
      req,
      res,
      sapPath,
      {
        parameters,
        query
      }
    );
  });

  // 05-09 generic SAP READ end
  // 05-09 update  end
  // Explicit, safe maintenance-order business actions. The proxy reads the current order,
  // obtains the current ETag, then calls SAP's action function. SAP enforces its own rules.
  router.post('/maintenance-orders/:id/:action', async (req, res) => {
    try { return sendRaw(res, await proxy.maintenanceAction(req.params.action, req.params.id, req.headers)); }
    catch (err) { return sendDownstreamError(res, err, req.originalUrl); }
  });

  // Generic write-through endpoint for supported SAP OData paths when the Portal needs
  // create/update/delete on a domain entity. The SAP API, not this gateway, determines
  // whether a particular entity/method is supported.
  /*
  router.post('/write/:path(*)', async (req, res) => {
  try {
    const pathValue = '/' + req.params.path;

    const method = String(
      req.body?.method || 'POST'
    ).toUpperCase();
    */
  router.post('/write', async (req, res) => {
    try {
      const pathValue = req.body?.path;
      const method = String(req.body?.method || 'PATCH').toUpperCase();
      const payload = req.body?.data;
      //  const payload = req.body?.data ?? req.body;
      if (!pathValue || !String(pathValue).startsWith('/')) return res.status(400).json({ ok: false, error: 'body.path must be a SAP-relative iGrid path beginning with /.' });
      if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) return res.status(400).json({ ok: false, error: 'method must be POST, PATCH, PUT or DELETE.' });
      return sendRaw(res, await proxy.writeSap(pathValue, method, req.headers, payload));
    } catch (err) { return sendDownstreamError(res, err, req.originalUrl); }
  });

  app.use('/api/sap', ...cds.middlewares.before, requireTechnicalClient, router);
});
module.exports = cds.server;
