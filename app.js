/* ================================================
   Planner semanal de contenidos — app.js
   SPA con hash routing:
     #/edit      → vista editora (tu novia escribe)
     #/p/<slug>  → vista lectora (la tía, solo lectura)
================================================= */

/* ══════════════════════════════════════════════
   ① CONFIGURACIÓN — editar antes de publicar
══════════════════════════════════════════════ */

const SUPABASE_URL = "https://hshtegnawkinqcfevyjw.supabase.co"; // ej: https://abc.supabase.co
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhzaHRlZ25hd2tpbnFjZmV2eWp3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0NTYyNTUsImV4cCI6MjA4ODAzMjI1NX0.K_gfNtI8L11zJPA9GBEK834TH6lLdcUeTo665qpCvfM"; // clave pública (anon)

const POLL_INTERVAL_MS = 30_000; // polling en vista lectora (ms)
const SAVE_DEBOUNCE_MS = 800; // debounce autosave (ms)

/* ══════════════════════════════════════════════
   ② CONSTANTES
══════════════════════════════════════════════ */

const DAYS = [
  { key: "mon", label: "Lunes" },
  { key: "tue", label: "Martes" },
  { key: "wed", label: "Miércoles" },
  { key: "thu", label: "Jueves" },
  { key: "fri", label: "Viernes" },
];

const BLOCKS = [
  {
    key: "stories",
    label: "Historias",
    placeholder: "· Historia 1\n· Historia 2",
  },
  { key: "feed", label: "Feed", placeholder: "· Post 1\n· Post 2" },
  {
    key: "ideas",
    label: "Ideas / Copies",
    placeholder: "· Idea de copy\n· Gancho...",
  },
];

const LS_KEY = "contentPlanner_v1";
const LS_SLUG_KEY = "contentPlanner_slug";
const LS_WRITE_KEY = "contentPlanner_writeKey";
const OLD_LS_KEYS = ["weeklyPlanner_v1"];

/* ══════════════════════════════════════════════
   ③ ESTADO EN TIEMPO DE EJECUCIÓN
══════════════════════════════════════════════ */

let sbClient = null; // Supabase client
let pollingTimer = null; // setInterval para reader
let saveTimer = null; // setTimeout para autosave
let editorState = null; // datos del editor
let activeTab = "week";
let currentSlug = null;
let writeKey = null;
let lastReaderUpdated = null; // updated_at del último fetch

/* ══════════════════════════════════════════════
   ④ ARRANQUE
══════════════════════════════════════════════ */

function init() {
  cleanupLegacy();
  initSupabase();
  window.addEventListener("hashchange", () => route());
  route();
}

function initSupabase() {
  if (!SUPABASE_URL || SUPABASE_URL === "YOUR_SUPABASE_URL") {
    console.warn("[Planner] Supabase no configurado — modo solo local.");
    return;
  }
  try {
    sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } catch (e) {
    console.error("[Planner] Error al iniciar Supabase:", e);
  }
}

/* ══════════════════════════════════════════════
   ⑤ ROUTER
══════════════════════════════════════════════ */

function route() {
  stopPolling();

  const hash = location.hash;

  if (hash.startsWith("#/p/")) {
    const slug = hash.slice(4).split("?")[0].trim();
    if (slug) {
      document.body.classList.add("view-mode");
      lastReaderUpdated = null;
      renderReaderView(slug);
      return;
    }
  }

  // Por defecto: vista editora
  document.body.classList.remove("view-mode");
  if (hash !== "#/edit") {
    history.replaceState(null, "", "#/edit");
  }
  renderEditorView();
}

/* ══════════════════════════════════════════════
   ⑥ VISTA EDITORA (#/edit)
══════════════════════════════════════════════ */

