import 'dotenv/config'
import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import { PrismaClient } from "../generated/prisma/client";

//@ts-ignore
BigInt.prototype.toJSON = function () {
    return Number(this.toString());
};

// Parse the DATABASE_URL to extract connection details
const databaseUrl = process.env.DATABASE_URL || '';
const url = new URL(databaseUrl);

const adapter = new PrismaMariaDb({
    host: url.hostname,
    port: parseInt(url.port) || 3306,
    user: url.username,
    password: url.password,
    database: url.pathname.slice(1), // Remove leading /
});

const dbContext = new PrismaClient({ adapter });

export default dbContext;
