$urls = @(
  @{ Url = 'http://127.0.0.1:8765/'; Label = 'Client' },
  @{ Url = 'http://127.0.0.1:8787/api/health'; Label = 'API' },
  @{ Url = 'http://127.0.0.1:8765/api/health'; Label = 'API (client URL)' }
)
foreach ($u in $urls) {
  try {
    $r = Invoke-WebRequest -Uri $u.Url -UseBasicParsing -TimeoutSec 5
    "{0}: HTTP {1}" -f $u.Label, $r.StatusCode
  } catch {
    "{0}: {1}" -f $u.Label, $_.Exception.Message
  }
}
