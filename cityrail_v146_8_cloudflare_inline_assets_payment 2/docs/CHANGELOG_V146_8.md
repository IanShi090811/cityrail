# v146.8 Cloudflare inline assets

- Inline local CSS and JS into index.html so Cloudflare Pages cannot lose /css or /js assets due to upload/output-directory issues.
- Keep original css/ and js/ files as fallback/debug copies.
- Keep Cloudflare Pages Functions payment endpoints unchanged.
