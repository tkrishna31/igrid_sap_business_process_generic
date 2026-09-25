# working api with write/read access api btp destination to on prem system


# iGrid SAP CAP Proxy v5

This version intentionally does **one job only**: securely proxy the existing iGrid Portal's S/4HANA reads through SAP BTP Destination + Connectivity + Cloud Connector and return the **raw SAP OData response unchanged**.

## Final responsibility split

```text
iGrid Portal
  -> POST /api/hub/sap/sync/{domain}
  -> iGrid backend
  -> CAP root + catalog path (for example /API_EQUIPMENT/Equipment?$top=25&$format=json)
  -> XSUAA-protected CAP proxy
  -> BTP Destination ABAP_TOOL_CC
  -> Connectivity service
  -> Cloud Connector
  -> on-premise S/4HANA
  -> raw SAP OData response
  -> iGrid backend mapping profile
  -> canonical validation/upsert/pipeline audit
```

CAP **does not** map iGrid fields, insert iGrid records, paginate the SAP dataset, or decide which mapping profile is active. Those behaviors already exist in the current iGrid backend, as proven by responses such as `entities: 25, mapped: 0, mapping profile ... pending activation`.

## BTP services used

- XSUAA: protects CAP and supplies the technical `client_credentials` token used by iGrid.
- Destination service: resolves `ABAP_TOOL_CC`.
- Connectivity service: routes `ProxyType=OnPremise` traffic through Cloud Connector.
- Cloud Connector: external BTP configuration; it is not hardcoded into source code.

No HANA database is required by this CAP proxy.

## Existing destination

The project defaults to:

```text
SAP_DESTINATION=ABAP_TOOL_CC
```

Your existing BTP destination is expected to contain the on-premise virtual URL/authentication. Do not put the SAP username/password in this project.

## What goes in iGrid baseUrl

Use only the deployed CAP application root:

```text
https://<deployed-cap-route>.cfapps.us10-001.hana.ondemand.com
```

Do not append `/api/sap`, `/sap/opu/odata/sap`, or an individual API path.

## Compatibility routes used by the current iGrid backend

The project accepts the current iGrid catalog paths at the CAP root and rewrites them to S/4HANA:

| iGrid calls CAP | CAP calls S/4HANA |
|---|---|
| `/API_MAINTENANCEORDER/...` | `/sap/opu/odata/sap/API_MAINTENANCEORDER/...` |
| `/API_EQUIPMENT/...` | `/sap/opu/odata/sap/API_EQUIPMENT/...` |
| `/API_MATERIAL_STOCK_SRV/...` | `/sap/opu/odata/sap/API_MATERIAL_STOCK_SRV/...` |
| `/API_SUPPLIERINVOICE_PROCESS_SRV/...` | `/sap/opu/odata/sap/API_SUPPLIERINVOICE_PROCESS_SRV/...` |
| `/API_MANAGE_WORKFORCE_TIMESHEET/...` | `/sap/opu/odata/sap/API_MANAGE_WORKFORCE_TIMESHEET/...` |
| `/API_SERVICE_REQUEST_SRV/...` | `/sap/opu/odata/sap/API_SERVICE_REQUEST_SRV/...` |
| current notification A2X path | `/sap/opu/odata/sap/API_MAINTNOTIFICATION/...` by default |

All query parameters from iGrid (`$top`, `$filter`, `$select`, `$format`, etc.) are preserved unchanged.

## Important: the 25-row limit is not in CAP

CAP does not add `$top=25`. The current iGrid backend is already sending URLs such as:

```text
/API_EQUIPMENT/Equipment?$top=25&$format=json
```

The proxy preserves that request exactly. Production pagination must therefore be addressed in the iGrid sync backend if more than the first page is required.

## Deploy

```bash
npm ci
mbt build
cf api https://api.cf.us10-001.hana.ondemand.com
cf login
cf target -o <ORG> -s <SPACE>
cf deploy mta_archives/igrid-sap-cap-integration_5.0.0.mtar
```

After deployment:

