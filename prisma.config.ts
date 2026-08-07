import { defineConfig } from 'prisma/config';
import { loadEnvFile } from './config/env';

loadEnvFile();

// Provide a dummy connection string during Docker build (when env vars are not yet available)
const databaseUrl = process.env.POSTGRESQL || 'postgresql://dummy:dummy@localhost:5432/dummy';

export default defineConfig({
  schema: './prisma/schema.prisma',
  migrations: {
    seed: 'ts-node ./prisma/scripts/seed-frontend.ts',
  },
  datasource: {
    url: databaseUrl,
  },
});