function renderEditorView() {
  editorState = loadEditorState();
  currentSlug = localStorage.getItem(LS_SLUG_KEY) || null;
  writeKey = localStorage.getItem(LS_WRITE_KEY) || null;
  activeTab = "week";
  // En móvil: mostrar el día de hoy (o lunes si es fin de semana)
  if (window.innerWidth <= 768) {
    const keyMap = { 1: "mon", 2: "tue", 3: "wed", 4: "thu", 5: "fri" };
    activeTab = keyMap[new Date().getDay()] || "mon";
  }

  document.getElementById("app").innerHTML = buildEditorHTML();

  bindEditorEvents();
  updateEditorWeekRange();
  renderBoard();
  updateSaveStatus("ok");
  updateSlugInfo();
}

function buildEditorHTML() {
  const tabs = [
    { key: "week", label: "Semana" },
    ...DAYS.map((d) => ({ key: d.key, label: d.label })),
  ];

  return /* html */ `
    <header class="topbar">
      <div class="brand">
        <div class="logo">📋</div>
        <div>
          <div class="title">Planner semanal de contenidos</div>
          <div class="subtitle" id="editorSubtitle">L – V · Organiza tu contenido</div>
        </div>
      </div>
      <div class="actions">
        <span id="saveStatus" class="save-status save-status--ok">Guardado ✓</span>
        <span id="planSlugInfo" class="plan-slug-info" style="display:none"></span>
        <button id="shareBtn" class="btn btn-share" type="button">${currentSlug ? "Copiar link de la tía" : "Crear y copiar link"}</button>
        <button id="exportPngBtn" class="btn btn-soft" type="button">Guardar imagen</button>
        <button id="exportPdfBtn" class="btn btn-primary" type="button">Exportar PDF</button>
        <button id="resetBtn" class="btn btn-danger" type="button">Reset</button>
      </div>
    </header>

    <nav class="tabs-bar" id="tabsBar">
      ${tabs
        .map(
          (t) =>
            `<button class="tab${t.key === "week" ? " active" : ""}" data-tab="${t.key}">${t.label}</button>`,
        )
        .join("")}
    </nav>

    <main class="layout">
      <div id="reportArea" class="report-area">
        <div class="report-header">
          <h1 class="report-title">Planner semanal de contenidos</h1>
          <span id="weekRangePill" class="pill">Semana: —</span>
          <div class="week-picker-wrap">
            <label class="week-picker-label" for="weekStartInput">Semana del</label>
            <input type="date" id="weekStartInput" class="week-picker-input" />
          </div>
        </div>
        <div id="board" class="board board--week"></div>
      </div>
    </main>
    <button id="floatingShareBtn" class="floating-share" type="button">↗ ${currentSlug ? "Copiar link" : "Crear link"}</button>
  `;
}

/* ── Renderiza el tablero según el tab activo ── */

function renderBoard() {
  const board = document.getElementById("board");
  if (!board) return;

  const startISO = editorState?.meta?.weekStartISO || null;
  const { dates } = getWeekDates(startISO);
  const isMobile = window.innerWidth <= 768;

  if (activeTab === "week" && !isMobile) {
    // Desktop: cuadrícula de 5 columnas
    board.className = "board board--week";
    board.innerHTML = "";
    DAYS.forEach((d, i) => board.appendChild(buildDayColumn(d, dates[i])));
  } else if (isMobile) {
    // Móvil: todos los días en el DOM, solo se muestra el activo con CSS.
    // Así el switch de día NO reconstruye el DOM → sin pérdida de foco ni scroll.
    const visibleKey = activeTab === "week" ? "mon" : activeTab;
    board.className = "board board--mobile";
    board.innerHTML = "";
    DAYS.forEach((d, i) => {
      const col = buildDayColumn(d, dates[i]);
      if (d.key !== visibleKey) col.classList.add("day--hidden");
      board.appendChild(col);
    });
  } else {
    // Desktop: vista de un solo día
    const idx = DAYS.findIndex((d) => d.key === activeTab);
    const dayDef = DAYS[idx];
    board.className = "board board--day";
    board.innerHTML = "";
    board.appendChild(buildDayColumn(dayDef, dates[idx]));
  }
}

