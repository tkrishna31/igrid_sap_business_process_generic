# Current confirmed environment

Based on the supplied screenshots/logs:

- SAP S/4HANA On-Premise 2022
- S4CORE 107
- SAP_BASIS 757
- SAP_GWFND 757
- Existing BTP Destination: `ABAP_TOOL_CC`
- Destination Type: HTTP
- ProxyType: OnPremise
- Virtual URL: `http://mtsap:8000`
- Authentication: BasicAuthentication
- Cloud Connector route previously verified reachable
- CAP is deployed in SAP BTP Cloud Foundry us10-001

Confirmed through CAP logs/API responses:
- API_MAINTENANCEORDER can return HTTP 200
- API_MAINTNOTIFICATION can return records through the compatibility rewrite
- API_EQUIPMENT can return HTTP 200
- API_MATERIAL_STOCK_SRV can return HTTP 200
- API_SUPPLIERINVOICE_PROCESS_SRV can return entities according to the supplied iGrid response
- API_SERVICE_REQUEST_SRV has returned HTTP 200 but may be slow

The existing iGrid backend has shown active mapping for Work Orders and Notifications, while Assets/Inventory/Invoices have returned `mapping profile ... pending activation` after successful SAP retrieval.