```bash
cf env igrid-sap-cap-integration-srv
cf app igrid-sap-cap-integration-srv
```

Verify bindings for `xsuaa`, `destination`, and `connectivity`.

## Test CAP -> SAP

Get a client-credentials token from the XSUAA instance created by the MTA, then test:

```http
POST https://<CAP-ROUTE>/api/sap/test
Authorization: Bearer <TOKEN>
Content-Type: application/json

{}
```

Then test the exact compatibility URL used by iGrid:

```http
GET https://<CAP-ROUTE>/API_MAINTENANCEORDER/$metadata
Authorization: Bearer <TOKEN>
```

and:

```http
GET https://<CAP-ROUTE>/API_MATERIAL_STOCK_SRV/A_MatlStkInAcctMod?$top=25&$format=json
Authorization: Bearer <TOKEN>
Accept: application/json
```

A `200` with real SAP JSON proves CAP/Destination/Cloud Connector/SAP retrieval works. It does **not** prove the iGrid domain mapping profile is activated.

## Diagnostic raw endpoint

For direct testing only:

```http
GET /api/sap/raw/work_orders?$top=25&$format=json
GET /api/sap/raw/assets?$top=25&$format=json
GET /api/sap/raw/inventory?$top=25&$format=json
GET /api/sap/raw/invoices?$top=25&$format=json
GET /api/sap/raw/timesheets?$top=25&$format=json
GET /api/sap/raw/service_requests?$top=25&$format=json
GET /api/sap/raw/notifications?$top=25&$format=json
```

These endpoints also return raw SAP data; they do not map or insert anything.

## Test iGrid Sync

Keep iGrid configuration as:

```text
baseUrl     = https://<CAP-ROUTE>
tokenUrl    = <CAP XSUAA URL>/oauth/token
clientId    = <CAP XSUAA technical client ID>
clientSecret= <CAP XSUAA technical client secret>
```

Click SAP Sync in the Portal. Then check:

1. Browser Network: `POST /api/hub/sap/sync/{domain}`.
2. CAP logs: `[IGRID-SAP-PROXY] GET ... -> /sap/opu/odata/sap/...` and `SAP 200`.
3. iGrid response:
   - `entities > 0, mapped > 0` = SAP retrieval + iGrid mapping/upsert worked.
   - `entities > 0, mapped: 0, mapping profile pending activation` = CAP/SAP works; iGrid mapping profile is the blocker.
   - `entities: 0` = the SAP entity set returned no rows to iGrid (or iGrid parsed none); mapping cannot create source records.
4. Pipeline runs: verify accepted/received counts.

## Logs

```bash
cf logs igrid-sap-cap-integration-srv
```

Expected successful line:

```text
[IGRID-SAP-PROXY] SAP 200 <- /sap/opu/odata/sap/API_EQUIPMENT/Equipment?$top=25&$format=json
```

## Notifications

The existing iGrid catalog currently uses an A2X-style incoming notification path. This proxy rewrites it by default to:

```text
/sap/opu/odata/sap/API_MAINTNOTIFICATION
```

If the client later confirms a different working notification service, change only `SAP_NOTIFICATION_LEGACY_BASE`; no domain mapper needs to be changed in CAP.

## Ariba contracts

Ariba is intentionally excluded from v5. It should later use a separate Internet destination/API configuration rather than the S/4HANA `ABAP_TOOL_CC` on-premise destination.

## v6 write support

This v6 release keeps the v5 read/proxy behavior and adds SAP write-through. The same iGrid `baseUrl` can now be used for supported SAP create/update/delete requests and explicit Maintenance Order status actions.

Examples:

```text
POST /api/sap/maintenance-orders/10001234/approve
POST /api/sap/maintenance-orders/10001234/release
PATCH /API_MAINTENANCEORDER/MaintenanceOrder('10001234')
POST /API_MAINTNOTIFICATION/MaintenanceNotification
```

For the generic root compatibility routes, POST/PATCH/PUT/DELETE are forwarded to SAP. The SAP API must support the requested operation. CAP does not fabricate updates or map iGrid fields.
