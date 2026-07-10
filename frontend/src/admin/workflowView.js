function hasExtractedData(event) {
  return Boolean(event.result?.extracted?.annuncio || event.result?.extracted?.proposta);
}

function mailingStatus(event) {
  const documentEmail = event.result?.document_email || {};
  const message = documentEmail.status || "";
  const steps = event.steps || [];
  if (message === "sent" || steps.some((step) => /Automatic document email sent|Document email sent/i.test(step.message || ""))) {
    return "done";
  }
  if (
    ["failed", "skipped"].includes(message) ||
    steps.some((step) => /Automatic document email failed|Document email failed/i.test(step.message || ""))
  ) {
    return "failed";
  }
  if (event.result?.merged) return "pending";
  return "blocked";
}

function workflowStateLabel(state) {
  return {
    done: "Completato",
    failed: "Errore",
    blocked: "Bloccato",
    pending: "In attesa",
  }[state] || state;
}

const workflowSteps = [
  {
    key: "mail",
    label: "Mail",
    icon: "mail",
    done: (event) => Boolean(event.received_at || event.steps?.some((step) => /request received/i.test(step.message))),
    failed: () => false,
  },
  {
    key: "ocr",
    label: "OCR",
    icon: "document_scanner",
    done: (event) => event.steps?.some((step) => /ocr completed/i.test(step.message)) || hasExtractedData(event),
    failed: (event) => event.steps?.some((step) => step.level === "error" && /ocr/i.test(step.message)),
  },
  {
    key: "scraper",
    label: "Scraper",
    icon: "fact_check",
    done: hasExtractedData,
    failed: (event) =>
      event.steps?.some((step) => step.level === "error" && /scraper|extraction|estrazione/i.test(step.message)) ||
      event.status === "failed",
  },
  {
    key: "mailing",
    label: "Mailing",
    icon: "outgoing_mail",
    done: (event) => mailingStatus(event) === "done",
    failed: (event) => mailingStatus(event) === "failed",
  },
  {
    key: "complete",
    label: "Completo",
    icon: "task_alt",
    done: (event) =>
      (event.status === "completed" || Boolean(event.result?.ready_for_zapier)) &&
      mailingStatus(event) === "done",
    failed: (event) => event.status === "failed",
  },
];

export function renderWorkflowStatus(event) {
  const selectedStatus = document.getElementById("selectedStatus");
  if (!selectedStatus) return;
  selectedStatus.innerHTML = "";
  selectedStatus.className = "workflow-status";
  selectedStatus.setAttribute("aria-label", `Stato lavorazione: ${event.status}`);

  let blocked = false;
  workflowSteps.forEach((step, index) => {
    const failed = !blocked && step.failed(event);
    const done = !blocked && !failed && step.done(event);
    const state = failed ? "failed" : blocked ? "blocked" : done ? "done" : "pending";
    if (failed) blocked = true;

    const item = document.createElement("div");
    item.className = `workflow-step ${state}`;
    item.title = `${step.label}: ${workflowStateLabel(state)}`;

    const circle = document.createElement("span");
    circle.className = "workflow-circle";
    const icon = document.createElement("span");
    icon.className = "material-symbols-outlined";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = state === "done" ? "check" : state === "failed" ? "close" : state === "blocked" ? "lock" : step.icon;
    circle.appendChild(icon);

    const label = document.createElement("span");
    label.className = "workflow-label";
    label.textContent = step.label;

    item.append(circle, label);
    selectedStatus.appendChild(item);

    if (index < workflowSteps.length - 1) {
      const connector = document.createElement("span");
      connector.className = `workflow-connector ${state === "done" ? "done" : failed ? "failed" : ""}`;
      selectedStatus.appendChild(connector);
    }
  });
}
