import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  LETTERBOXD_URL: z.string().url().optional(),
  LETTERBOXD_URLS: z.string().optional(),
  PORT: z.string().default('3000').transform(Number).pipe(z.number().min(1).max(65535)),
  SEERR_API_URL: z.string(),
  SEERR_API_KEY: z.string(),
  DATA_DIR: z.string().default('/data'),
  MEDIA_MOUNT_SENTINEL: z.string().optional().default('/mnt/media/.MOUNT_OK'),
  CHECK_INTERVAL_MINUTES: z.string().default('10').transform(Number).pipe(z.number().min(10)),
  LETTERBOXD_TAKE_AMOUNT: z.string().optional().transform(val => val ? Number(val) : undefined).pipe(z.number().positive().optional()),
  LETTERBOXD_TAKE_STRATEGY: z.enum(['oldest', 'newest']).optional(),
  DRY_RUN: z.string().default('false').transform(val => val.toLowerCase() === 'true'),
  FLARESOLVERR_URL: z.string().optional(),
  BYPARR_URL: z.string().optional()
}).refine(data => {
  const hasTakeAmount = data.LETTERBOXD_TAKE_AMOUNT !== undefined;
  const hasTakeStrategy = data.LETTERBOXD_TAKE_STRATEGY !== undefined;

  if (hasTakeAmount && !hasTakeStrategy) return false;
  if (hasTakeStrategy && !hasTakeAmount) return false;

  return true;
}, {
  message: 'When using movie limiting, both LETTERBOXD_TAKE_AMOUNT and LETTERBOXD_TAKE_STRATEGY must be specified',
  path: ['LETTERBOXD_TAKE_AMOUNT', 'LETTERBOXD_TAKE_STRATEGY'],
}).refine(data => {
  const hasUrl = data.LETTERBOXD_URL !== undefined;
  const hasUrls = data.LETTERBOXD_URLS !== undefined && data.LETTERBOXD_URLS.trim().length > 0;
  return (hasUrl && !hasUrls) || (!hasUrl && hasUrls);
}, {
  message: 'Exactly one of LETTERBOXD_URL or LETTERBOXD_URLS must be set',
  path: ['LETTERBOXD_URL', 'LETTERBOXD_URLS'],
}).transform(data => {
  const letterboxdUrls = data.LETTERBOXD_URLS
    ? data.LETTERBOXD_URLS.split(',').map((u: string) => u.trim()).filter(Boolean)
    : [data.LETTERBOXD_URL!];

  return { ...data, letterboxdUrls };
});

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('Environment validation failed:');
    result.error.issues.forEach(error => {
      console.error(`- ${error.path.join('.')}: ${error.message}`);
    });
    process.exit(1);
  }

  return result.data;
}

const env = validateEnv();
export default env;
