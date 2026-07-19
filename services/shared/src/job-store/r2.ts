import { createReadStream, createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
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

  async getJson<T>(key: string, schema: z.ZodType<T>): Promise<T> {
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
