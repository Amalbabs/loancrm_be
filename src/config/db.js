import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error']
});

export const connectDB = async () => {
  try {
    await prisma.$connect();
    console.log('[Database] Prisma connected to PostgreSQL successfully.');
    return true;
  } catch (error) {
    console.error('[Database Error] Failed to connect via Prisma:', error.message);
    return false;
  }
};

prisma.connectDB = connectDB;

export default prisma;
export { prisma };
