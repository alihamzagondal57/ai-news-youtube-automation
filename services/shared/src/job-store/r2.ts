import { createReadStream, createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { z } from "zod";

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  /** Full R2 S3-compatible endpoint, e.g. https://<accountId>.r2.cloudflarestorage.com */
  endpoint: string;
  /**
   * Use path-style addressing (`endpoint/bucket/key`) instead of virtual-hosted
   * (`bucket.endpoint/key`). Required against a localhost S3 mock (no wildcard
   * DNS for `bucket.localhost`) and harmless against R2, which supports both.
   */
  forcePathStyle?: boolean;
}

/**
 * Thin client over the R2 bucket used to pass job artifacts between
 * pipeline steps. Every service should go through this instead of
 * talking to the S3 SDK directly, so the `jobs/{jobId}/...` key layout
 * (docs/PIPELINE.md) stays in one place.
 */
/**
 * S3-compatible stores disagree on how a missing object surfaces: the SDK may
 * raise NoSuchKey/NotFound by name, or only carry a 404 in $metadata. Check both
 * so a genuine error never gets swallowed as "absent".
 */
function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === "NoSuchKey" || e?.name === "NotFound" || e?.Code === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404;
}

export class JobStore {
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(config: R2Config) {
    const clientConfig: S3ClientConfig = {
      region: "auto",
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      // The AWS SDK's 2025 default (WHEN_SUPPORTED) adds a CRC32 trailing
      // checksum, sending streamed uploads as `aws-chunked` bodies. R2 and other
      // S3-compatible stores don't decode that framing and silently persist the
      // chunk headers into the object. WHEN_REQUIRED keeps object bodies byte-exact.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    };
    this.s3 = new S3Client(clientConfig);
    this.bucket = config.bucketName;
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): JobStore {
    const required = [
      "R2_ACCOUNT_ID",
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
      "R2_BUCKET_NAME",
      "R2_ENDPOINT",
    ] as const;
    for (const key of required) {
      if (!env[key]) {
        throw new Error(`Missing required env var: ${key}`);
      }
    }
    return new JobStore({
      accountId: env.R2_ACCOUNT_ID!,
      accessKeyId: env.R2_ACCESS_KEY_ID!,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
      bucketName: env.R2_BUCKET_NAME!,
      endpoint: env.R2_ENDPOINT!,
      forcePathStyle: env.R2_FORCE_PATH_STYLE === "true",
    });
  }

  jobKey(jobId: string, relativePath: string): string {
    return `jobs/${jobId}/${relativePath}`;
  }

  async putJson(key: string, data: unknown): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: JSON.stringify(data, null, 2),
        ContentType: "application/json",
      }),
    );
  }

  /**
   * `Schema extends z.ZodTypeAny` + `z.output<Schema>`, not the more obvious
   * `<T>(schema: z.ZodType<T>)`: ZodType is parameterized by both Output and
   * Input, and a schema with `.default(...)` on a nested field makes those
   * diverge (Input has the field optional, Output doesn't). Pinning T only via
   * `z.ZodType<T>` asks TS to infer one T from both a covariant (Output) and a
   * contravariant (Input) position at once, and it can silently resolve to the
   * wrong one — the caller ends up with an Input-shaped type that has an
   * optional field the parsed OUTPUT never actually has. Binding the whole
   * schema type and extracting Output with `z.output<>` avoids the dual-position
   * inference entirely.
   */
  async getJson<Schema extends z.ZodTypeAny>(key: string, schema: Schema): Promise<z.output<Schema>> {
    const response = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const body = await response.Body?.transformToString();
    if (body === undefined) {
      throw new Error(`Empty object body for key: ${key}`);
    }
    return schema.parse(JSON.parse(body));
  }

  /** Streams a local file up to R2 without buffering it fully in memory. */
  async putFile(key: string, localPath: string, contentType?: string): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: createReadStream(localPath),
        ContentType: contentType,
      }),
    );
  }

  /**
   * Like getJson, but returns null when the object doesn't exist instead of
   * throwing. For genuinely optional artifacts — review state, rotation history —
   * where "not written yet" is a normal first-run condition rather than an error.
   */
  async getJsonIfExists<Schema extends z.ZodTypeAny>(key: string, schema: Schema): Promise<z.output<Schema> | null> {
    try {
      return await this.getJson(key, schema);
    } catch (err) {
      if (isNotFound(err)) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Every key under a prefix, following pagination. Used by render-server to
   * discover which per-segment render chunks are already cached for a job.
   */
  async listKeys(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let continuationToken: string | undefined;
    do {
      const response = await this.s3.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: continuationToken }),
      );
      for (const item of response.Contents ?? []) {
        if (item.Key) keys.push(item.Key);
      }
      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);
    return keys;
  }

  /**
   * A short-lived, direct URL to an object — for handing the review
   * dashboard's browser client something it can point a `<video>`/`<audio>`
   * tag or clip-swap thumbnail at without proxying the bytes through the
   * dashboard's own server. Never cache this URL beyond its own expiry (the
   * signature is time-bound); callers should request a fresh one per page
   * load rather than persisting it.
   */
  async getPresignedUrl(key: string, expiresInSeconds: number): Promise<string> {
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: expiresInSeconds });
  }

  /** Downloads an R2 object to a local file, creating parent directories as needed. */
  async downloadToFile(key: string, localPath: string): Promise<void> {
    const response = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!response.Body) {
      throw new Error(`Empty object body for key: ${key}`);
    }
    await mkdir(dirname(localPath), { recursive: true });
    await pipeline(response.Body as Readable, createWriteStream(localPath));
  }
}
