// srv/lib/sap-proxy.js
'use strict';

const fs = require('fs');
const path = require('path');
let _getDestination;
let _executeHttpRequest;

const SAP_ODATA_V2_PREFIX = '/sap/opu/odata/sap';
const OLD_NOTIFICATION_PREFIX = '/api_maintnotification/srvd_a2x/sap/maintenancenotification/0001';
const ON_PREM_SERVICE_PREFIXES = [
  '/API_MAINTENANCEORDER',
  '/API_MAINTNOTIFICATION',
  '/API_EQUIPMENT',
  '/API_MATERIAL_STOCK_SRV',
  '/API_SUPPLIERINVOICE_PROCESS_SRV',
  '/API_MANAGE_WORKFORCE_TIMESHEET',
  '/API_SERVICE_REQUEST_SRV'
];

const root = path.join(__dirname, '..', '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'config', 'sap-apis.json'), 'utf8'));

function getDestinationSdk() {
  if (!_getDestination) ({ getDestination: _getDestination } = require('@sap-cloud-sdk/connectivity'));
  return _getDestination;
}
function executeHttpRequestSdk() {
  if (!_executeHttpRequest) ({ executeHttpRequest: _executeHttpRequest } = require('@sap-cloud-sdk/http-client'));
  return _executeHttpRequest;
}
function destinationName() { return process.env.SAP_DESTINATION || 'ABAP_TOOL_CC'; }
function requestTimeoutMs() {
  const value = Number(process.env.SAP_HTTP_TIMEOUT_MS || 45000);
  return Number.isFinite(value) && value >= 1000 ? value : 45000;
}
function isCompatEnabled() { return String(process.env.IGRID_COMPAT_PROXY ?? 'true').toLowerCase() !== 'false'; }
function metadataPath() { return process.env.SAP_METADATA_PATH || '/sap/opu/odata/sap/API_MAINTENANCEORDER/$metadata'; }
function dataProbePath() { return process.env.SAP_DATA_PROBE_PATH || '/sap/opu/odata/sap/API_MAINTENANCEORDER/MaintenanceOrder?$format=json&$top=1'; }
function splitUrl(input) {
  const value = String(input || '/');
  const index = value.indexOf('?');
  return index < 0 ? { pathname: value, query: '' } : { pathname: value.slice(0, index), query: value.slice(index) };
}
function rewriteLegacyUrl(originalUrl) {
  const { pathname, query } = splitUrl(originalUrl);
  if (pathname === OLD_NOTIFICATION_PREFIX || pathname.startsWith(OLD_NOTIFICATION_PREFIX + '/')) {
    const suffix = pathname.slice(OLD_NOTIFICATION_PREFIX.length);
    const base = process.env.SAP_NOTIFICATION_LEGACY_BASE || `${SAP_ODATA_V2_PREFIX}/API_MAINTNOTIFICATION`;
    return base + suffix + query;
  }
  if (ON_PREM_SERVICE_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(prefix + '/'))) {
    return SAP_ODATA_V2_PREFIX + pathname + query;
  }
  return null;
}
//n
function resolveGenericReadUrl(sapPath) {
  const { pathname, query } = splitUrl(sapPath);

  if (pathname.startsWith('/sap/')) {
    return pathname + query;
  }

  return `${SAP_ODATA_V2_PREFIX}${pathname}${query}`;
}
//n
function supportedPrefixes() { return [...ON_PREM_SERVICE_PREFIXES, OLD_NOTIFICATION_PREFIX]; }
function bindingSummary() {
  let vcap = {};
  try { vcap = JSON.parse(process.env.VCAP_SERVICES || '{}'); } catch { /* ignore */ }
  const labels = Object.keys(vcap);
  const has = name => labels.includes(name);
  return { xsuaa: has('xsuaa'), destination: has('destination'), connectivity: has('connectivity'), labels };
}
function sanitizeDestination(destination) {
  if (!destination) return null;
  return {
    name: destination.name || destinationName(), url: destination.url || null,
    proxyType: destination.proxyType || null, authentication: destination.authentication || null,
    sapClient: destination.sapClient || destination.originalProperties?.['sap-client'] || null,
    locationId: destination.cloudConnectorLocationId || destination.originalProperties?.CloudConnectorLocationId || null
  };
}
async function resolveDestination() {
  const destination = await getDestinationSdk()({ destinationName: destinationName(), useCache: false });
  if (!destination) throw Object.assign(new Error(`BTP Destination '${destinationName()}' was not found.`), { statusCode: 502, code: 'DESTINATION_NOT_FOUND' });
  for (const token of destination.authTokens || []) {
    if (token?.error) throw Object.assign(new Error(`Destination authentication error: ${token.error}`), { statusCode: 502, code: 'DESTINATION_AUTH_ERROR' });
  }
  return destination;
}
function forwardWriteHeaders(requestHeaders = {}) {
  const headers = {};
  for (const key of ['accept', 'content-type', 'if-match', 'if-none-match', 'sap-contextid-accept', 'prefer']) {
    if (requestHeaders[key] !== undefined) headers[key] = requestHeaders[key];
  }
  return headers;
}
async function executeSap(method, targetUrl, requestHeaders = {}, data, options = {}) {
  const destination = await resolveDestination();
  const config = {
    method,
    url: targetUrl,
    timeout: requestTimeoutMs(),
    headers: method === 'GET' ? { Accept: requestHeaders.accept || requestHeaders.Accept || '*/*' } : forwardWriteHeaders(requestHeaders)
  };
  if (data !== undefined && data !== null && method !== 'GET' && method !== 'DELETE') config.data = data;
  const response = await executeHttpRequestSdk()(destination, config, { fetchCsrfToken: method !== 'GET' && method !== 'HEAD' });
  return { destination, response };
}
async function executeSapGet(targetUrl, requestHeaders = {}) { return executeSap('GET', targetUrl, requestHeaders); }

