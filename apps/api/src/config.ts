import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { z } from 'zod';

loadEnv({ path: resolve(import.meta.dirname, '../../../.env') });

const envSchema = z.object({
  DATABASE_URL: z.string().optional(),
  DATABASE_PRIVATE_URL: z.string().optional(),
  POSTGRES_URL: z.string().optional(),
  POSTGRES_PRISMA_URL: z.string().optional(),
  PORT: z.string().default('4000'),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  JWT_SECRET: z.string().min(16),
  S3_REGION: z.string().optional().default('us-east-1'),
  S3_ENDPOINT: z.string().optional().default(''),
  S3_BUCKET: z.string().optional().default(''),
  S3_ACCESS_KEY_ID: z.string().optional().default(''),
  S3_SECRET_ACCESS_KEY: z.string().optional().default(''),
  S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).optional().default('false'),
  GOOGLE_CLIENT_ID: z.string().optional().default(''),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(''),
  GOOGLE_REDIRECT_URI: z.string().optional().default('')
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  console.error('Invalid environment configuration', result.error.flatten().fieldErrors);
  process.exit(1);
}

const resolvedDatabaseUrl =
  result.data.DATABASE_URL?.trim() ||
  result.data.DATABASE_PRIVATE_URL?.trim() ||
  result.data.POSTGRES_URL?.trim() ||
  result.data.POSTGRES_PRISMA_URL?.trim() ||
  '';

if (!resolvedDatabaseUrl) {
  console.error(
    'Invalid environment configuration',
    {
      DATABASE_URL: [
        'Required. Set one of DATABASE_URL, DATABASE_PRIVATE_URL, POSTGRES_URL, or POSTGRES_PRISMA_URL.'
      ]
    }
  );
  process.exit(1);
}

export const env = {
  databaseUrl: resolvedDatabaseUrl,
  port: Number(result.data.PORT),
  clientOrigin: result.data.CLIENT_ORIGIN,
  nodeEnv: result.data.NODE_ENV,
  jwtSecret: result.data.JWT_SECRET,
  s3Region: result.data.S3_REGION,
  s3Endpoint:
    result.data.S3_ENDPOINT || `https://s3.${result.data.S3_REGION}.amazonaws.com`,
  s3Bucket: result.data.S3_BUCKET,
  s3AccessKeyId: result.data.S3_ACCESS_KEY_ID,
  s3SecretAccessKey: result.data.S3_SECRET_ACCESS_KEY,
  s3ForcePathStyle: result.data.S3_FORCE_PATH_STYLE === 'true',
  s3Enabled: Boolean(
    result.data.S3_BUCKET && result.data.S3_ACCESS_KEY_ID && result.data.S3_SECRET_ACCESS_KEY
  ),
  googleClientId: result.data.GOOGLE_CLIENT_ID,
  googleClientSecret: result.data.GOOGLE_CLIENT_SECRET,
  googleRedirectUri: result.data.GOOGLE_REDIRECT_URI,
  googleEnabled: Boolean(
    result.data.GOOGLE_CLIENT_ID && result.data.GOOGLE_CLIENT_SECRET && result.data.GOOGLE_REDIRECT_URI
  )
};