function buildDayColumn(dayDef, dateObj) {
  const dateStr = fmtDay(dateObj);

  const col = document.createElement("div");
  col.className = "day";
  col.dataset.day = dayDef.key;
  col.innerHTML = /* html */ `
    <div class="day-header">
      <span class="day-name">${dayDef.label}</span>
      <span class="day-date">${dateStr}</span>
    </div>
  `;

  for (const b of BLOCKS) {
    const taId = `ta-${dayDef.key}-${b.key}`;

    const blockEl = document.createElement("div");
    blockEl.className = `block block-${b.key}`;

    const label = document.createElement("label");
    label.className = "block-label";
    label.setAttribute("for", taId);
    label.textContent = b.label;

    const ta = document.createElement("textarea");
    ta.id = taId;
    ta.placeholder = b.placeholder;
    ta.value = editorState.days[dayDef.key]?.[b.key] ?? "";
    ta.setAttribute("aria-label", `${dayDef.label} – ${b.label}`);

    ta.addEventListener("input", () => {
      editorState.days[dayDef.key][b.key] = ta.value;
      scheduleAutoSave();
    });

    blockEl.appendChild(label);
    blockEl.appendChild(ta);
    col.appendChild(blockEl);
  }

  return col;
}

/* ── Eventos del editor ──────────────────────── */

function bindEditorEvents() {
  // Tabs
  document.getElementById("tabsBar").addEventListener("click", (e) => {
    const btn = e.target.closest(".tab");
    if (!btn) return;
    const newTab = btn.dataset.tab;
    if (newTab === activeTab) return;
    switchToTab(newTab);
  });

  // Compartir (topbar + botón flotante móvil)
  document.getElementById("shareBtn").addEventListener("click", handleShare);
  document.getElementById("floatingShareBtn")?.addEventListener("click", handleShare);

  // Export
  document
    .getElementById("exportPngBtn")
    .addEventListener("click", () => exportEditor("png"));
  document
    .getElementById("exportPdfBtn")
    .addEventListener("click", () => exportEditor("pdf"));

  // Reset
  document.getElementById("resetBtn").addEventListener("click", () => {
    if (
      !confirm(
        "¿Borrar todo el plan local y desconectar de Supabase?\n(El plan remoto no se borra.)",
      )
    )
      return;
    editorState = defaultState();
    saveEditorLocal(editorState);
    localStorage.removeItem(LS_SLUG_KEY);
    localStorage.removeItem(LS_WRITE_KEY);
    currentSlug = null;
    writeKey = null;
    renderBoard();
    updateEditorWeekRange();
    updateSaveStatus("ok");
    updateSlugInfo();
  });

  // Date range picker
  document.getElementById("weekStartInput")?.addEventListener("change", (e) => {
    const val = e.target.value; // "YYYY-MM-DD"
    if (!val) return;

    // Parse local date and snap to Monday of that week
    const [y, m, d] = val.split("-").map(Number);
    const picked = new Date(y, m - 1, d);
    const dow = picked.getDay();
    const diffToMon = dow === 0 ? -6 : 1 - dow;
    const mon = new Date(picked);
    mon.setDate(picked.getDate() + diffToMon);

    const fri = new Date(mon);
    fri.setDate(mon.getDate() + 4);

    const monISO = toLocalISO(mon);
    const friISO = toLocalISO(fri);

    editorState.meta.weekStartISO = monISO;
    editorState.meta.weekEndISO = friISO;

    // Snap input value to Monday
    e.target.value = monISO;

    updateEditorWeekRange();
    renderBoard();
    scheduleAutoSave();
  });
}

/* ── Autosave ─────────────────────────────────── */

function scheduleAutoSave() {
  updateSaveStatus("saving");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(autoSave, SAVE_DEBOUNCE_MS);
}

