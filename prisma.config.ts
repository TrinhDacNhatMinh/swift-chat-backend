import { defineConfig } from 'prisma/config';
import { loadEnvFile } from './config/env';

loadEnvFile();

const databaseUrl = process.env.POSTGRESQL;
if (!databaseUrl) throw new Error('POSTGRESQL environment variable is not set');

export default defineConfig({
  schema: './prisma/schema.prisma',
  migrations: {
    seed: 'ts-node ./prisma/seed-frontend.ts',
  },
  datasource: {
    url: databaseUrl,
  },
});
