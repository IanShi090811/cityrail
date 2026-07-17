# CityRail Tencent Cloud Seoul Deployment

This project can run on Zeabur Tencent Cloud Seoul or on a Tencent Cloud Seoul CVM through the same Node server entrypoint.

## Runtime

- Node.js 20+
- Start command: `node server/server.js`
- Port: read from `PORT`
- Persistent data directory: read from `CITYRAIL_DATA_DIR`

## Required Environment Variables

```bash
PUBLIC_BASE_URL=https://your-domain.example
CITYRAIL_DATA_DIR=/data/cityrail
XHP_APPID=201906180967
XHP_APPSECRET=your-xunhupay-secret
XHP_GATEWAY=https://api.xunhupay.com/payment/do.html
CITYRAIL_PRODUCT_TITLE=CityRail都市城轨完整版
CITYRAIL_INVITE_CODE_HASHES=comma-separated-sha256-hashes
```

`PUBLIC_BASE_URL` must be the final HTTPS domain, otherwise the payment provider cannot call `/api/pay/notify`.

## Zeabur Tencent Cloud Seoul

1. Create a Zeabur project.
2. Select Tencent Cloud as the provider and Seoul as the region.
3. Connect this repository or upload the source archive.
4. Configure the environment variables above.
5. Add persistent storage and mount it at `/data/cityrail`.
6. Deploy with Dockerfile or Node start command.
7. Point the domain to the Zeabur service and enable HTTPS.

## Tencent Cloud Seoul CVM

1. Buy a Seoul CVM.
2. Install Docker or Node.js 20+.
3. Upload the project source.
4. Configure the environment variables above.
5. Start the service with either:

```bash
node server/server.js
```

or:

```bash
docker build -t cityrail .
docker run -d --name cityrail \
  -p 3001:3001 \
  -v /data/cityrail:/data/cityrail \
  --env-file /data/cityrail/.env \
  cityrail
```

6. Put Nginx or Caddy in front of port `3001`, enable HTTPS, and set the public domain as `PUBLIC_BASE_URL`.

## Functional Coverage

The Node server uses the same `functions/` modules as Cloudflare Pages, so these APIs stay aligned:

- `/api/pay/create`
- `/api/pay/notify`
- `/api/pay/status`
- `/api/login`
- `/api/check-username/:username`
- `/api/invite/verify`
- `/api/map-tile/...`
- `/api/place-name`
- `/api/city-place-data`
- `/api/workshop/...`
