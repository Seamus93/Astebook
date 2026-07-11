import nodemailer from "nodemailer";

export async function getSmtpSettings(getEffectiveSetting) {
  const host = await getEffectiveSetting("SMTP_HOST", "smtp_host");
  const port = await getEffectiveSetting("SMTP_PORT", "smtp_port");
  const secure = await getEffectiveSetting("SMTP_SECURE", "smtp_secure");
  const user = await getEffectiveSetting("SMTP_USER", "smtp_user");
  const password = await getEffectiveSetting("SMTP_PASSWORD", "smtp_password");
  const from = await getEffectiveSetting("SMTP_FROM", "smtp_from");
  return {
    host: String(host || "").trim(),
    port: Number(port || 587),
    secure: String(secure || "").trim().toLowerCase() === "true",
    user: String(user || "").trim(),
    password: String(password || ""),
    from: String(from || "").trim(),
  };
}

export async function hasSmtpConfig(getEffectiveSetting) {
  const smtp = await getSmtpSettings(getEffectiveSetting);
  return Boolean(smtp.host && smtp.from);
}

export async function createSmtpTransporter(getEffectiveSetting) {
  const smtp = await getSmtpSettings(getEffectiveSetting);
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user
      ? {
          user: smtp.user,
          pass: smtp.password || "",
        }
      : undefined,
  });
}

export async function sendRecoveryEmail({ to, credentials, getEffectiveSetting }) {
  if (!(await hasSmtpConfig(getEffectiveSetting))) return false;
  const smtp = await getSmtpSettings(getEffectiveSetting);
  const transporter = await createSmtpTransporter(getEffectiveSetting);

  await transporter.sendMail({
    from: smtp.from,
    to,
    subject: "Credenziali Astebook",
    text: [
      "Credenziali di accesso Astebook:",
      "",
      `URL: ${process.env.PUBLIC_BASE_URL || "/login"}`,
      `Utente: ${credentials.username}`,
      `Password: ${credentials.password || "Non recuperabile: reimpostala dalla console admin."}`,
    ].join("\n"),
  });
  return true;
}