async function autoSave() {
  // 1) Guardar localmente siempre
  saveEditorLocal(editorState);

  // 2) Si hay slug + writeKey, guardar en Supabase
  if (sbClient && currentSlug && writeKey) {
    try {
      await sbRpcSave(currentSlug, editorState, writeKey);
      updateSaveStatus("ok");
    } catch (e) {
      console.warn("[Planner] Error guardando en Supabase:", e.message);
      updateSaveStatus("error");
    }
  } else {
    updateSaveStatus("ok");
  }
}

/* ── Botón "Compartir con la tía" ─────────────── */

async function handleShare() {
  const btn = document.getElementById("shareBtn");
  btn.disabled = true;

  try {
    if (currentSlug) {
      // ── Plan ya existe: SIEMPRE copiar el mismo link ───────────────────────
      // Si Supabase está activo y tenemos writeKey, verificar que el registro
      // remoto siga existiendo (puede haberse borrado desde el panel).
      if (sbClient && writeKey) {
        const row = await sbSelectBySlug(currentSlug);
        if (!row) {
          // Registro borrado remotamente → recrear con MISMO slug y writeKey
          btn.textContent = "Recreando plan…";
          try {
            await sbRpcCreate(currentSlug, editorState, writeKey);
          } catch (e) {
            // "already exists" = volvió a aparecer (race condition) — ignorar
            if (
              !e.message?.includes("already exists") &&
              !e.message?.includes("duplicate")
            ) {
              throw e;
            }
          }
          showToast("Plan recreado con el mismo link. ✓", "success");
        }
      }
      await copyShareLink(currentSlug);
      showToast("¡Link copiado al portapapeles! ✓", "success");
      return;
    }

    // ── No existe plan todavía: crear uno nuevo ────────────────────────────
    if (!sbClient) {
      showToast(
        "Supabase no está configurado. Edita SUPABASE_URL y SUPABASE_ANON_KEY en app.js.",
        "error",
      );
      return;
    }

    btn.textContent = "Creando link…";
    saveEditorLocal(editorState);

    let slug = generateSlug(8);
    const wk = generateWriteKey(40);

    let attempts = 0;
    while (attempts < 3) {
      try {
        await sbRpcCreate(slug, editorState, wk);
        break;
      } catch (e) {
        if (
          e.message?.includes("already exists") ||
          e.message?.includes("duplicate")
        ) {
          slug = generateSlug(8);
          attempts++;
        } else {
          throw e;
        }
      }
    }

    currentSlug = slug;
    writeKey = wk;
    localStorage.setItem(LS_SLUG_KEY, currentSlug);
    localStorage.setItem(LS_WRITE_KEY, writeKey);
    updateSlugInfo();
    updateShareBtn();

    await copyShareLink(currentSlug);
    showToast(`Plan creado. Link copiado. ✓`, "success");
  } catch (e) {
    console.error("[Planner] Error al compartir:", e);
    showToast(
      `Error: ${e.message ?? "No se pudo crear el plan remoto."}`,
      "error",
    );
  } finally {
    btn.disabled = false;
    updateShareBtn();
  }
}

/** Sincroniza el texto de los botones de compartir con el estado actual. */
function updateShareBtn() {
  const label = currentSlug ? "Copiar link de la tía" : "Crear y copiar link";
  const floatLabel = currentSlug ? "↗ Copiar link" : "↗ Crear link";
  const btn = document.getElementById("shareBtn");
  const floatingBtn = document.getElementById("floatingShareBtn");
  if (btn) btn.textContent = label;
  if (floatingBtn) floatingBtn.textContent = floatLabel;
}

async function copyShareLink(slug) {
  const link = `${getBaseUrl()}/#/p/${slug}`;
  await navigator.clipboard.writeText(link);
  return link;
}

/* ── Helpers de UI del editor ─────────────────── */