//06-09 read update
// Generic SAP OData read support.
// Supports:
//   1. /api/sap/read/<path>
//   2. /api/sap/read?path=<path>
//   3. /api/sap/read with JSON:
//      {
//        "path": "...",
//        "parameters": {...},
//        "query": {...}
//      }

function quoteODataParameter(value) {
  if (value === null || value === undefined) {
    return 'null';
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw Object.assign(
        new Error('OData numeric parameter must be finite.'),
        {
          statusCode: 400,
          code: 'INVALID_ODATA_PARAMETER_VALUE'
        }
      );
    }

    return String(value);
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  const text = String(value);

  // JSON date:
  // "2026-09-07"
  //
  // becomes:
  // datetime'2026-09-07T00:00:00'
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return `datetime'${text}T00:00:00'`;
  }

  // Allow callers to explicitly provide an OData literal.
  if (/^datetime'[^']+'$/i.test(text)) {
    return text;
  }

  if (/^datetimeoffset'[^']+'$/i.test(text)) {
    return text;
  }

  // Default = OData string.
  return `'${text.replace(/'/g, "''")}'`;
}

function validateReadPath(sapPath) {
  if (!sapPath || typeof sapPath !== 'string') {
    throw Object.assign(
      new Error('SAP read path is required.'),
      {
        statusCode: 400,
        code: 'INVALID_SAP_READ_PATH'
      }
    );
  }

  if (!sapPath.startsWith('/')) {
    throw Object.assign(
      new Error('SAP read path must begin with /.'),
      {
        statusCode: 400,
        code: 'INVALID_SAP_READ_PATH'
      }
    );
  }

  return sapPath;
}

