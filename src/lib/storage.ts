import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash, createHmac, randomUUID } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

export type StorageDriver = "local" | "s3";

export function buildObjectKey(organizationId: string, installationId: string, ext: string): string {
  const safeExt = ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
  return `${organizationId}/${installationId}/${randomUUID()}${safeExt}`;
}

export interface ObjectStorage {
  /**
   * URL assinada para o navegador enviar o arquivo direto ao bucket (PUT),
   * sem passar pelo servidor. null quando o driver não suporta (local).
   */
  presignPut(key: string, expiresSeconds?: number): string | null;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

const UPLOAD_DIR = path.join(process.cwd(), "uploads");

function createLocalStorage(): ObjectStorage {
  return {
    presignPut() {
      return null;
    },
    async put(key, body) {
      const fullPath = path.join(UPLOAD_DIR, key);
      await mkdir(path.dirname(fullPath), { recursive: true });
      await writeFile(fullPath, body);
    },
    async get(key) {
      return readFile(path.join(UPLOAD_DIR, key));
    },
    async delete(key) {
      try {
        await unlink(path.join(UPLOAD_DIR, key));
      } catch {
        // Arquivo já ausente — a exclusão do registro no banco é o que importa.
      }
    },
  };
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Variável de ambiente ${name} é obrigatória quando STORAGE_DRIVER=s3.`);
  }
  return value;
}

function createS3Storage(): ObjectStorage {
  const endpoint = process.env.S3_ENDPOINT?.trim() || undefined;
  const region = process.env.S3_REGION?.trim() || "us-east-1";
  const bucket = requireEnv("S3_BUCKET");
  const forcePathStyle = process.env.S3_FORCE_PATH_STYLE === "true";

  const client = new S3Client({
    region,
    endpoint,
    forcePathStyle,
    credentials: {
      accessKeyId: requireEnv("S3_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("S3_SECRET_ACCESS_KEY"),
    },
  });

  const accessKeyId = requireEnv("S3_ACCESS_KEY_ID");
  const secretAccessKey = requireEnv("S3_SECRET_ACCESS_KEY");

  return {
    presignPut(key, expiresSeconds = 3600) {
      return presignS3Put({ endpoint, region, bucket, forcePathStyle, accessKeyId, secretAccessKey, key, expiresSeconds });
    },
    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        })
      );
    },
    async get(key) {
      const result = await client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
        })
      );
      const bytes = await result.Body?.transformToByteArray();
      if (!bytes) {
        throw new Error(`Objeto vazio no storage: ${key}`);
      }
      return Buffer.from(bytes);
    },
    async delete(key) {
      try {
        await client.send(
          new DeleteObjectCommand({
            Bucket: bucket,
            Key: key,
          })
        );
      } catch {
        // Mesmo critério do driver local: ausência no bucket não bloqueia.
      }
    },
  };
}

// Assinatura AWS SigV4 por query string (presigned URL) para PUT. Feita à
// mão para não depender de mais um pacote (@aws-sdk/s3-request-presigner).
const encodeRfc3986 = (v: string) =>
  encodeURIComponent(v).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data, "utf8").digest();

export function presignS3Put(o: {
  endpoint?: string;
  region: string;
  bucket: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
  key: string;
  expiresSeconds: number;
  now?: Date;
}): string {
  const now = o.now ?? new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const base = o.endpoint ? new URL(o.endpoint) : null;
  const protocol = base ? base.protocol : "https:";
  // Mesmo comportamento do S3Client: virtual-hosted, a menos que S3_FORCE_PATH_STYLE=true.
  const pathStyle = o.forcePathStyle;
  const host = base
    ? pathStyle
      ? base.host
      : `${o.bucket}.${base.host}`
    : pathStyle
      ? `s3.${o.region}.amazonaws.com`
      : `${o.bucket}.s3.${o.region}.amazonaws.com`;
  const keyPath = o.key.split("/").map(encodeRfc3986).join("/");
  const uri = pathStyle ? `/${encodeRfc3986(o.bucket)}/${keyPath}` : `/${keyPath}`;
  const scope = `${day}/${o.region}/s3/aws4_request`;
  const query: [string, string][] = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${o.accessKeyId}/${scope}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(o.expiresSeconds)],
    ["X-Amz-SignedHeaders", "host"],
  ];
  const canonicalQuery = query
    .map(([k, v]) => [encodeRfc3986(k), encodeRfc3986(v)])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const canonicalRequest = ["PUT", uri, canonicalQuery, `host:${host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    createHash("sha256").update(canonicalRequest, "utf8").digest("hex"),
  ].join("\n");
  const kDate = hmac(`AWS4${o.secretAccessKey}`, day);
  const kSigning = hmac(hmac(hmac(kDate, o.region), "s3"), "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");
  return `${protocol}//${host}${uri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

let cached: ObjectStorage | null = null;

export function getStorage(): ObjectStorage {
  if (cached) return cached;
  const driver = (process.env.STORAGE_DRIVER?.trim().toLowerCase() || "local") as StorageDriver;
  cached = driver === "s3" ? createS3Storage() : createLocalStorage();
  return cached;
}
