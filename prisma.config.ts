import { defineConfig } from 'prisma/config';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

export default defineConfig({
    schema: './prisma/schema.prisma',
    migrate: {
        adapter: () => {
            const pool = new Pool({
                connectionString: process.env.POSTGRESQL,
            });
            return new PrismaPg(pool);
        },
    },
});