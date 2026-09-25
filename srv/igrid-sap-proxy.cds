// srv/igrid-sap-proxy.cds
@path    : '/odata/v4/igrid-sap-proxy'
@requires: 'system-user'
service IGridSAPProxyService {
  type ConnectionResult {
    ok              : Boolean;
    destinationName : String;
    message         : String;
  }

  function status()                    returns ConnectionResult;
  action   testConnection()            returns ConnectionResult;
  action   testSapConnection()         returns String;
  action   testSapConnectionResolved() returns String;
}