function updateSaveStatus(status) {
  const el = document.getElementById("saveStatus");
  if (!el) return;
  const MAP = {
    ok: { cls: "save-status--ok", text: "Guardado ✓" },
    saving: { cls: "save-status--saving", text: "Guardando…" },
    error: { cls: "save-status--error", text: "Error (guardado local)" },
  };
  const cfg = MAP[status] ?? MAP.ok;
  el.className = `save-status ${cfg.cls}`;
  el.textContent = cfg.text;
}

function updateSlugInfo() {
  const el = document.getElementById("planSlugInfo");
  if (!el) return;
  if (currentSlug) {
    el.style.display = "";
    el.textContent = `Plan: ${currentSlug}`;
  } else {
    el.style.display = "none";
  }
}

function updateEditorWeekRange() {
  const startISO = editorState?.meta?.weekStartISO || null;
  const { mon, fri } = getWeekDates(startISO);

  const pill = document.getElementById("weekRangePill");
  if (pill) pill.textContent = `Semana: ${fmt(mon)} – ${fmt(fri)}`;

  const input = document.getElementById("weekStartInput");
  if (input) input.value = toLocalISO(mon);
}

/* ── Export desde el editor ───────────────────── */

async function exportEditor(kind) {
  document.body.classList.add("exporting");
  await sleep(80);

  const target = document.getElementById("reportArea");
  const canvas = await html2canvas(target, {
    scale: 2,
    backgroundColor: "#ffffff",
    useCORS: true,
    width: target.scrollWidth,
    height: target.scrollHeight,
    scrollX: 0,
    scrollY: 0,
  });

  await downloadCanvas(canvas, kind, "planner-semanal");
  document.body.classList.remove("exporting");
}

/* ══════════════════════════════════════════════
   ⑦ VISTA LECTORA (#/p/<slug>)
══════════════════════════════════════════════ */

async function renderReaderView(slug) {
  document.getElementById("app").innerHTML = buildReaderHTML();
  bindReaderEvents(slug);
  await loadReaderData(slug);
  startPolling(slug);
}

function buildReaderHTML() {
  return /* html */ `
    <header class="reader-topbar">
      <div class="reader-brand">
        <div class="reader-logo">📋</div>
        <div>
          <div class="reader-title">Planner semanal de contenidos</div>
          <span id="readerWeekRange" class="reader-week-range">Cargando…</span>
        </div>
      </div>
      <div class="reader-actions">
        <span id="lastUpdated" class="last-updated"></span>
        <button id="readerRefreshBtn" class="reader-btn" type="button">↻ Actualizar</button>
        <span id="changesIndicator" class="changes-badge" style="display:none">● Hay cambios</span>
        <button id="readerExportPngBtn" class="reader-btn" type="button">Imagen</button>
        <button id="readerExportPdfBtn" class="reader-btn reader-btn--primary" type="button">PDF</button>
      </div>
    </header>
    <main class="reader-main">
      <div id="readerContent">
        <div class="reader-state-msg">Cargando plan…</div>
      </div>
    </main>
  `;
}

function bindReaderEvents(slug) {
  document
    .getElementById("readerRefreshBtn")
    .addEventListener("click", () => loadReaderData(slug));
  document
    .getElementById("readerExportPngBtn")
    .addEventListener("click", () => exportReader("png"));
  document
    .getElementById("readerExportPdfBtn")
    .addEventListener("click", () => exportReader("pdf"));
}

async function loadReaderData(slug) {
  const contentEl = document.getElementById("readerContent");
  const hasContent = contentEl?.querySelector(".reader-board");

  try {
    const row = await sbSelectBySlug(slug);

    if (!row) {
      if (!hasContent) {
        contentEl.innerHTML =
          '<div class="reader-state-msg reader-state-msg--error">Plan no encontrado. Verifica el link.</div>';
      }
      return;
    }

    hideChangesIndicator();
    renderReaderContent(row.data, row.updated_at);
  } catch (e) {
    console.error("[Planner] Error cargando plan:", e);
    if (!hasContent) {
      contentEl.innerHTML = `<div class="reader-state-msg reader-state-msg--error">Error al cargar: ${escapeHtml(e.message)}</div>`;
    }
    // Si ya hay contenido: no borrarlo, solo loguear el error de polling
  }
}

