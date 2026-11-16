// Vault live codes. Secrets never leave the server; this file only paints the
// digits it is given and asks again when a window rolls over.
(() => {
  const list = document.getElementById("vault-list");
  if (!list) {
    return;
  }

  const TICK_MS = 250;
  const MIN_SYNC_GAP_MS = 900;
  const rows = Array.from(list.querySelectorAll(".entry"));
  // Only the rows rendered for this page need live codes.
  const visibleIds = rows.map((row) => row.dataset.id).filter(Boolean);
  const state = new Map();
  let lastFetchMs = Date.now();
  let lastSyncMs = 0;
  let syncing = false;

  const formatCode = (code) => {
    if (code.length === 6) return `${code.slice(0, 3)} ${code.slice(3)}`;
    if (code.length === 8) return `${code.slice(0, 4)} ${code.slice(4)}`;
    return code;
  };

  const paint = (row, code, remaining, period) => {
    const digits = row.querySelector(".code-digits");
    const bar = row.querySelector(".timer-bar");
    const seconds = row.querySelector(".timer-seconds");
    if (digits && code) digits.textContent = formatCode(code);
    const ratio = period > 0 ? Math.max(0, Math.min(1, remaining / period)) : 0;
    if (bar) bar.style.width = `${ratio * 100}%`;
    if (seconds) seconds.textContent = `${Math.max(0, Math.ceil(remaining))}s`;
    row.dataset.remaining = String(remaining);
  };

  for (const row of rows) {
    const id = row.dataset.id;
    const code = row.querySelector(".code-digits")?.textContent?.replace(/\s/g, "") ?? "";
    const period = Number(row.dataset.period || 30);
    const remaining = Number(row.dataset.remaining || 0);
    if (!id) continue;
    state.set(id, { code, remaining, period });
  }

  const sync = async () => {
    if (syncing || Date.now() - lastSyncMs < MIN_SYNC_GAP_MS) return;
    syncing = true;
    lastSyncMs = Date.now();
    try {
      const query = visibleIds.length > 0 ? `?ids=${encodeURIComponent(visibleIds.join(","))}` : "";
      const response = await fetch(`/api/codes${query}`, {
        headers: { accept: "application/json" },
        credentials: "same-origin",
      });
      if (!response.ok) return;
      const data = await response.json();
      lastFetchMs = Date.now();
      for (const item of data.items) {
        const id = String(item.id);
        state.set(id, { code: item.code, remaining: item.remaining, period: item.period });
        const row = rows.find((candidate) => candidate.dataset.id === id);
        if (row) paint(row, item.code, item.remaining, item.period);
      }
    } catch {
      // Offline or server restart: keep the last painted digits, retry next tick.
    } finally {
      syncing = false;
    }
  };

  const tick = () => {
    const elapsed = (Date.now() - lastFetchMs) / 1000;
    let rollover = false;
    for (const [id, item] of state) {
      const remaining = item.remaining - elapsed;
      if (remaining <= 0.1) rollover = true;
      const row = rows.find((candidate) => candidate.dataset.id === id);
      if (row) paint(row, item.code, Math.max(0, remaining), item.period);
    }
    if (rollover) sync();
  };

  setInterval(tick, TICK_MS);

  const status = document.getElementById("copy-status");
  const announce = (message) => {
    if (!status) return;
    status.textContent = "";
    requestAnimationFrame(() => {
      status.textContent = message;
    });
  };

  const copyText = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Older browsers and plain http: fall back to a throwaway textarea.
    }
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    field.remove();
    return ok;
  };

  list.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-copy]");
    if (!button) return;
    const digits = button.querySelector(".code-digits")?.textContent?.replace(/\s/g, "");
    if (!digits) return;

    if (!(await copyText(digits))) {
      // Last resort: leave the digits selected so a long press still works.
      const range = document.createRange();
      range.selectNodeContents(button);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      announce("Kode tidak bisa disalin otomatis.");
      return;
    }

    button.classList.add("copied");
    clearTimeout(button.copyTimer);
    button.copyTimer = setTimeout(() => button.classList.remove("copied"), 1200);
    announce("Kode disalin ke clipboard.");
  });

})();

// Destructive actions ask first.
document.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  const message = form.dataset.confirm;
  if (message && !window.confirm(message)) {
    event.preventDefault();
  }
});
