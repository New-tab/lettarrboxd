import { z } from 'zod';

const DELETE_MODE_URL_PATTERN = /^https:\/\/letterboxd\.com\/[^\/]+\/films(\/diary)?\/?$/;

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  LETTERBOXD_URL: z.string().url(),
  SEERR_API_URL: z.string(),
  SEERR_API_KEY: z.string(),
  RADARR_API_URL: z.string().optional(),
  RADARR_API_KEY: z.string().optional(),
  RADARR_QUALITY_PROFILE: z.string().optional(),
  RADARR_MINIMUM_AVAILABILITY: z.string().default('released'),
  RADARR_ROOT_FOLDER_ID: z.string().optional(),
  RADARR_TAGS: z.string().optional(),
  RADARR_ADD_UNMONITORED: z.string().default('false').transform(val => val.toLowerCase() === 'true'),
  DATA_DIR: z.string().default('/data'),
  MEDIA_MOUNT_SENTINEL: z.string().default('/mnt/media/.MOUNT_OK'),
  CHECK_INTERVAL_MINUTES: z.string().default('10').transform(Number).pipe(z.number().min(10)),
  LETTERBOXD_TAKE_AMOUNT: z.string().optional().transform(val => val ? Number(val) : undefined).pipe(z.number().positive().optional()),
  LETTERBOXD_TAKE_STRATEGY: z.enum(['oldest', 'newest']).optional(),
  DRY_RUN: z.string().default('false').transform(val => val.toLowerCase() === 'true')
}).refine(data => {
  const hasTakeAmount = data.LETTERBOXD_TAKE_AMOUNT !== undefined;
  const hasTakeStrategy = data.LETTERBOXD_TAKE_STRATEGY !== undefined;
  
  // If one is specified, both must be specified
  if (hasTakeAmount && !hasTakeStrategy) {
    return false;
  }
  
  if (hasTakeStrategy && !hasTakeAmount) {
    return false;
  }
  
  return true;
}, {
  message: "When using movie limiting, both LETTERBOXD_TAKE_AMOUNT and LETTERBOXD_TAKE_STRATEGY must be specified",
  path: ["LETTERBOXD_TAKE_AMOUNT", "LETTERBOXD_TAKE_STRATEGY"]
}).superRefine((data, ctx) => {
  if (!DELETE_MODE_URL_PATTERN.test(data.LETTERBOXD_URL)) {
    return;
  }

  if (!data.RADARR_API_URL) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['RADARR_API_URL'],
      message: 'RADARR_API_URL is required when LETTERBOXD_URL is a watched/diary source',
    });
  }

  if (!data.RADARR_API_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['RADARR_API_KEY'],
      message: 'RADARR_API_KEY is required when LETTERBOXD_URL is a watched/diary source',
    });
  }
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