function renderReaderContent(data, updatedAt) {
  // Si no cambió, solo actualizar el texto "hace X min"
  if (updatedAt && updatedAt === lastReaderUpdated) {
    const luEl = document.getElementById("lastUpdated");
    if (luEl) luEl.textContent = `Actualizado: ${timeAgo(updatedAt)}`;
    return;
  }
  lastReaderUpdated = updatedAt;

  const startISO = data?.meta?.weekStartISO || null;
  const { mon, fri, dates } = getWeekDates(startISO);

  // Actualizar semana en topbar
  const rangeEl = document.getElementById("readerWeekRange");
  if (rangeEl) rangeEl.textContent = `Semana: ${fmt(mon)} – ${fmt(fri)}`;

  // Actualizar "última actualización"
  const luEl = document.getElementById("lastUpdated");
  if (luEl && updatedAt)
    luEl.textContent = `Actualizado: ${timeAgo(updatedAt)}`;

  // Construir contenido
  document.getElementById("readerContent").innerHTML = /* html */ `
    <div class="reader-content-header">
      <h1 class="reader-content-title">Planner semanal de contenidos</h1>
      <span class="reader-range-pill">Semana: ${fmt(mon)} – ${fmt(fri)}</span>
    </div>
    <div class="reader-board" id="readerBoard">
      ${DAYS.map((d, i) => buildReaderDayHTML(d, dates[i], data?.days?.[d.key] ?? {})).join("")}
    </div>
  `;
}

function buildReaderDayHTML(dayDef, dateObj, dayData) {
  const dateStr = fmtDay(dateObj);

  const blocksHtml = BLOCKS.map((b) => {
    const raw = dayData[b.key] ?? "";
    const lines = raw
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const isEmpty = lines.length === 0;

    const items = isEmpty
      ? "<li>—</li>"
      : lines
          .map((l) => `<li>${escapeHtml(l.replace(/^[·•\-*]\s*/, ""))}</li>`)
          .join("");

    return /* html */ `
      <div class="reader-block reader-block-${b.key}">
        <div class="reader-block-title">${escapeHtml(b.label)}</div>
        <ul class="reader-bullets${isEmpty ? " empty" : ""}">${items}</ul>
      </div>
    `;
  }).join("");

  return /* html */ `
    <div class="reader-day">
      <div class="reader-day-header">
        <span class="reader-day-name">${dayDef.label}</span>
        <span class="reader-day-date">${dateStr}</span>
      </div>
      ${blocksHtml}
    </div>
  `;
}

/* ── Polling (solo comprueba updated_at) ─────── */

function startPolling(slug) {
  stopPolling();
  // Polling liviano: solo compara updated_at, NO recarga el contenido.
  pollingTimer = setInterval(() => checkForUpdates(slug), POLL_INTERVAL_MS);
}

/** Consulta solo updated_at y activa el badge si el servidor tiene datos nuevos. */
async function checkForUpdates(slug) {
  try {
    const serverUpdatedAt = await sbSelectUpdatedAt(slug);
    if (serverUpdatedAt && serverUpdatedAt !== lastReaderUpdated) {
      showChangesIndicator();
    }
  } catch (e) {
    // Error de red en polling → silencioso, no romper la vista
    console.warn("[Planner] Polling error:", e.message);
  }
}

function showChangesIndicator() {
  const badge = document.getElementById("changesIndicator");
  const btn = document.getElementById("readerRefreshBtn");
  if (badge) badge.style.display = "";
  if (btn) btn.classList.add("reader-btn--alert");
}

