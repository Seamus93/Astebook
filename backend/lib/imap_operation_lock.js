let chain = Promise.resolve();

export async function runExclusiveImapOperation(operation) {
  const previous = chain;
  let release;
  chain = new Promise((resolve) => {
    release = resolve;
  });
  await previous.catch(() => {});
  try {
    return await operation();
  } finally {
    release();
  }
}

export function isTransientImapError(error) {
  const message = String(error?.message || error || "");
  return error?.code === "NoConnection" || /connection not available|no connection/i.test(message);
}

export async function withImapRetries(operation, { attempts = 2, delayMs = 600 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await runExclusiveImapOperation(operation);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isTransientImapError(error)) break;
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }
  throw lastError;
}
