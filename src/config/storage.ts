export const STORAGE_UPLOAD_POLICY_IDS = [
  "general",
  "images",
  "documents",
  "verified",
] as const;

export type StorageUploadPolicyId = (typeof STORAGE_UPLOAD_POLICY_IDS)[number];
export type StorageUploadVisibility = "private" | "org" | "public";

export type StorageUploadPolicy = {
  id: StorageUploadPolicyId;
  label: string;
  allowedContentTypes: readonly string[];
  allowedExtensions: readonly string[];
  maxFileMb?: number;
  requireChecksum: boolean;
};

const IMAGE_CONTENT_TYPES = [
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

const IMAGE_EXTENSIONS = [".avif", ".gif", ".jpeg", ".jpg", ".png", ".webp"] as const;

const DOCUMENT_CONTENT_TYPES = [
  "application/json",
  "application/msword",
  "application/pdf",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/csv",
  "text/markdown",
  "text/plain",
] as const;

const DOCUMENT_EXTENSIONS = [
  ".csv",
  ".doc",
  ".docx",
  ".json",
  ".md",
  ".pdf",
  ".ppt",
  ".pptx",
  ".txt",
  ".xls",
  ".xlsx",
] as const;

const ARCHIVE_CONTENT_TYPES = [
  "application/zip",
  "application/x-zip-compressed",
] as const;

const ARCHIVE_EXTENSIONS = [".zip"] as const;

const GENERAL_CONTENT_TYPES = [
  ...IMAGE_CONTENT_TYPES,
  ...DOCUMENT_CONTENT_TYPES,
  ...ARCHIVE_CONTENT_TYPES,
] as const;

const GENERAL_EXTENSIONS = [
  ...IMAGE_EXTENSIONS,
  ...DOCUMENT_EXTENSIONS,
  ...ARCHIVE_EXTENSIONS,
] as const;

export const DEFAULT_STORAGE_UPLOAD_POLICY_ID = "general" satisfies StorageUploadPolicyId;

export const STORAGE_UPLOAD_POLICIES = {
  general: {
    id: "general",
    label: "General files",
    allowedContentTypes: GENERAL_CONTENT_TYPES,
    allowedExtensions: GENERAL_EXTENSIONS,
    requireChecksum: false,
  },
  images: {
    id: "images",
    label: "Images",
    allowedContentTypes: IMAGE_CONTENT_TYPES,
    allowedExtensions: IMAGE_EXTENSIONS,
    maxFileMb: 10,
    requireChecksum: false,
  },
  documents: {
    id: "documents",
    label: "Documents",
    allowedContentTypes: DOCUMENT_CONTENT_TYPES,
    allowedExtensions: DOCUMENT_EXTENSIONS,
    requireChecksum: false,
  },
  verified: {
    id: "verified",
    label: "Verified files",
    allowedContentTypes: GENERAL_CONTENT_TYPES,
    allowedExtensions: GENERAL_EXTENSIONS,
    requireChecksum: true,
  },
} satisfies Record<StorageUploadPolicyId, StorageUploadPolicy>;

export function isStorageUploadPolicyId(
  value: unknown
): value is StorageUploadPolicyId {
  return (
    typeof value === "string" &&
    STORAGE_UPLOAD_POLICY_IDS.includes(value as StorageUploadPolicyId)
  );
}

export function getStorageUploadPolicy(
  policyId: StorageUploadPolicyId = DEFAULT_STORAGE_UPLOAD_POLICY_ID
): StorageUploadPolicy {
  return STORAGE_UPLOAD_POLICIES[policyId];
}

export function normalizeContentType(contentType: string): string {
  return contentType.split(";")[0]?.trim().toLowerCase() ?? "";
}

export function extensionForFilename(filename: string): string {
  const basename = filename.split(/[\\/]/).pop() ?? filename;
  const dot = basename.lastIndexOf(".");
  if (dot < 0 || dot === basename.length - 1) return "";

  return `.${basename.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "")}`;
}

export function acceptStringForUploadPolicy(policy: StorageUploadPolicy): string {
  return [...policy.allowedContentTypes, ...policy.allowedExtensions].join(",");
}

export function isSha256Checksum(value: string): boolean {
  return /^[A-Za-z0-9+/]{43}=$/.test(value.trim());
}

export function matchesAcceptToken(params: {
  token: string;
  filename: string;
  contentType: string;
}): boolean {
  const token = params.token.trim().toLowerCase();
  if (!token) return false;

  const contentType = normalizeContentType(params.contentType);
  if (token.startsWith(".")) {
    return extensionForFilename(params.filename) === token;
  }

  if (token.endsWith("/*")) {
    return contentType.startsWith(token.slice(0, -1));
  }

  return contentType === token;
}

export function isAllowedUploadType(
  policy: StorageUploadPolicy,
  params: { filename: string; contentType: string }
): boolean {
  const contentType = normalizeContentType(params.contentType);
  const extension = extensionForFilename(params.filename);

  const contentTypeAllowed = policy.allowedContentTypes.includes(contentType);
  const extensionAllowed =
    extension === "" || policy.allowedExtensions.includes(extension);

  return contentTypeAllowed && extensionAllowed;
}
