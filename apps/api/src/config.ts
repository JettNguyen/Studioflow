import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.string().default('4000'),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  JWT_SECRET: z.string().min(16)
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  console.error('Invalid environment configuration', result.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = {
  port: Number(result.data.PORT),
  clientOrigin: result.data.CLIENT_ORIGIN,
  nodeEnv: result.data.NODE_ENV,
  jwtSecret: result.data.JWT_SECRET
};
