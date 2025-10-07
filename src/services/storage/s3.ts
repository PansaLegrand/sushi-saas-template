import { S3Client, DeleteObjectCommand, HeadObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { StorageAdapter } from "@/services/storage/adapter";

function getEnvFlag(name: string, def = false): boolean {
  const v = process.env[name];
  if (!v) return def;
  const s = v.toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

function getS3Client(): S3Client {
  const region = process.env.S3_REGION || process.env.STORAGE_REGION || "auto";
  const endpoint = process.env.S3_ENDPOINT || process.env.STORAGE_ENDPOINT || undefined; // e.g., https://<accountid>.r2.cloudflarestorage.com
  const forcePathStyle = getEnvFlag("S3_FORCE_PATH_STYLE", !!endpoint);

  return new S3Client({
    region,
    endpoint,
    forcePathStyle,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID || process.env.STORAGE_ACCESS_KEY || "",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || process.env.STORAGE_SECRET_KEY || "",
    },
  });
}

function sanitizeFilename(filename: string): { base: string; ext: string } {
  const idx = filename.lastIndexOf(".");
  const ext = idx >= 0 ? filename.slice(idx + 1).toLowerCase().replace(/[^a-z0-9]/g, "") : "";
  const baseRaw = idx >= 0 ? filename.slice(0, idx) : filename;
  const base = baseRaw.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 64) || "file";
  return { base, ext };
}

function datePrefix(d = new Date()): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}/${mm}/${dd}`;
}

export function createS3Adapter(): StorageAdapter {
  const bucket = process.env.S3_BUCKET || process.env.STORAGE_BUCKET || "";
  if (!bucket) throw new Error("S3_BUCKET must be set");

  const client = getS3Client();
  const provider = (process.env.STORAGE_PROVIDER || "s3").toLowerCase();

  return {
    provider,
    getDefaultBucket() {
      return bucket;
    },
    buildObjectKey({ userUuid, filename }) {
      const { base, ext } = sanitizeFilename(filename);
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const prefix = datePrefix();
      const extPart = ext ? `.${ext}` : "";
      return `uploads/${userUuid}/${prefix}/${id}-${base}${extPart}`;
    },
    async getPresignedUpload({ bucket, key, contentType, size, checksumSha256, metadata, expiresIn = 900 }) {
      const cmd = new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: contentType,
        // Private by default; R2 ignores ACL but S3 supports it.
        ACL: "private",
        ContentLength: size,
        ChecksumSHA256: checksumSha256,
        Metadata: metadata,
      });
      const url = await getSignedUrl(client, cmd, { expiresIn });
      return {
        fileUuid: "", // filled by caller
        bucket,
        key,
        uploadUrl: url,
        method: "PUT" as const,
        headers: {
          "Content-Type": contentType,
          ...(checksumSha256 ? { "x-amz-checksum-sha256": checksumSha256 } : {}),
        },
        expiresIn,
      };
    },
    async getPresignedDownload({ bucket, key, filename, expiresIn = 900, responseContentType }) {
      const cmd = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ResponseContentType: responseContentType,
        ResponseContentDisposition: filename ? `attachment; filename="${filename}"` : undefined,
      });
      const url = await getSignedUrl(client, cmd, { expiresIn });
      return { url, expiresIn };
    },
    async headObject({ bucket, key }) {
      try {
        const res = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return {
          size: Number(res.ContentLength || 0),
          etag: res.ETag || undefined,
          contentType: res.ContentType || undefined,
          checksumSHA256: res.ChecksumSHA256 || undefined,
          storageClass: res.StorageClass || undefined,
        };
      } catch (err) {
        return null;
      }
    },
    async deleteObject({ bucket, key }) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}
