# v6 changes from v5

1. Kept the v5 raw SAP read proxy and all existing catalog paths.
2. Enabled POST/PATCH/PUT/DELETE on the SAP compatibility prefixes.
3. Added CSRF-token fetching for non-GET SAP OData requests through SAP Cloud SDK.
4. Added `POST /api/sap/write` for controlled generic create/update/delete pass-through.
5. Added explicit Maintenance Order actions: submit, approve, reject, release, schedule, ready-for-scheduling, dispatched, main-work-completed, technically-completed, close, lock and unlock.
6. Maintenance Order actions perform a current read first and reuse the returned ETag when SAP requires If-Match.
7. No iGrid field mapping was added; request bodies are forwarded to SAP unchanged.
8. SAP remains authoritative for supported operations, authorizations, validation, workflow/approval rules and optimistic concurrency.
9. Existing Destination + Connectivity + Cloud Connector architecture is unchanged.
