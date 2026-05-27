const databaseUrl =
    process.env.POSTGRESQL ||
    'postgresql://mock:mock@localhost:5432/mock?schema=public';

/** @type {import('prisma/config').PrismaConfig} */
module.exports = {
    schema: './prisma/schema.prisma',
    datasource: {
        url: databaseUrl,
    },
};