function hideChangesIndicator() {
  const badge = document.getElementById("changesIndicator");
  const btn = document.getElementById("readerRefreshBtn");
  if (badge) badge.style.display = "none";
  if (btn) btn.classList.remove("reader-btn--alert");
}

function stopPolling() {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
}

/* ── Export desde el reader ───────────────────── */

async function exportReader(kind) {
  document.body.classList.add("exporting");
  await sleep(80);

  const target = document.getElementById("readerContent");
  const canvas = await html2canvas(target, {
    scale: 2,
    backgroundColor: "#ffffff",
    useCORS: true,
    width: target.scrollWidth,
    height: target.scrollHeight,
    scrollX: 0,
    scrollY: 0,
  });

  await downloadCanvas(canvas, kind, "planner-semanal");
  document.body.classList.remove("exporting");
}

/* ══════════════════════════════════════════════
   ⑧ SUPABASE — funciones de acceso a datos
══════════════════════════════════════════════ */

async function sbSelectBySlug(slug) {
  if (!sbClient)
    throw new Error("Supabase no configurado — contacta al editor");

  const { data, error } = await sbClient
    .from("weekly_plans")
    .select("data, updated_at")
    .eq("slug", slug)
    .limit(1);

  if (error) throw error;
  return data?.[0] ?? null;
}

async function sbRpcCreate(slug, planData, wk) {
  if (!sbClient) throw new Error("Supabase no configurado");

  const { data, error } = await sbClient.rpc("create_weekly_plan", {
    p_slug: slug,
    p_data: planData,
    p_write_key: wk,
  });

  if (error) throw new Error(error.message ?? JSON.stringify(error));
  return data;
}

async function sbRpcSave(slug, planData, wk) {
  if (!sbClient) throw new Error("Supabase no configurado");

  const { data, error } = await sbClient.rpc("save_weekly_plan", {
    p_slug: slug,
    p_data: planData,
    p_write_key: wk,
  });

  if (error) throw new Error(error.message ?? JSON.stringify(error));
  return data;
}

/** Solo trae updated_at — consulta liviana para el polling. */
async function sbSelectUpdatedAt(slug) {
  if (!sbClient) throw new Error("Supabase no configurado");
  const { data, error } = await sbClient
    .from("weekly_plans")
    .select("updated_at")
    .eq("slug", slug)
    .limit(1);
  if (error) throw error;
  return data?.[0]?.updated_at ?? null;
}

/* ══════════════════════════════════════════════
   ⑨ FECHAS DE LA SEMANA
══════════════════════════════════════════════ */

function getWeekDates(startISO) {
  let mon;
  if (startISO) {
    // Parse local date — avoids UTC timezone shift from new Date(isoString)
    const [y, m, d] = startISO.split("-").map(Number);
    mon = new Date(y, m - 1, d);
  } else {
    const now = new Date();
    const dow = now.getDay();
    const diffToMon = dow === 0 ? -6 : 1 - dow;
    mon = new Date(now);
    mon.setDate(now.getDate() + diffToMon);
    mon.setHours(0, 0, 0, 0);
  }

  const fri = new Date(mon);
  fri.setDate(mon.getDate() + 4);

  const dates = DAYS.map((_, i) => {
    const d = new Date(mon);
    d.setDate(mon.getDate() + i);
    return d;
  });

  return { mon, fri, dates };
}

/** "4 marzo", "12 enero", etc. */
function fmtDay(d) {
  const months = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
  ];
  return `${d.getDate()} ${months[d.getMonth()]}`;
}

function fmt(d) {
  return d.toLocaleDateString("es-CO", { day: "2-digit", month: "short" });
}

/** Returns "YYYY-MM-DD" from a local Date (avoids UTC shift). */
function toLocalISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* ══════════════════════════════════════════════
   ⑩ LOCALSTORAGE
══════════════════════════════════════════════ */

