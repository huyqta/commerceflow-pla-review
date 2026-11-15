# Test matrix

| Case | Scope | Negative path | Owner issue |
|---|---|---|---|
| quantity <= 0 | unit domain | reject | CF-006 |
| concurrent reserve stock=1 | DB integration | one succeeds | CF-014 |
| invalid auth | API integration | 401/403 | CF-016 |
| duplicate eventId | messaging integration | one side effect | CF-021 |
| payment failed | Saga integration | release + cancel | CF-022 |
| pending order UI | E2E | no false confirmation | CF-026/027 |
| cold start/rollback | cloud lab | recovery evidence | CF-035 |