function buildParameterizedReadPath(
  sapPath,
  parameters = {},
  query = {}
) {
  validateReadPath(sapPath);

  const { pathname, query: existingQuery } =
    splitUrl(sapPath);

  let finalPath = pathname;

  const parameterEntries =
    parameters &&
      typeof parameters === 'object' &&
      !Array.isArray(parameters)
      ? Object.entries(parameters)
      : [];

  /*
   * Add CDS parameters only when supplied.
   *
   * Input:
   *
   * /ZC_SLOWORNONMOVE_MAT/
   * ZC_SlowOrNonMovingMatlQry/Results
   *
   * becomes:
   *
   * /ZC_SLOWORNONMOVE_MAT/
   * ZC_SlowOrNonMovingMatlQry(
   *   P_NumberOfDays=400,
   *   P_KeyDate=datetime'2026-09-07T00:00:00',
   *   ...
   * )/Results
   */

  if (parameterEntries.length > 0) {
    const parameterString = parameterEntries
      .map(([name, value]) => {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
          throw Object.assign(
            new Error(
              `Invalid OData parameter name '${name}'.`
            ),
            {
              statusCode: 400,
              code: 'INVALID_ODATA_PARAMETER_NAME'
            }
          );
        }

        return `${name}=${quoteODataParameter(value)}`;
      })
      .join(',');

    /*
     * Do not add parameters twice if the caller has
     * already supplied:
     *
     * QueryName(P1=value)/Results
     */
    const resultsIndex = finalPath.indexOf('/Results');

    if (resultsIndex >= 0) {
      const queryBeforeResults =
        finalPath.slice(0, resultsIndex);

      if (!/\([^()]*\)$/.test(queryBeforeResults)) {
        finalPath =
          queryBeforeResults +
          `(${parameterString})` +
          finalPath.slice(resultsIndex);
      }
    } else {
      /*
       * Parameterized CDS query without /Results.
       *
       * Example:
       *
       * /MyQuery
       *
       * becomes:
       *
       * /MyQuery(P1=value)
       */
      const lastSlash = finalPath.lastIndexOf('/');

      if (lastSlash < 0) {
        finalPath =
          `${finalPath}(${parameterString})`;
      } else {
        const servicePrefix =
          finalPath.slice(0, lastSlash);

        const entityName =
          finalPath.slice(lastSlash + 1);

        if (!entityName) {
          throw Object.assign(
            new Error(
              'Unable to construct parameterized SAP OData path.'
            ),
            {
              statusCode: 400,
              code: 'INVALID_PARAMETERIZED_READ_PATH'
            }
          );
        }

        if (entityName.includes('(')) {
          finalPath =
            `${servicePrefix}/${entityName}`;
        } else {
          finalPath =
            `${servicePrefix}/${entityName}(${parameterString})`;
        }
      }
    }
  }

  /*
   * JSON query options.
   *
   * Example:
   *
   * {
   *   "$filter": "Plant eq 'HR11'",
   *   "$top": 100
   * }
   */
  const queryEntries =
    query &&
      typeof query === 'object' &&
      !Array.isArray(query)
      ? Object.entries(query)
      : [];

  let finalQuery = existingQuery || '';

  if (queryEntries.length > 0) {
    const queryParams = new URLSearchParams();

    for (const [name, value] of queryEntries) {
      if (
        value === undefined ||
        value === null
      ) {
        continue;
      }

      if (Array.isArray(value)) {
        for (const item of value) {
          queryParams.append(
            name,
            String(item)
          );
        }
      } else {
        queryParams.append(
          name,
          String(value)
        );
      }
    }

    const encodedQuery =
      queryParams.toString();

    if (encodedQuery) {
      finalQuery = finalQuery
        ? `${finalQuery}&${encodedQuery}`
        : `?${encodedQuery}`;
    }
  }

  return `${finalPath}${finalQuery}`;
}

async function readSap(
  sapPath,
  requestHeaders = {},
  readOptions = {}
) {
  validateReadPath(sapPath);

  const parameters =
    readOptions?.parameters &&
      typeof readOptions.parameters === 'object' &&
      !Array.isArray(readOptions.parameters)
      ? readOptions.parameters
      : {};

  const query =
    readOptions?.query &&
      typeof readOptions.query === 'object' &&
      !Array.isArray(readOptions.query)
      ? readOptions.query
      : {};

  const parameterizedPath =
    buildParameterizedReadPath(
      sapPath,
      parameters,
      query
    );

  const targetUrl = resolveGenericReadUrl(parameterizedPath);
  /*
  let targetUrl =
    rewriteLegacyUrl(parameterizedPath);

  if (!targetUrl) {
    const {
      pathname,
      query: queryString
    } = splitUrl(parameterizedPath);

    if (pathname.startsWith('/sap/')) {
      targetUrl =
        pathname + queryString;
    } else {
      targetUrl =
        `${SAP_ODATA_V2_PREFIX}${pathname}${queryString}`;
    }
  }
    */

  console.log(
    `[SAP-READ] GET ${sapPath} -> ${targetUrl} via '${destinationName()}'`
  );

  const headers = {
    ...requestHeaders,
    accept: 'application/json'
  };

  const {
    destination,
    response
  } = await executeSapGet(
    targetUrl,
    headers
  );

  console.log(
    `[SAP-READ] SAP ${response.status} <- ${targetUrl}`
  );

  return {
    targetUrl,
    destination:
      sanitizeDestination(destination),
    status: response.status,
    headers:
      response.headers || {},
    data: response.data
  };
}

