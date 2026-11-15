# Vercel GPU connection

The production frontend is https://fact-trace-alpha.vercel.app.

Browser requests use `/api/generate`. The frontend's `middleware.js` forwards
only the synthesis API routes to `GEN_API_ORIGIN` over HTTPS and adds the
server-only `GEN_API_TOKEN`. Neither value needs to be added to client code;
the token must never use a `VITE_` prefix or be committed to Git.

Required Vercel Production environment variables:

- `VITE_GEN_API_BASE=/api/generate`
- `VITE_GEN_MOCK=false`
- `GEN_API_ORIGIN=https://112.175.148.181`
- `GEN_API_TOKEN`: service key matching the GPU server's private `api.env`

On the GPU host, `launch-api.sh` loads the private, mode-600 `api.env` and
starts the single-worker API. Service authentication is enabled. There is no
hourly submission limit; the existing four-job admission limit prevents GPU
overload, and accepted jobs run one at a time.

The GPU host serves HTTPS directly on its fixed public IP. Caddy obtains and
automatically renews a public Let's Encrypt IP certificate with the
`shortlived` ACME profile. Keep inbound TCP 80 and 443 reachable for certificate
validation and HTTPS. No temporary tunnel address is used.

The installed systemd services `facttrace-gpu` and `facttrace-https` are enabled
at boot and restart five seconds after process exit. They run as `pukyong`;
only the HTTPS gateway has permission to bind low ports. The API listens on
127.0.0.1:8002, and unauthenticated HTTPS requests return 401. Deployment files
are in `deploy/`; installed copies and Caddy data are under
`/home/pukyong/FactTraceAI_gpu`, and unit files are in `/etc/systemd/system`.

There is no idle shutdown for this synthesis service. Model startup and video
processing still take time. A server power outage, network failure, or service
restart can interrupt an active synthesis job; automatic restart restores the
service but does not resume an interrupted job. The separate Modal detection
service retains its own cold-start behavior.

Check service status using `systemctl status facttrace-gpu facttrace-https`.
HTTPS logs: `journalctl -u facttrace-https`; API logs:
`/home/pukyong/FactTraceAI_gpu/api.log`. Restart only when there are no active
jobs. Verify with GET requests rather than launching a synthesis for monitoring.

To replace template videos, copy MP4 files to the GPU server's
`/home/pukyong/FactTraceAI_gpu/video-generation/templates/` directory and refresh
the page. The local `video-generation/templates/` folder is not automatically
synced by Vercel deployment. Videos and the service key stay out of Git and
Vercel uploads.

For local development, the Vite server can attach the server-only
`GEN_API_TOKEN` when it is present in an ignored development environment file.
Its proxy target remains `GEN_API_ORIGIN`, or the local SSH tunnel by default.

Validate the deployed `/api/generate/health`, `/api/generate/templates`, and a
video Range request. Do not submit a synthesis job just to check deployment.
