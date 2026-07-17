import { PrismaClient } from "@prisma/client";

let prisma = null;

export function getPrismaClient() {
  if (!prisma) {
    prisma = new PrismaClient();
  }
  return prisma;
}
