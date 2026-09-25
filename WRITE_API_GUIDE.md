# v6 SAP write-through guide

This version extends v5 without changing the existing read flow. CAP still returns raw SAP responses, but it now supports controlled SAP writes.

## Maintenance Order actions

`POST /api/sap/maintenance-orders/:id/submit`
`POST /api/sap/maintenance-orders/:id/approve`
`POST /api/sap/maintenance-orders/:id/reject`
`POST /api/sap/maintenance-orders/:id/release`
`POST /api/sap/maintenance-orders/:id/schedule`
`POST /api/sap/maintenance-orders/:id/readyForScheduling`
`POST /api/sap/maintenance-orders/:id/dispatched`
`POST /api/sap/maintenance-orders/:id/mainWorkCompleted`
`POST /api/sap/maintenance-orders/:id/technicallyCompleted`
`POST /api/sap/maintenance-orders/:id/close`
`POST /api/sap/maintenance-orders/:id/lock`
`POST /api/sap/maintenance-orders/:id/unlock`

For actions that require optimistic concurrency, the gateway first reads the order and uses the current ETag. SAP remains the authority for authorization and business validation.

## Generic domain writes

`POST /api/sap/write`

Body:
```json
{
  "method": "PATCH",
  "path": "/API_MAINTENANCEORDER/MaintenanceOrder('10001234')",
  "data": { "MaintenanceOrderDesc": "Updated from iGrid" }
}
```

The gateway rewrites the path to `/sap/opu/odata/sap/...` and forwards the payload. For create, use `method: POST`; for supported deletes use `DELETE`.

The same root compatibility paths now accept `POST`, `PATCH`, `PUT`, and `DELETE`, so an iGrid caller that already constructs the SAP-relative API path can write through the same `baseUrl`.

## Important

This does not magically make every SAP API writable. Each SAP API/entity must expose the requested write operation and the BTP destination technical user must have the required authorization. If SAP returns 405/403/409/412, that is the SAP API/business/authorization/concurrency response and should be fixed at that layer.

SAP documentation confirms that Maintenance Order supports PATCH and explicit status actions such as submit, approve, reject, and release. Release activates system status REL; approval activates ORAP. See the SAP Help links in the main response.
