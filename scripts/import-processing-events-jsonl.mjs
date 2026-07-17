import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const runtimeDir = process.env.RUNTIME_DIR || join(process.cwd(), "runtime");
const logFile = process.env.PROCESSING_LOG_FILE || join(runtimeDir, "processing-events.jsonl");

function dateOrNow(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isFinite(date.getTime()) ? date : new Date();
}

function jsonDbValue(value) {
  if (value === undefined) return undefined;
  return value === null ? Prisma.DbNull : value;
}

async function importEvent(event) {
  const steps = Array.isArray(event.steps) ? event.steps : [];
  await prisma.processingEvent.upsert({
    where: { id: event.id },
    create: {
      id: event.id,
      source: event.source || "legacy.processing_log",
      status: event.status || "received",
      metadata: jsonDbValue(event.metadata || {}),
      request: jsonDbValue(event.request || {}),
      result: jsonDbValue(event.result || null),
      error: jsonDbValue(event.error || null),
      receivedAt: dateOrNow(event.received_at),
      updatedAt: dateOrNow(event.updated_at || event.received_at),
      steps: {
        create: steps.map((step) => ({
          at: dateOrNow(step.at || event.received_at),
          level: step.level || "info",
          message: step.message || "Legacy processing step",
          data: jsonDbValue(step.data || null),
        })),
      },
    },
    update: {
      source: event.source || "legacy.processing_log",
      status: event.status || "received",
      metadata: jsonDbValue(event.metadata || {}),
      request: jsonDbValue(event.request || {}),
      result: jsonDbValue(event.result || null),
      error: jsonDbValue(event.error || null),
      receivedAt: dateOrNow(event.received_at),
      updatedAt: dateOrNow(event.updated_at || event.received_at),
      steps: {
        deleteMany: {},
        create: steps.map((step) => ({
          at: dateOrNow(step.at || event.received_at),
          level: step.level || "info",
          message: step.message || "Legacy processing step",
          data: jsonDbValue(step.data || null),
        })),
      },
    },
  });
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required.");
  }
  if (!existsSync(logFile)) {
    console.log(`No legacy processing log found at ${logFile}`);
    return;
  }

  const raw = await readFile(logFile, "utf8");
  const events = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch (error) {
        console.warn("Skipping invalid JSONL line:", error.message || String(error));
        return [];
      }
    })
    .filter((event) => event?.id);

  for (const event of events) {
    await importEvent(event);
  }
  console.log(`Imported ${events.length} processing events from ${logFile}`);
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
