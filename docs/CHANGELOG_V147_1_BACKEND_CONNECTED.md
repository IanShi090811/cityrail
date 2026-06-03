# v147.1 backend connected

- Keeps v147 Apple-style tutorial.
- Keeps Cloudflare Pages Functions payment backend.
- Adds /api/health diagnostics for KV/env readiness.
- Improves frontend payment error detail instead of generic backend-not-started message.
- Sends Xunhupay create-order request as application/x-www-form-urlencoded for better gateway compatibility.
- Does not change simulation, ATS, train, passenger-flow, line config, or control-center logic.
