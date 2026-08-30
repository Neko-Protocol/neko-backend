# Observability config

Machine-readable configuration for the RPC gateway's monitoring. Versioned
here, rather than living only in a Grafana account, so it can be reviewed in
a pull request and recreated from scratch.

| File                     | What                                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `grafana-dashboard.json` | 12-panel dashboard. Import via **Dashboards → Import**; the `uid` is stable, so re-importing overwrites rather than duplicating |
| `alert-rules.yaml`       | The four alert rules in Grafana provisioning format. Replace `<DATASOURCE_UID>` and `<FOLDER_UID>` before applying              |

## Scraping

The backend exposes Prometheus text at `GET /metrics`, protected by a bearer
token (`METRICS_SCRAPE_TOKEN`). With the token unset the endpoint refuses
everything rather than defaulting open — the exposition leaks traffic shape
and upstream endpoint names.

Grafana Cloud scrapes it agentlessly: **Connections → Add new connection →
Metrics Endpoint**, bearer auth, token without the `Bearer ` prefix, 60s
interval. Grafana Cloud refuses an unauthenticated target, so the token is a
requirement rather than a precaution.

The registry is empty until the first health sweep, about 20 seconds after
boot. Testing the connection immediately after a deploy returns 200 with no
series.

## Two conventions that carry meaning

`outcome="cached"` is tracked separately from `"ok"`. Folding them together
would make the cache look like it improved upstream latency when it actually
avoided the call, so panels measuring real provider latency filter to
`outcome="ok"`.

`neko_rpc_endpoint_up` is 1 for a degraded endpoint. Degraded means stale but
still serving, last in line — not out of rotation. The `state` label carries
the distinction the gauge alone cannot.
