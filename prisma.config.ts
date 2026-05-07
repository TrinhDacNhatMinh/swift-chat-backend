import { defineConfig } from 'prisma/config';
import { config } from 'dotenv';

// Load the appropriate .env file based on NODE_ENV, default to development
config({ path: `.env.${process.env.NODE_ENV || 'development'}` });

const databaseUrl = process.env.POSTGRESQL;
if (!databaseUrl) throw new Error('POSTGRESQL environment variable is not set');

export default defineConfig({
  schema: './prisma/schema.prisma',
  datasource: {
    url: databaseUrl,
  },
});
