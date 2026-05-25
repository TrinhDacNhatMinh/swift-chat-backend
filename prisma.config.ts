import { defineConfig } from 'prisma/config';
import { loadEnvFile } from './config/env';

loadEnvFile();

const databaseUrl = process.env.POSTGRESQL || 'postgresql://mock:mock@localhost:5432/mock?schema=public';

export default defineConfig({
  schema: './prisma/schema.prisma',
  datasource: {
    url: databaseUrl,
  },
});
