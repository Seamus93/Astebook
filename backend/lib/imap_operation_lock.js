let chain = Promise.resolve();

function withTimeout(promise, timeoutMs, label) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timeout dopo ${timeoutMs}ms`)), timeoutMs).unref?.();
    }),
  ]);
}

export async function runExclusiveImapOperation(operation, { timeoutMs = 0 } = {}) {
  const previous = chain;
  let release;
  chain = new Promise((resolve) => {
    release = resolve;
  });
  await previous.catch(() => {});
  try {
    return await withTimeout(operation(), timeoutMs, "Operazione IMAP");
  } finally {
    release();
  }
}

export function isTransientImapError(error) {
  const message = String(error?.message || error || "");
  return error?.code === "NoConnection" || /connection not available|no connection/i.test(message);
}

export async function withImapRetries(operation, { attempts = 2, delayMs = 600, timeoutMs = 0 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await runExclusiveImapOperation(operation, { timeoutMs });
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isTransientImapError(error)) break;
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }
  throw lastError;
}
