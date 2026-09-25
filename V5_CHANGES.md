# v5 changes from v4

## Removed

- All seven CAP SAP-to-iGrid mapping modules.
- `config/mappings.json` and `config/igrid-contract.json`.
- Canonical iGrid database schema/entities.
- Mock SAP fixtures.
- Inventory/product enrichment logic.
- CAP-side field coverage/provenance logic.
- `/api/sap/sync/:domain` canonical mapping endpoint.
- HANA/HDI container and DB deployer.
- `@cap-js/hana` dependency.
- Ariba/Contracts from the S/4 proxy scope.

## Kept

- XSUAA client-credentials protection.
- Destination service binding.
- Connectivity service binding.
- `ABAP_TOOL_CC` default destination.
- Cloud Connector/on-premise routing through `ProxyType=OnPremise`.
- 45-second SAP HTTP timeout.
- Current iGrid root compatibility paths.
- Query-string preservation (`$top`, `$format`, `$filter`, `$select`, etc.).
- Maintenance Notification compatibility rewrite to `API_MAINTNOTIFICATION`.
- `/api/sap/test` end-to-end Destination/Cloud Connector/SAP test.

## New/changed

- CAP is explicitly **raw pass-through only**.
- Successful SAP responses are returned unchanged to the iGrid backend.
- Downstream SAP error status/body are also propagated when available.
- Added `GET /api/sap/status` documenting ownership boundaries.
- Added `GET /api/sap/routes` to inspect configured proxy routes.
- Added `GET /api/sap/raw/:domain` for direct raw SAP diagnostics.
- No CAP database is deployed because the proxy stores no business records.
- Node engine pinned to `24.x` instead of a broad `>=22.x` range.

## Responsibility boundary after v5

CAP owns:
- XSUAA authentication
- BTP Destination resolution
- Connectivity/Cloud Connector routing
- SAP URL rewrite/proxy
- timeout and transparent downstream errors

Existing iGrid backend owns:
- `$top=25` or future pagination
- SAP-to-canonical mapping profiles
- domain field/status mapping
- schema validation
- insert/update/upsert
- pipeline/audit entries
- SAP LIVE state