// 06-09 generic JSON read update end
//06-09 read update end
async function proxyLegacy(originalUrl, method = 'GET', requestHeaders = {}, data) {
  if (!isCompatEnabled()) throw Object.assign(new Error('iGrid compatibility proxy is disabled.'), { statusCode: 404, code: 'IGRID_COMPAT_DISABLED' });
  const targetUrl = rewriteLegacyUrl(originalUrl);
  if (!targetUrl) throw Object.assign(new Error(`Unsupported iGrid SAP path: ${originalUrl}`), { statusCode: 404, code: 'UNSUPPORTED_IGRID_SAP_PATH' });
  if (!['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) throw Object.assign(new Error(`HTTP method ${method} is not enabled for SAP proxy writes.`), { statusCode: 405, code: 'METHOD_NOT_ALLOWED' });
  console.log(`[IGRID-SAP-PROXY] ${method} ${originalUrl} -> ${targetUrl} via '${destinationName()}'`);
  const { destination, response } = await executeSap(method, targetUrl, requestHeaders, data);
  console.log(`[IGRID-SAP-PROXY] SAP ${response.status} <- ${targetUrl}`);
  return { targetUrl, destination: sanitizeDestination(destination), status: response.status, headers: response.headers || {}, data: response.data };
}

async function proxyLegacyGet(originalUrl, requestHeaders = {}) { return proxyLegacy(originalUrl, 'GET', requestHeaders); }
// 08-09 generic write update
async function writeSap(sapPath, method, requestHeaders = {}, data) {
  if (!sapPath || typeof sapPath !== 'string' || !sapPath.startsWith('/')) {
    throw Object.assign(new Error('SAP write path must be a string beginning with /.'), { statusCode: 400, code: 'INVALID_SAP_WRITE_PATH' });
  }
  if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
    throw Object.assign(new Error(`HTTP method ${method} is not enabled for SAP proxy writes.`), { statusCode: 405, code: 'METHOD_NOT_ALLOWED' });
  }

  // Reuse the known-prefix rewrite first (keeps the 7 configured APIs behaving
  // exactly as before, including the legacy notification path rewrite).
  let targetUrl = rewriteLegacyUrl(sapPath);

  if (!targetUrl) {
    // Fallback for any other SAP OData API: same convention readSap() uses.
    const { pathname, query } = splitUrl(sapPath);
    targetUrl = pathname.startsWith('/sap/') ? pathname + query : `${SAP_ODATA_V2_PREFIX}${pathname}${query}`;
  }

  console.log(`[SAP-WRITE] ${method} ${sapPath} -> ${targetUrl} via '${destinationName()}'`);
  const { destination, response } = await executeSap(method, targetUrl, requestHeaders, data);
  console.log(`[SAP-WRITE] SAP ${response.status} <- ${targetUrl}`);
  return { targetUrl, destination: sanitizeDestination(destination), status: response.status, headers: response.headers || {}, data: response.data };
}
// 08-09 generic write update end
async function proxyDomain(domain, query = '', requestHeaders = {}) {
  const cfg = catalog[domain];
  if (!cfg) throw Object.assign(new Error(`Unknown S/4HANA domain '${domain}'.`), { statusCode: 400 });
  const queryString = query ? (String(query).startsWith('?') ? String(query) : `?${query}`) : '';
  const targetUrl = cfg.sapPath + queryString;
  const { destination, response } = await executeSapGet(targetUrl, requestHeaders);
  return { targetUrl, destination: sanitizeDestination(destination), status: response.status, headers: response.headers || {}, data: response.data };
}

const MAINT_ACTIONS = {
  submit: 'SubmitMaintOrderForApproval', approve: 'ApproveMaintenanceOrder', reject: 'RejectMaintenanceOrder',
  release: 'ReleaseMaintenanceOrder', schedule: 'ScheduleMaintenanceOrder', readyForScheduling: 'SetMaintOrderToReadyForSchedg',
  dispatched: 'SetMaintOrderOpToDispatched', mainWorkCompleted: 'SetMaintOrdToMainWorkComplete',
  technicallyCompleted: 'SetMaintOrdToTechCompleted', close: 'SetMaintOrderStatusToClosed',
  lock: 'SetMaintOrderStatusToLocked', unlock: 'ResetMaintOrderStatusLocked'
};
function quoteOData(value) { return `'${String(value).replace(/'/g, "''")}'`; }
function maintenanceActionPath(action, orderId) {
  const fn = MAINT_ACTIONS[action];
  if (!fn) throw Object.assign(new Error(`Unsupported maintenance-order action '${action}'.`), { statusCode: 400, code: 'UNSUPPORTED_ACTION' });
  return `${SAP_ODATA_V2_PREFIX}/API_MAINTENANCEORDER/${fn}?MaintenanceOrder=${quoteOData(orderId)}`;
}
async function getMaintenanceOrder(orderId) {
  const targetUrl = `${SAP_ODATA_V2_PREFIX}/API_MAINTENANCEORDER/MaintenanceOrder(${quoteOData(orderId)})`;
  return executeSapGet(targetUrl, { accept: 'application/json' });
}
async function maintenanceAction(action, orderId, requestHeaders = {}) {
  const current = await getMaintenanceOrder(orderId);
  const etag = requestHeaders['if-match'] || current.response.headers?.etag || current.response.headers?.ETag;
  const headers = { ...requestHeaders };
  if (etag) headers['if-match'] = etag;
  else if (current.response.data?.d?.LastChangeDateTime) headers['if-match'] = current.response.data.d.LastChangeDateTime;
  else throw Object.assign(new Error('SAP requires If-Match for this maintenance-order action. Read the order first and provide the returned ETag/LastChangeDateTime.'), { statusCode: 428, code: 'ETAG_REQUIRED' });
  const targetUrl = maintenanceActionPath(action, orderId);
  const { destination, response } = await executeSap('POST', targetUrl, headers);
  return { targetUrl, destination: sanitizeDestination(destination), status: response.status, headers: response.headers || {}, data: response.data, action, orderId, previous: current.response.data };
}

async function testConnection() {
  const result = { ok: false, destinationName: destinationName(), requestTimeoutMs: requestTimeoutMs(), bindings: bindingSummary(), destination: null, checks: [] };
  try {
    const destination = await resolveDestination(); result.destination = sanitizeDestination(destination);
    result.checks.push({ name: 'destination-resolution', ok: true });
    const onPremise = String(result.destination?.proxyType || '').toLowerCase() === 'onpremise';
    result.checks.push({ name: 'on-premise-routing', ok: onPremise, detail: `ProxyType=${result.destination?.proxyType || 'unknown'}` });
    if (!onPremise) throw Object.assign(new Error('Destination must use ProxyType=OnPremise.'), { statusCode: 502 });
    const meta = await executeHttpRequestSdk()(destination, { method: 'GET', url: metadataPath(), timeout: requestTimeoutMs(), headers: { Accept: 'application/xml,text/xml,*/*' } }, { fetchCsrfToken: false });
    result.checks.push({ name: 'metadata', ok: meta.status >= 200 && meta.status < 300, httpStatus: meta.status, path: metadataPath() });
    const probe = await executeHttpRequestSdk()(destination, { method: 'GET', url: dataProbePath(), timeout: requestTimeoutMs(), headers: { Accept: 'application/json' } }, { fetchCsrfToken: false });
    result.checks.push({ name: 'data-probe', ok: probe.status >= 200 && probe.status < 300, httpStatus: probe.status, path: dataProbePath() });
    result.ok = result.checks.every(check => check.ok);
    result.message = result.ok ? 'CAP reached on-premise S/4HANA through Destination + Connectivity + Cloud Connector.' : 'One or more SAP connectivity checks failed.';
  } catch (err) {
    result.error = { status: err?.response?.status || err?.statusCode || null, code: err?.code || null, message: String(err?.response?.data?.error?.message?.value || err?.message || err) };
    result.message = 'SAP connectivity test failed.';
  }
  return result;
}
function getStatus() { return { ok: true, architecture: 'proxy-with-writes', mapping: 'none-in-cap', insertion: 'sap-write-through-when-api-supported', destinationName: destinationName(), message: 'SAP write-capable proxy is configured; SAP itself enforces API authorizations and business rules.' }; }

module.exports = {
  catalog, supportedPrefixes, isCompatEnabled, getStatus, proxyLegacyGet, proxyLegacy, writeSap, proxyDomain, readSap, testConnection,
  maintenanceAction, MAINT_ACTIONS, maintenanceActionPath, rewriteLegacyUrl
};
