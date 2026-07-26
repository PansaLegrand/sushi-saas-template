# Storage Providers

Uploads use one S3-compatible adapter. AWS S3, Cloudflare R2, and MinIO all go
through the same code path in `src/services/storage/s3.ts`; the provider choice
is environment configuration, not route logic.

Use `STORAGE_PROVIDER` to document intent:

```bash
STORAGE_PROVIDER=r2      # s3 | r2 | minio
```

The adapter currently supports the storage operations this starter needs:
presigned `PUT`, presigned `GET`, `HEAD`, and `DELETE`.

## Upload Policies

Reusable upload surfaces should use the policy names in
`src/config/storage.ts`, not ad-hoc MIME checks in components:

- `general` - images, common documents, text, CSV, JSON, and ZIP files.
- `images` - image uploads only, capped at 10 MB before plan/env caps.
- `documents` - PDFs, office documents, text, CSV, Markdown, and JSON.
- `verified` - same file types as `general`, but requires a SHA-256 checksum.

The server enforces the selected policy in `POST /api/storage/uploads`.
The client may pass a narrower `accept` list, but it cannot expand what the
server allows. To add an app-specific upload surface, add a named policy in
`src/config/storage.ts` and pass that policy to the uploader.

```tsx
<Uploader
  policy="images"
  maxSizeMb={5}
  multiple={false}
  visibility="private"
  onUploaded={(file) => {
    // Attach file.uuid to your app record here.
  }}
/>
```

Available uploader props:

- `policy`: `general`, `images`, `documents`, or `verified`.
- `accept`: optional client-side picker filter, narrower than the policy.
- `maxSizeMb`: optional client-side cap, still bounded by server policy,
  deployment env, and plan limits.
- `multiple`: defaults to `true`.
- `visibility`: defaults to `private`.
- `metadata`: object or function stored with the file row.
- `checksum`: set to `sha256`, or use `policy="verified"` to default it on.
- `onUploaded` / `onUploadError`: callbacks for app workflows.

Unfinished presign reservations are marked `failed` after one hour. The presign
route cleans the current organization before quota checks, and the cron job
sweeps globally.

## R2 Quick Start

Cloudflare R2 is the easiest default for many starter-kit users because it uses
the S3 API without requiring AWS account setup. Configure it with the R2
S3-compatible endpoint, not a public bucket URL.

```bash
STORAGE_PROVIDER=r2
STORAGE_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
STORAGE_REGION=auto
STORAGE_BUCKET=<bucket-name>
STORAGE_ACCESS_KEY=<r2-access-key-id>
STORAGE_SECRET_KEY=<r2-secret-access-key>
S3_FORCE_PATH_STYLE=true
S3_USE_ACL=false
```

R2 buckets should stay private. The app serves downloads through short-lived
signed URLs.

## AWS S3

For real AWS S3, leave `STORAGE_ENDPOINT` blank and set the AWS region.

```bash
STORAGE_PROVIDER=s3
STORAGE_ENDPOINT=
STORAGE_REGION=us-east-1
STORAGE_BUCKET=<bucket-name>
STORAGE_ACCESS_KEY=<access-key-id>
STORAGE_SECRET_KEY=<secret-access-key>
S3_FORCE_PATH_STYLE=false
S3_USE_ACL=false
```

Only set `S3_USE_ACL=true` for buckets that explicitly require object ACLs.
Modern private buckets usually do not.

## MinIO

MinIO is useful for local S3-compatible testing.

```bash
STORAGE_PROVIDER=minio
STORAGE_ENDPOINT=http://localhost:9000
STORAGE_REGION=us-east-1
STORAGE_BUCKET=<bucket-name>
STORAGE_ACCESS_KEY=minioadmin
STORAGE_SECRET_KEY=minioadmin
S3_FORCE_PATH_STYLE=true
S3_USE_ACL=false
```

## CORS

Your bucket must allow the browser to upload directly with the presigned URL.
Allow your app origin, not `*`, in real environments.

```json
[
  {
    "AllowedOrigins": ["http://localhost:3000"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

Add production and preview origins as needed.

## Smoke Test

Run this after configuring any provider:

1. Start the app with the provider env set.
2. Sign in and open `/{locale}/account/files`, for example `/en/account/files`.
3. Upload a small text or image file.
4. Confirm the upload reaches `active` status in the files list.
5. Download the file through the UI and confirm the downloaded bytes match.
6. Delete the file and confirm it disappears from the list.
7. In the provider console, confirm the object is not public and cannot be read
   without a signed URL.

For a lower-level API smoke test:

1. `POST /api/storage/uploads` with `filename`, `contentType`, and `size`.
2. `PUT` the bytes to the returned `uploadUrl`.
3. `POST /api/storage/uploads/complete` with the returned `fileUuid`.
4. `GET /api/storage/files/{uuid}?download=1` and open the returned
   `downloadUrl`.
5. `DELETE /api/storage/files/{uuid}`.

Keep this flow in the release checklist for storage changes.
