const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');

const pool = new Pool({
    connectionString: process.env.POSTGRESQL,
});

const adapter = new PrismaPg(pool);

/** @type {import('prisma/config').PrismaConfig} */
module.exports = {
    schema: './prisma/schema.prisma',
    migrate: {
        adapter,
    },
};