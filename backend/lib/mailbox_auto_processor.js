import { claimMailboxMessageForProcessing, listPendingMailboxMessagesForProcessing } from "./mailbox_index.js";

function boolValue(value, fallback = false) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return fallback;
  return ["1", "true", "yes", "on", "si"].includes(normalized);
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function createMailboxAutoProcessor({
  getSettings,
  processMailboxMessage,
  findProcessingEventByExternalEmailId,
  onAcceptedMail,
}) {
  let timer = null;
  let running = false;
  let status = {
    running: false,
    enabled: false,
    last_started_at: null,
    last_finished_at: null,
    last_error: null,
    last_result: null,
  };

  async function resolveSettings() {
    const settings = await getSettings();
    return {
      enabled: boolValue(
        process.env.MAILBOX_AUTO_PROCESS_ENABLED || settings.mailbox_auto_process_enabled,
        false
      ),
      intervalSeconds: positiveInt(
        process.env.MAILBOX_AUTO_PROCESS_INTERVAL_SECONDS || settings.mailbox_auto_process_interval_seconds,
        120
      ),
      batchLimit: positiveInt(
        process.env.MAILBOX_AUTO_PROCESS_LIMIT || settings.mailbox_auto_process_limit,
        3
      ),
    };
  }

  function schedule(seconds) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => runOnce({ reschedule: true }), Math.max(30, seconds) * 1000);
    timer.unref?.();
  }

  async function runOnce({ force = false, reschedule = false } = {}) {
    if (running) return { ok: true, busy: true, status };
    const settings = await resolveSettings();
    status = { ...status, enabled: settings.enabled };
    if (!force && !settings.enabled) {
      if (reschedule) schedule(settings.intervalSeconds);
      return { ok: true, enabled: false, processed: 0 };
    }

    running = true;
    status = {
      ...status,
      running: true,
      last_started_at: new Date().toISOString(),
      last_error: null,
    };

    const processed = [];
    const failed = [];
    try {
      const candidates = await listPendingMailboxMessagesForProcessing({ limit: settings.batchLimit });
      for (const message of candidates) {
        try {
          const claimed = await claimMailboxMessageForProcessing(message);
          if (!claimed) continue;
          const result = await processMailboxMessage({
            getSettings,
            findProcessingEventByExternalEmailId,
            onAcceptedMail,
            uid: claimed.uid,
            messageId: claimed.id || claimed.message_id,
            force: true,
          });
          if (result.ok === false) {
            failed.push({ uid: claimed.uid, subject: claimed.subject, error: result.error || "Errore sconosciuto" });
          } else {
            processed.push({ uid: claimed.uid, subject: claimed.subject, event_id: result.event_id || null });
          }
        } catch (error) {
          failed.push({ uid: message.uid, subject: message.subject, error: error.message || String(error) });
        }
      }

      const result = {
        candidates: candidates.length,
        processed: processed.length,
        failed: failed.length,
        processed_items: processed,
        failed_items: failed,
      };
      status = {
        ...status,
        running: false,
        last_finished_at: new Date().toISOString(),
        last_result: result,
        last_error: failed.length ? `${failed.length} mail non processate` : null,
      };
      return { ok: true, enabled: settings.enabled, ...result };
    } catch (error) {
      status = {
        ...status,
        running: false,
        last_finished_at: new Date().toISOString(),
        last_error: error.message || String(error),
      };
      return { ok: false, error: status.last_error };
    } finally {
      running = false;
      status = { ...status, running: false };
      if (reschedule) schedule(settings.intervalSeconds);
    }
  }

  return {
    start({ delaySeconds = 30 } = {}) {
      schedule(delaySeconds);
    },
    runNow() {
      return runOnce({ force: true, reschedule: false });
    },
    getStatus() {
      return status;
    },
    stop() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
