function getAccessToken() {
  return localStorage.getItem("astebook_ui_token") || "";
}

export async function apiFetch(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  const token = getAccessToken();
  if (token) headers["x-astebook-token"] = token;

  let resp = await fetch(url, { ...options, headers, credentials: "same-origin" });
  if (resp.status === 401) {
    const newToken = window.prompt("Token UI Astebook") || "";
    if (newToken) {
      localStorage.setItem("astebook_ui_token", newToken);
      headers["x-astebook-token"] = newToken;
      resp = await fetch(url, { ...options, headers, credentials: "same-origin" });
    }
  }
  return resp;
}
