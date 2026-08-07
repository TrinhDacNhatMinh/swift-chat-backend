import { defineConfig } from 'prisma/config';

// Chỉ load file .env khi chạy ở local. Lên Render biến này đã có sẵn.
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config({ path: `.env.${process.env.NODE_ENV || 'development'}` });
}

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