function defaultState() {
  const days = {};
  for (const d of DAYS) {
    days[d.key] = { stories: "", feed: "", ideas: "" };
  }
  return { meta: { weekStartISO: "", weekEndISO: "" }, days };
}

function loadEditorState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return defaultState();

    const parsed = JSON.parse(raw);
    if (!parsed?.days || parsed.tasks !== undefined) return defaultState();

    const base = defaultState();
    for (const d of DAYS) {
      base.days[d.key] = {
        stories: "",
        feed: "",
        ideas: "",
        ...(parsed.days[d.key] ?? {}),
      };
    }
    base.meta = { ...base.meta, ...(parsed.meta ?? {}) };
    return base;
  } catch {
    return defaultState();
  }
}

function saveEditorLocal(st) {
  localStorage.setItem(LS_KEY, JSON.stringify(st));
}

function cleanupLegacy() {
  for (const k of OLD_LS_KEYS) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* noop */
    }
  }
}

/* ══════════════════════════════════════════════
   ⑪ UTILIDADES
══════════════════════════════════════════════ */

/** Genera un slug corto aleatorio, e.g. "k7m2xp4n" */
function generateSlug(len = 8) {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789"; // sin confusibles (0/O, 1/I/l)
  const arr = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(arr, (b) => chars[b % chars.length]).join("");
}

/** Genera una writeKey aleatoria fuerte */
function generateWriteKey(len = 40) {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
  const arr = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(arr, (b) => chars[b % chars.length]).join("");
}

/** URL base del sitio (sin trailing slash, sin index.html) */
function getBaseUrl() {
  return (location.origin + location.pathname)
    .replace(/\/index\.html$/, "")
    .replace(/\/+$/, "");
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/** "hace 3 min", "hace 2 h", etc. */
function timeAgo(isoStr) {
  const mins = Math.floor((Date.now() - new Date(isoStr).getTime()) / 60_000);
  if (mins < 1) return "hace menos de 1 min";
  if (mins < 60) return `hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs} h`;
  return `hace ${Math.floor(hrs / 24)} d`;
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function downloadCanvas(canvas, kind, basename) {
  const imgData = canvas.toDataURL("image/png");

  if (kind === "png") {
    const a = document.createElement("a");
    a.href = imgData;
    a.download = `${basename}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    return;
  }

  // PDF — orientación automática por proporción
  const { jsPDF } = window.jspdf;
  const isLandscape = canvas.width > canvas.height;
  const pdf = new jsPDF({
    orientation: isLandscape ? "landscape" : "portrait",
    unit: "pt",
    format: "a4",
  });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const imgW = pageW;
  const imgH = (canvas.height / canvas.width) * pageW;

  pdf.addImage(imgData, "PNG", 0, 0, imgW, imgH);

  let remaining = imgH - pageH;
  let offsetY = -pageH;
  while (remaining > 0) {
    pdf.addPage();
    pdf.addImage(imgData, "PNG", 0, offsetY, imgW, imgH);
    offsetY -= pageH;
    remaining -= pageH;
  }

  pdf.save(`${basename}.pdf`);
}

function showToast(msg, type = "info") {
  const el = document.createElement("div");
  el.className = `toast toast--${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

/* ── Cambio de tab con animación ─────────────── */

function switchToTab(key) {
  activeTab = key;
  document.querySelectorAll(".tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.tab === key);
  });

  if (window.innerWidth <= 768) {
    // Móvil: solo muestra/oculta el día — sin reconstruir DOM.
    // Así los textareas mantienen foco, scroll y valor exactamente donde estaban.
    document.querySelectorAll("#board .day").forEach((dayEl) => {
      dayEl.classList.toggle("day--hidden", dayEl.dataset.day !== key);
    });
  } else {
    renderBoard();
  }

  // Centra el tab seleccionado en la barra de tabs (útil en móvil)
  document
    .querySelector(`.tab[data-tab="${key}"]`)
    ?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
}

/* ── Arranque ─────────────────────────────────── */
init();
