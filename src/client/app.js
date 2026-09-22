/* TSO Doctrine Archive — client
 * Content comes from /api/board (the Worker's live Trello feed) and is re-checked
 * on a timer, so edits on the Trello board appear here without a reload.
 * window.__ARCHIVE_PREVIEW__ = { board } switches to hash routing with bundled
 * sample data; it is only set by the standalone design preview, never in production. */

const PREVIEW = window.__ARCHIVE_PREVIEW__ || null;
const POLL_MS = 60_000;

const fallback = {
  ok: true,
  preview: true,
  name: "TSO Sith Doctrine",
  description: "The central archive of the Sith Order.",
  lists: [
    { id: "foundations", name: "Foundations of the Order", cards: [
      { id: "sith-code", name: "The Sith Code", description: "## The Code\n\nThe defining principles of the Order.\n\n- Passion gives strength.\n- Strength gives power.\n- Power brings victory.", labels: [], attachments: [] }
    ]},
    { id: "inquisitorius", name: "The Inquisitorius", cards: [
      { id: "inquisitor-mandate", name: "Mandate of the Inquisitors", description: "## Purpose\n\nThe office, authority and duties of an Inquisitor of the Order.", labels: [], attachments: [] }
    ]}
  ]
};

const state = { board: null, signature: "", lastSync: 0, live: false, searchIndex: 0, searchMatches: [] };
const calcState = { charges: [], warrior: true }; // charges: [{ code, tierIndex, severity }], in the order added
const app = document.getElementById("app");
const byId = (id) => document.getElementById(id);
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const LABEL_COLORS = { green: "#5fbf8a", yellow: "#e2c45a", orange: "#f0994a", red: "#ff6471", purple: "#b48cf2", blue: "#6aa5ff", sky: "#63cdf0", lime: "#a6d65c", pink: "#f58ac4", black: "#a79da0" };

/* ───────── Lite effects ─────────
 * The Hall of Records' performance guard, so both sites behave the same way. Everyone
 * starts on the full version; shortly after the first page renders we sample real
 * frame timing for ~1.5s of visible time, and only if the page is consistently choppy
 * (median frame slower than 25fps, or a quarter of frames over 50ms) does it switch to
 * a lighter mode for the rest of the tab session. The footer switch lets anyone pick
 * either mode themselves; that choice is remembered across visits and always beats the
 * automatic check. ?fx=lite / ?fx=full force either mode for the current tab.
 * What lite drops here is this site's own costs — the ember canvas, the blurred glows,
 * the backdrop filters and every looping animation (see html.fx-lite in the
 * stylesheet). The layout, the type and the content are untouched. */
const perf = { lite: false, decided: false };
const FX_SESSION = "tso-fx";    // this tab only: the automatic verdict, or a ?fx= override
const FX_PREF = "tso-fx-pref";  // the visitor's own pick from the footer switch
const LITE_POLL_MS = 180_000;   // lite checks Trello a third as often, to spare data and battery
const liteOn = () => document.documentElement.classList.contains("fx-lite");
/* Everything decorative asks this, not the media query directly, so "the visitor wants
 * less motion" and "this device cannot afford motion" stay one decision. */
function motionOff() { return reducedMotion.matches || liteOn(); }
function setFxMode(lite) {
  perf.lite = lite;
  document.documentElement.classList.toggle("fx-lite", lite);
  byId("fxToggle").setAttribute("aria-checked", String(lite));
  byId("fxToggleState").textContent = lite ? "Lite" : "Full";
  applyAtmosphere();
  if (lite) app.querySelectorAll("[data-reveal]").forEach((item) => item.classList.add("in"));
  else bindMotion(app); // the pointer tilt was never bound while lite was on
}
function autoSwitchToLite() {
  perf.decided = true;
  setFxMode(true);
  try { sessionStorage.setItem(FX_SESSION, "lite"); } catch {}
  toast("Lighter effects on for smoother performance — switch back in the footer");
}
/* Runs at boot, before anything animates, so a remembered or forced choice applies
 * immediately rather than after another round of lag. The inline script in index.html
 * has already put the class on; this settles the switch and the bookkeeping. */
function applyChosenFxMode() {
  let mode = new URLSearchParams(location.search).get("fx");
  try {
    if (mode === "lite" || mode === "full") sessionStorage.setItem(FX_SESSION, mode);
    else mode = localStorage.getItem(FX_PREF) || sessionStorage.getItem(FX_SESSION);
  } catch {}
  if (mode !== "lite" && mode !== "full") return;
  perf.decided = true;
  setFxMode(mode === "lite");
}
function toggleFxMode() {
  const lite = !perf.lite;
  perf.decided = true; // a measurement still in flight must not overrule the visitor
  setFxMode(lite);
  try { localStorage.setItem(FX_PREF, lite ? "lite" : "full"); } catch {}
}
function framesAreChoppy(samples) {
  if (samples.length < 3) return false;
  const sorted = [...samples].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const slowShare = samples.filter((ms) => ms > 50).length / samples.length;
  return median > 40 || slowShare >= .25;
}
function watchFrameRate() {
  if (perf.decided) return;
  const samples = [];
  let last = 0, measured = 0;
  // rAF pauses in a background tab; drop the gap so returning can't look like one enormous frame.
  const forgetGap = () => { last = 0; };
  document.addEventListener("visibilitychange", forgetGap);
  const tick = (now) => {
    if (last) { samples.push(now - last); measured += now - last; }
    last = now;
    if (measured < 1500) { requestAnimationFrame(tick); return; }
    document.removeEventListener("visibilitychange", forgetGap);
    if (!perf.decided && framesAreChoppy(samples)) autoSwitchToLite();
  };
  requestAnimationFrame(tick);
}

/* ───────── Sentencing data ─────────
 * From the "Arrest Times and Punishments" spreadsheet (source: The Inquisition |
 * Arrest Times and Protocols, last updated 06/04/2026). Each offense is a list of
 * tiers — what a 1st, 2nd, 3rd... offense actually costs, read straight from the
 * sheet's own 1st/2nd/3rd-4th Punishment columns rather than inferred from a repeat
 * count. `minutes: [min, max]` that differ is a severity range (the calculator shows
 * a slider); equal min/max is a flat time; `cap: true` means the doctrine states only
 * a ceiling ("max 30 minutes"). `becomes` swaps the whole tier for another offense's
 * first tier — a third Disturbing the Peace really is a Minor Toxicity charge. */
const PUNISHMENTS = {
  "A-01": { tiers: [
    { label: "1st offense", tag: "warning" },
    { label: "2nd offense", minutes: [5, 5] },
    { label: "3rd+ offense", becomes: "B-01" }
  ] },
  "A-02": { tiers: [
    { label: "1st offense", tag: "warning" },
    { label: "2nd offense", minutes: [5, 5] },
    { label: "3rd+ offense", minutes: [10, 10], note: "Arrest time doubles." }
  ] },
  "A-03": { tiers: [
    { label: "1st offense", tag: "warning" },
    { label: "2nd offense", minutes: [5, 5] },
    { label: "3rd+ offense", minutes: [10, 10], note: "Arrest time doubles." }
  ] },
  "A-04": { tiers: [
    { label: "1st offense", tag: "warning" },
    { label: "2nd offense", minutes: [5, 5] },
    { label: "3rd+ offense", minutes: [10, 10], note: "Arrest time doubles." }
  ] },
  "A-05": { tiers: [
    { label: "1st offense", tag: "warning" },
    { label: "2nd+ offense", minutes: [5, 5], note: "No further escalation is on file." }
  ] },
  "A-06": { tiers: [
    { label: "1st offense", tag: "warning" },
    { label: "2nd offense", minutes: [5, 5], note: "To change the outfit." },
    { label: "3rd offense", tag: "kick" },
    { label: "4th+ offense", tag: "ban-server" }
  ] },
  "B-01": { tiers: [
    { label: "1st offense", minutes: [10, 15] },
    { label: "2nd+ offense (same target)", becomes: "C-01", note: "Continuing to target the same individual escalates to Harassment." }
  ] },
  "B-02": { tiers: [ { label: "Each offense", minutes: [10, 15] } ] },
  "B-03": { tiers: [ { label: "Each offense", minutes: [10, 15], notifyIfWarrior: "Notify High Command." } ] },
  "B-04": { tiers: [ { label: "Each offense", minutes: [10, 15] } ] },
  "B-05": { tiers: [ { label: "Each offense", minutes: [10, 15], notifyIfWarrior: "Notify Inquisition High Command." } ] },
  "B-06": { tiers: [ { label: "Each offense", minutes: [5, 10], notifyIfWarrior: "Notify High Command." } ] },
  "B-07": { tiers: [ { label: "Each offense", minutes: [5, 10], notifyIfWarrior: "Notify High Command." } ] },
  "B-08": { tiers: [
    { label: "1st offense", minutes: [15, 15], notifyIfWarrior: "Notify Inquisition High Command." },
    { label: "2nd+ offense", tag: "ban-server", notifyIfWarrior: "Notify Inquisition High Command." }
  ] },
  "B-09": { tiers: [
    { label: "1st offense", tag: "warning", note: "AFK 15+ minutes farming Force Points or crystals." },
    { label: "2nd offense", tag: "kick" },
    { label: "3rd+ offense", tag: "ban-server" }
  ] },
  "C-01": { tiers: [ { label: "Each offense", minutes: [30, 30], cap: true, reportAlways: "Report to Inquisition High Command." } ] },
  "C-02": { tiers: [ { label: "Each offense", minutes: [15, 30] } ] },
  "C-03": { tiers: [ { label: "Each offense", tag: "report", reportAlways: "Report to Inquisition High Command." } ] },
  "C-04": { tiers: [ { label: "Each offense", minutes: [15, 30] } ] },
  "C-05": { tiers: [ { label: "Each offense", minutes: [30, 30], cap: true, reportAlways: "Report to Inquisition High Command." } ] },
  "C-06": { tiers: [ { label: "Each offense", tag: "ban-game", reportAlways: "Report to Inquisition High Command." } ] },
  "C-07": { tiers: [ { label: "Each offense", minutes: [20, 30], notifyIfWarrior: "Notify High Command." } ] },
  "C-08": { tiers: [ { label: "Each offense", tag: "report", reportAlways: "Report to Inquisition High Command." } ] },
  "C-09": { tiers: [
    { label: "1st offense", minutes: [20, 30] },
    { label: "2nd offense", tag: "ban-server", note: "If they left the game to dodge jail time." },
    { label: "3rd+ offense", tag: "ban-game" }
  ] },
  "C-10": { tiers: [ { label: "Each offense", minutes: [30, 30], cap: true } ] },
  "C-11": { tiers: [ { label: "Each offense", tag: "report", reportAlways: "Report to Inquisition High Command." } ] }
};
const BAN_MINUTES = 45; // "If the arrest times stack to 45 minutes, immediately request a server-ban."
const SENTENCE_STEP_MINUTES = 5;
/* The chosen tier for a charge, redirected to the target offense's first tier when the
 * tier itself is a "becomes" swap (a 3rd Disturbing the Peace really is a Minor
 * Toxicity charge, not a fourth kind of Disturbing the Peace). */
function resolveTier(code, tierIndex) {
  const entry = PUNISHMENTS[code];
  if (!entry) return null;
  const index = Math.min(Math.max(tierIndex, 0), entry.tiers.length - 1);
  const tier = entry.tiers[index];
  if (tier.becomes) {
    const target = PUNISHMENTS[tier.becomes];
    return { ...target.tiers[0], sourceCode: tier.becomes, viaLabel: tier.label, viaNote: tier.note };
  }
  return { ...tier, sourceCode: code, viaLabel: null, viaNote: null };
}
function tierIsRange(tier) { return !!tier.minutes && tier.minutes[0] !== tier.minutes[1]; }
/* Where a range tier actually lands: the charge's own chosen severity if it has one,
 * otherwise the range's midpoint. Flat tiers and cap ceilings just use their number. */
function tierMinutes(tier, severity) {
  if (!tier.minutes) return 0;
  if (!tierIsRange(tier)) return tier.minutes[1];
  const mid = Math.round((tier.minutes[0] + tier.minutes[1]) / 2);
  return Math.min(Math.max(severity ?? mid, tier.minutes[0]), tier.minutes[1]);
}
function severityLabel(tier, minutes) {
  if (!tierIsRange(tier)) return "";
  const [min, max] = tier.minutes;
  const t = (minutes - min) / (max - min);
  return t <= 1 / 3 ? "Minor" : t <= 2 / 3 ? "Moderate" : "Severe";
}
/* A resolved value's badge — the exact number once a severity has been chosen. */
function tierBadge(tier, minutes) {
  if (tier.tag === "warning") return "Warning";
  if (tier.tag === "kick") return "Kick";
  if (tier.tag === "ban-server" || tier.tag === "ban-game") return "Ban";
  if (tier.tag === "report") return "Report";
  if (!tier.minutes) return "—";
  if (tier.cap) return `up to ${tier.minutes[1]}m`;
  return `${minutes}m`;
}
/* A tier's own label before any severity has been picked — shows the full range. */
function tierRangeLabel(tier) {
  if (tier.becomes) return `becomes ${calcOffenseTitle(tier.becomes)} (${tier.becomes})`;
  if (tier.tag === "warning") return "Warning";
  if (tier.tag === "kick") return "Kick";
  if (tier.tag === "ban-server" || tier.tag === "ban-game") return "Ban";
  if (tier.tag === "report") return "Report";
  if (!tier.minutes) return "—";
  if (tier.cap) return `up to ${tier.minutes[1]}m`;
  if (tier.minutes[0] === tier.minutes[1]) return `${tier.minutes[1]}m`;
  return `${tier.minutes[0]}–${tier.minutes[1]}m`;
}
/* ───────── Data + live sync ───────── */
async function loadBoard() {
  if (PREVIEW) return prepareBoard({ ...PREVIEW.board, preview: true });
  const response = await fetch("/api/board", { cache: "no-store" });
  if (!response.ok) throw new Error("Board unavailable");
  const board = await response.json();
  if (!board.ok || !Array.isArray(board.lists)) throw new Error("Board unavailable");
  return prepareBoard(board);
}
const signatureOf = (board) => JSON.stringify([board.name, board.description, board.lists]);

function prepareBoard(board) {
  const lists = board.lists.map((list) => {
    const cards = list.cards
      .map((card) => ({ ...card, name: cleanText(card.name).replace(/^[•·▪●*-]+\s*/, ""), description: cleanText(card.description) }))
      .filter((card) => card.name && !/^[-—–_=*.\s]+$/.test(card.name));
    let tagline = "", art = null;
    if (cards.length > 1 && !cards[0].description) {
      const heading = cards.shift();
      tagline = titleCase(heading.name);
      art = primaryImage(heading);
    }
    return { ...list, name: cleanText(list.name), tagline, art, cards: cards.map(prepareRecord) };
  });
  return { ...board, name: cleanText(board.name), description: cleanText(board.description), lists };
}
function prepareRecord(card) {
  const coded = card.name.match(/^([A-Z]{1,3}-\d{1,3})\s*[|:–—-]\s*(.+)$/);
  const code = coded ? coded[1] : "";
  const title = coded ? coded[2].trim() : card.name;
  const description = stripTitleLine(card.description, [card.name, title]);
  const titleOnly = !description && !(card.attachments || []).length;
  return { ...card, code, title, description, titleOnly };
}
function stripTitleLine(description, titles) {
  const lines = description.split("\n");
  const first = lines.findIndex((line) => line.trim());
  if (first < 0) return "";
  const heading = lines[first].trim().replace(/^#{1,6}\s*/, "").replace(/^>\s*/, "").replace(/^\*\*(.+)\*\*$/, "$1").replace(/^__(.+)__$/, "$1").trim();
  const wanted = titles.map(normalise);
  if (heading && wanted.includes(normalise(heading))) return lines.slice(first + 1).join("\n").trim();
  return description;
}
const normalise = (value = "") => value.toLowerCase().replace(/[^a-z0-9]+/g, "");
function cleanText(value = "") { return String(value).replace(/[\u200b-\u200d\ufeff]/g, "").replace(/\r/g, "").replace(/[ \t]+$/gm, "").trim(); }
function titleCase(value = "") {
  if (value !== value.toUpperCase() || !/[A-Z]/.test(value)) return value;
  const small = new Set(["of", "the", "and", "or", "in", "on", "at", "to", "for", "by", "a", "an"]);
  return value.toLowerCase().split(" ").map((word, i) => (i && small.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1))).join(" ");
}

async function start() {
  try {
    state.board = await loadBoard();
    state.live = !state.board.preview;
  } catch {
    state.board = prepareBoard(fallback);
    state.live = false;
  }
  state.signature = signatureOf(state.board);
  state.lastSync = Date.now();
  renderMenus();
  route();
  updateSyncLabel();
  if (!PREVIEW) {
    setInterval(refresh, POLL_MS);
    document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() - state.lastSync > 20_000) refresh(); });
  }
  setInterval(updateSyncLabel, 10_000);
  setTimeout(watchFrameRate, 800); // let the first render and its entrance animations settle
}

async function refresh() {
  if (document.hidden) return;
  if (liteOn() && Date.now() - state.lastSync < LITE_POLL_MS) return;
  try {
    const next = await loadBoard();
    const signature = signatureOf(next);
    state.lastSync = Date.now();
    const changed = signature !== state.signature;
    const wasOffline = !state.live;
    state.live = true;
    if (changed) {
      state.board = next;
      state.signature = signature;
      renderMenus();
      route({ preserveScroll: true, instant: true });
      if (!byId("searchPanel").hidden) renderSearch(byId("globalSearch").value);
      toast(wasOffline ? "Connection restored — archive synced" : "Archive updated from Trello");
    }
  } catch {
    state.live = false;
  }
  updateSyncLabel();
}

function updateSyncLabel() {
  const pill = byId("syncPill");
  if (!state.board) return;
  if (state.board.preview) {
    pill.dataset.state = "preview";
    byId("syncStatus").textContent = "Preview data";
    byId("footerSync").textContent = "Preview archive · sample content";
    return;
  }
  pill.dataset.state = state.live ? "live" : "offline";
  const seconds = Math.round((Date.now() - state.lastSync) / 1000);
  const ago = seconds < 45 ? "just now" : seconds < 3600 ? `${Math.round(seconds / 60)} min ago` : `${Math.round(seconds / 3600)} h ago`;
  byId("syncStatus").textContent = state.live ? "Live" : "Reconnecting";
  byId("footerSync").textContent = state.live ? `Synced with Trello · ${ago}` : `Trello unreachable · last synced ${ago}`;
}

/* ───────── Helpers ───────── */
function slug(value = "") {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "record";
}
const link = (path) => (PREVIEW ? `#${path}` : path);
function currentPath() { return PREVIEW ? (location.hash.replace(/^#/, "") || "/") : location.pathname; }
function sectionHref(section) { return link(`/section/${slug(section.name)}`); }
function recordHref(record) { return link(`/record/${encodeURIComponent(record.id)}/${slug(record.name)}`); }
function allRecords() { return state.board.lists.flatMap((section, sectionIndex) => section.cards.map((record, recordIndex) => ({ ...record, section, sectionIndex, recordIndex }))); }
function searchableRecords() { return allRecords().filter((record) => !record.titleOnly); }
function imageAttachments(record) { return (record.attachments || []).filter((item) => item.isImage && item.imageUrl); }
function primaryImage(record) {
  const images = imageAttachments(record);
  return images.find((item) => item.id === record.coverAttachmentId) || images[0] || null;
}
const pad = (number) => String(number).padStart(2, "0");
function roman(number) {
  const map = [[1000,"M"],[900,"CM"],[500,"D"],[400,"CD"],[100,"C"],[90,"XC"],[50,"L"],[40,"XL"],[10,"X"],[9,"IX"],[5,"V"],[4,"IV"],[1,"I"]];
  let out = ""; for (const [value, numeral] of map) while (number >= value) { out += numeral; number -= value; }
  return out;
}
function readingTime(source = "") { return Math.max(1, Math.round(stripMarkdown(source).split(/\s+/).filter(Boolean).length / 220)); }
function chips(record) {
  const labels = (record.labels || []).filter((label) => label.name);
  if (!labels.length) return "";
  return `<span class="chips">${labels.map((label) => `<span class="chip" style="--chip:${LABEL_COLORS[(label.color || "").split("_")[0]] || "#d4ad68"}">${escapeHtml(label.name)}</span>`).join("")}</span>`;
}
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
function recordLabel(record) { return record.code ? `<span class="record-code">${escapeHtml(record.code)}</span>${escapeHtml(record.title)}` : escapeHtml(record.title); }

/* A deterministic sigil per section/record, so entries without artwork still have a face. */
function glyph(seed = "") {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  const rand = () => { h |= 0; h = (h + 0x6d2b79f5) | 0; let t = Math.imul(h ^ (h >>> 15), 1 | h); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const point = (radius, angle) => `${(Math.cos(angle) * radius).toFixed(2)},${(Math.sin(angle) * radius).toFixed(2)}`;
  const polygon = (sides, radius, rotation) => Array.from({ length: sides }, (_, i) => point(radius, rotation + (i / sides) * Math.PI * 2)).join(" ");
  const sides = 3 + Math.floor(rand() * 4);
  const inner = 3 + Math.floor(rand() * 3);
  const rotation = -Math.PI / 2;
  const twist = rotation + (rand() > .5 ? Math.PI / sides : 0);
  const ticks = [12, 18, 24, 36][Math.floor(rand() * 4)];
  const spokes = rand() > .4;
  const tickMarks = Array.from({ length: ticks }, (_, i) => {
    const angle = (i / ticks) * Math.PI * 2; const long = i % 3 === 0;
    return `<path d="M${point(long ? 41 : 43, angle)} L${point(46, angle)}"/>`;
  }).join("");
  const spokeMarks = spokes ? Array.from({ length: sides }, (_, i) => `<path d="M${point(7, rotation + (i / sides) * Math.PI * 2)} L${point(34, rotation + (i / sides) * Math.PI * 2)}"/>`).join("") : "";
  return `<svg class="glyph" viewBox="-50 -50 100 100" aria-hidden="true"><g class="glyph-ring"><circle r="48"/>${tickMarks}<circle r="38" stroke-dasharray="${(2 + rand() * 6).toFixed(1)} ${(2 + rand() * 5).toFixed(1)}"/></g><g class="glyph-core"><polygon points="${polygon(sides, 34, rotation)}"/><polygon points="${polygon(inner, 18, twist)}"/>${spokeMarks}<circle r="7"/><circle class="glyph-dot" r="2.2"/></g></svg>`;
}

/* ───────── Routing ───────── */
function route(options = {}) {
  const render = () => {
    const parts = currentPath().split("/").filter(Boolean);
    if (parts[0] === "calculator") return renderCalculator(options);
    if (parts[0] === "quick-read") return renderFast(options);
    if (!parts.length) return renderHome(options);
    if (parts[0] === "section") {
      const section = state.board.lists.find((item) => slug(item.name) === parts[1]);
      return section ? renderSection(section, options) : renderNotFound();
    }
    if (parts[0] === "record") {
      const record = allRecords().find((item) => item.id === decodeURIComponent(parts[1] || ""));
      return record ? renderRecord(record, options) : renderNotFound();
    }
    renderNotFound();
  };
  if (document.startViewTransition && !motionOff() && !options.instant && !document.hidden) {
    const transition = document.startViewTransition(render);
    transition.ready.catch(() => {}); transition.finished.catch(() => {}); // a skipped transition still renders
  } else render();
}
function navigate(href) {
  const path = href.replace(/^#/, "") || "/";
  closeSearch(); closeMenus();
  if (path === currentPath()) { scrollTo({ top: 0, behavior: "smooth" }); return; }
  if (PREVIEW) location.hash = path; // hashchange triggers route()
  else { history.pushState({}, "", path); route(); }
}
function afterRender(options = {}) {
  document.documentElement.classList.remove("board-open"); // only the offense board locks page scroll
  bindImageFallbacks(app); bindMotion(app); observeReveals(app);
  if (!options.preserveScroll) { scrollTo({ top: 0, behavior: "auto" }); app.focus({ preventScroll: true }); }
  updateProgress();
}

/* ───────── Views ───────── */
function renderMenus() {
  byId("sectionsPopover").innerHTML = state.board.lists.map((section, index) => `<a href="${sectionHref(section)}" data-link><em>${roman(index + 1)}</em><span>${escapeHtml(section.name)}</span><small>${section.cards.length}</small></a>`).join("");
}

const SEARCH_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>`;
const HERO_SIGIL = `<svg viewBox="-100 -100 200 200" aria-hidden="true">
  <g class="ring r1" stroke-width=".6"><circle r="96"/>${Array.from({ length: 72 }, (_, i) => { const a = (i / 72) * Math.PI * 2, r = i % 6 === 0 ? 86 : 91; return `<path d="M${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r).toFixed(1)} L${(Math.cos(a) * 96).toFixed(1)},${(Math.sin(a) * 96).toFixed(1)}"/>`; }).join("")}</g>
  <g class="ring r2" stroke-width=".7"><circle r="78" stroke-dasharray="2 7"/><circle r="72" stroke-dasharray="40 14 6 14"/><circle class="orb" cx="78" cy="0" r="2.2"/><circle class="orb" cx="-78" cy="0" r="1.4"/></g>
  <g class="ring r3" stroke-width=".8"><circle r="60" stroke-dasharray="1 5"/><path d="M0,-66 L4,-60 L0,-54 L-4,-60Z"/><path d="M0,66 L4,60 L0,54 L-4,60Z"/></g>
  <path class="tri" pathLength="100" stroke-width="1.6" d="M0,-52 L45,26 L-45,26Z"/>
  <path class="tri inner" pathLength="100" stroke-width="1.2" d="M0,-22 L21,14 L-21,14Z"/>
  <circle class="eye" cx="0" cy="8" r="3.4"/>
</svg>`;

function renderHome(options) {
  document.title = `${state.board.name || "TSO"} — Archive`;
  const records = searchableRecords();
  const tickerItems = records.map((record) => `<a href="${recordHref(record)}" data-link tabindex="-1">${escapeHtml(record.name)}</a>`).join("");
  app.innerHTML = `<div class="page">
    <section class="hero">
      <div class="hero-copy">
        <div class="eyebrow">The Sith Order</div>
        <h1 class="hero-title"><span>Doctrine</span><span>Archive</span></h1>
        <p class="hero-lead">${escapeHtml(state.board.description || "The central record of the Order: doctrine, authority, training and law.")}</p>
        <form class="hero-search" role="search" id="heroSearch">
          ${SEARCH_ICON}
          <input type="search" placeholder="Search rules, offences, locations…" autocomplete="off" aria-label="Search the archive" />
          <kbd aria-hidden="true">/</kbd>
        </form>
        <div class="hero-actions"><a class="btn" href="#sections" data-scroll>Browse the sections <span aria-hidden="true">↓</span></a></div>
      </div>
      <div class="hero-sigil" id="heroSigil">${HERO_SIGIL}</div>
    </section>
    ${records.length > 3 ? `<div class="ticker" aria-hidden="true"><div class="ticker-track" style="--ticker-time:${Math.max(30, records.length * 4)}s">${tickerItems}${tickerItems}</div></div>` : ""}
    <div class="rule" id="sections"><i></i>Sections of the doctrine<i></i></div>
    <section class="section-index" aria-label="Doctrine sections">
      ${state.board.lists.map((section, index) => `<a class="holo" href="${sectionHref(section)}" data-link data-reveal style="--d:${Math.min(index * 70, 420)}ms">
        ${glyph(section.id + section.name)}
        <div class="holo-top"><span>Section ${roman(index + 1)}</span><span>${plural(section.cards.length, "record")}</span></div>
        <h2>${escapeHtml(section.name)}</h2>
        ${section.tagline ? `<p class="holo-tagline">${escapeHtml(section.tagline)}</p>` : ""}
        ${section.cards.length ? `<ul>${section.cards.slice(0, 3).map((record) => `<li>${recordLabel(record)}</li>`).join("")}</ul>` : `<ul><li>Awaiting records</li></ul>`}
        <span class="holo-arrow" aria-hidden="true">→</span>
      </a>`).join("")}
    </section>
  </div>`;
  const search = byId("heroSearch");
  search.addEventListener("submit", (event) => { event.preventDefault(); openSearch(search.querySelector("input").value); });
  search.querySelector("input").addEventListener("focus", () => openSearch(search.querySelector("input").value));
  afterRender(options);
}

function renderSection(section, options) {
  document.title = `${section.name} — TSO Doctrine`;
  const index = state.board.lists.indexOf(section);
  const filterable = section.cards.filter((record) => !record.titleOnly).length > 3;
  app.innerHTML = `<div class="page">
    <nav class="breadcrumb" aria-label="Breadcrumb"><a href="${link("/")}" data-link>Archive</a><span aria-hidden="true">◆</span><span>${escapeHtml(section.name)}</span></nav>
    <header class="section-header${section.art ? " has-art" : ""}">
      ${section.art ? `<img class="section-art" src="${escapeAttr(section.art.imageUrl)}" alt="" />` : glyph(section.id + section.name)}
      <div class="eyebrow">Section ${roman(index + 1)}</div>
      <h1>${escapeHtml(section.name)}</h1>
      ${section.tagline ? `<p class="section-tagline">${escapeHtml(section.tagline)}</p>` : ""}
      <div class="section-tools">
        <span id="sectionCount">${plural(section.cards.length, "record")} on file</span>
        ${filterable ? `<label class="filter">${SEARCH_ICON}<input id="sectionFilter" type="search" placeholder="Filter this section…" autocomplete="off" aria-label="Filter records in this section" /></label>` : ""}
      </div>
    </header>
    <section class="record-list" id="recordList" aria-label="Records in ${escapeAttr(section.name)}">
      ${section.cards.length ? section.cards.map((record, i) => recordRow(record, i)).join("") : `<p class="no-match">No records are currently filed in this section.</p>`}
      <p class="no-match" id="noMatch" hidden>No records in this section match that filter.</p>
    </section>
  </div>`;
  byId("sectionFilter")?.addEventListener("input", (event) => {
    const value = event.target.value.trim().toLowerCase(); let shown = 0;
    app.querySelectorAll(".record-row").forEach((row) => { const hit = !value || row.dataset.text.includes(value); row.hidden = !hit; if (hit) shown += 1; });
    byId("noMatch").hidden = shown > 0;
    byId("sectionCount").textContent = value ? `${shown} of ${plural(section.cards.length, "record")}` : `${plural(section.cards.length, "record")} on file`;
  });
  afterRender(options);
}

function recordRow(record, index = 0) {
  const image = primaryImage(record);
  const text = escapeAttr(`${record.name} ${stripMarkdown(record.description)}`.toLowerCase());
  const number = record.code ? `<span class="record-num is-code">${escapeHtml(record.code)}</span>` : `<span class="record-num">${pad(index + 1)}</span>`;
  if (record.titleOnly) {
    return `<div class="record-row is-static" data-reveal data-text="${text}" style="--d:${Math.min(index * 50, 300)}ms">
      ${number}<div><h2>${escapeHtml(record.title)}</h2>${chips(record)}</div>
    </div>`;
  }
  return `<a class="record-row" href="${recordHref(record)}" data-link data-reveal data-seed="${escapeAttr(record.id)}" data-text="${text}" style="--d:${Math.min(index * 50, 300)}ms">
    ${number}
    <div><h2>${escapeHtml(record.title)}</h2><p>${escapeHtml(excerpt(record))}</p>${chips(record)}</div>
    ${image ? `<div class="record-image"><img src="${escapeAttr(image.imageUrl)}" alt="${escapeAttr(image.name || record.name)}" loading="lazy" /></div>` : `<div class="record-image is-glyph">${glyph(record.id)}</div>`}
    <span class="record-arrow" aria-hidden="true">→</span>
  </a>`;
}

function renderRecord(record, options) {
  document.title = `${record.name} — TSO Doctrine`;
  const images = imageAttachments(record);
  const hero = primaryImage(record);
  const documents = (record.attachments || []).filter((item) => !item.isImage);
  const siblings = record.section.cards;
  const current = siblings.findIndex((item) => item.id === record.id);
  const previous = current > 0 ? siblings[current - 1] : null;
  const next = current < siblings.length - 1 ? siblings[current + 1] : null;
  const headings = extractHeadings(record.description);
  const figure = (image, lazy) => `<figure><button data-zoom="${escapeAttr(image.imageUrl)}" data-caption="${escapeAttr(captionOf(image, record))}" aria-label="Enlarge image"><img src="${escapeAttr(image.imageUrl)}" alt="${escapeAttr(captionOf(image, record))}" ${lazy ? 'loading="lazy"' : ""} /></button><figcaption>${escapeHtml(captionOf(image, record))}</figcaption></figure>`;

  // Images referenced inline in the description are rendered where they appear; anything
  // left over (plus the cover, if it was not referenced inline) is shown as the gallery.
  const inlineIds = new Set();
  const body = record.description ? markdown(record.description, { record, shown: inlineIds, hero }) : "";
  const gallery = images.filter((image) => image.id !== hero?.id && !inlineIds.has(image.id));
  const contents = headings.length > 1;
  const meta = [record.code ? `Offense ${record.code}` : `Record ${pad(current + 1)} of ${pad(siblings.length)}`, record.description ? `${readingTime(record.description)} min read` : ""].filter(Boolean);

  app.innerHTML = `<article class="page article-page">
    <nav class="breadcrumb" aria-label="Breadcrumb"><a href="${link("/")}" data-link>Archive</a><span aria-hidden="true">◆</span><a href="${sectionHref(record.section)}" data-link>${escapeHtml(record.section.name)}</a><span aria-hidden="true">◆</span><span>${escapeHtml(record.title)}</span></nav>
    <header class="article-header">
      <div class="eyebrow">${escapeHtml(record.section.name)}</div>
      <h1>${escapeHtml(record.title)}</h1>
      <div class="article-meta">${meta.map((item) => `<span>${item}</span>`).join("")}${chips(record)}</div>
    </header>
    ${hero ? `<div class="hero-media">${figure(hero, false)}</div>` : ""}
    <div class="article-layout${contents ? " has-contents" : ""}">
      <div class="prose">${body || `<p class="notice">${images.length ? "This record is illustrated only; no written doctrine has been filed with it." : "No written doctrine has been filed under this entry yet."}</p>`}</div>
      ${contents ? `<aside class="article-aside" aria-label="In this record"><strong>In this record</strong>${headings.map((heading) => `<a href="#${heading.id}" data-scroll class="${heading.level === 3 ? "sub" : ""}">${escapeHtml(heading.text)}</a>`).join("")}</aside>` : ""}
    </div>
    ${gallery.length ? `<div class="rule"><i></i>Archive imagery<i></i></div><section class="gallery" aria-label="Record images">${gallery.map((image) => figure(image, true)).join("")}</section>` : ""}
    ${documents.length || record.url ? `<div class="rule"><i></i>References<i></i></div><section class="attachments"><div class="attachment-links">${documents.map((item) => `<a href="${safeUrl(item.url)}" target="_blank" rel="noopener">${escapeHtml(item.name || "Attachment")} ↗</a>`).join("")}${record.url ? `<a href="${safeUrl(record.url)}" target="_blank" rel="noopener">View source card ↗</a>` : ""}</div></section>` : ""}
    ${(previous || next) ? `<nav class="next-record" aria-label="Adjacent records">${previous ? `<a href="${recordHref(previous)}" data-link><small>← Previous</small><span>${recordLabel(previous)}</span></a>` : ""}${next ? `<a class="next" href="${recordHref(next)}" data-link><small>Next →</small><span>${recordLabel(next)}</span></a>` : ""}</nav>` : ""}
  </article>`;
  afterRender(options);
  if (contents) spyHeadings();
}
function captionOf(image, record) {
  const name = (image.name || "").replace(/\.(png|jpe?g|gif|webp|avif)$/i, "");
  return /^(image|img|screenshot|untitled|unnamed)?[\s_-]*\d*$/i.test(name) ? record.title : name;
}

function renderNotFound() {
  document.title = "Record not found — TSO Doctrine";
  app.innerHTML = `<div class="empty-page">${glyph("void")}<h1>Record not found</h1><p>This archive reference does not exist, or it has been struck from the record.</p><a class="btn" href="${link("/")}" data-link>Return to the archive</a></div>`;
  afterRender();
}

/* ───────── Quick Read ─────────
 * A toggle in the header swaps the whole app between the normal illustrated
 * pages and a single flat document: every section and every record's full
 * text, one below the other, so the entire board can be scanned or searched
 * (Ctrl+F, or the filter box) without opening anything — the way Trello
 * itself shows a whole board at a glance. The default UI is untouched until
 * someone turns this on, and the choice is remembered per browser. */
function fastRecordBlock(record, sectionName) {
  const text = escapeAttr(`${record.code} ${record.title} ${sectionName} ${stripMarkdown(record.description)}`.toLowerCase());
  const open = `<a class="fast-open" href="${recordHref(record)}" data-link title="Open as its own page" aria-label="Open ${escapeAttr(record.title)} as its own page">↗</a>`;
  if (record.titleOnly) {
    return `<div class="fast-record fast-record-title" id="fast-record-${escapeAttr(record.id)}" data-text="${text}"><h4>${recordLabel(record)}</h4>${chips(record)}</div>`;
  }
  const body = record.description ? markdown(record.description, { record }) : "";
  return `<article class="fast-record" id="fast-record-${escapeAttr(record.id)}" data-text="${text}">
    ${open}
    <h4>${recordLabel(record)}</h4>
    <div class="fast-meta">${chips(record)}</div>
    <div class="prose">${body || `<p class="notice">No written doctrine has been filed under this entry yet.</p>`}</div>
  </article>`;
}
function offenseSections() { return state.board.lists.filter((section) => /offen[cs]e/i.test(section.name)); }
function fastSectionBlock(section, index) {
  const records = section.cards;
  return `<section class="fast-section" id="fast-section-${slug(section.name)}">
    <header class="fast-section-head">
      <span class="fast-index">${roman(index + 1)}</span>
      <div><h3>${escapeHtml(section.name)}</h3>${section.tagline ? `<p class="fast-tagline">${escapeHtml(section.tagline)}</p>` : ""}</div>
      <span class="fast-count">${plural(records.length, "record")}</span>
    </header>
    <div class="fast-records">${records.length ? records.map((record) => fastRecordBlock(record, section.name)).join("") : `<p class="no-match">No records are currently filed in this section.</p>`}</div>
  </section>`;
}
function renderFast(options = {}) {
  document.documentElement.classList.add("board-open");
  document.title = `${state.board.name || "TSO"} — Offenses`;
  const sections = offenseSections();
  const total = sections.reduce((sum, section) => sum + section.cards.length, 0);
  app.innerHTML = `<div class="fast-page">
    <nav class="breadcrumb fast-breadcrumb" aria-label="Breadcrumb"><a href="${link("/")}" data-link>Archive</a><span aria-hidden="true">◆</span><span>Quick Read</span></nav>
    <div class="fast-head">
      <div class="eyebrow">Quick Read</div>
      <h1>Every offense, side by side</h1>
      <p>Every offense class as its own column, like the board itself — scan across, or filter as you type.</p>
      <label class="fast-filter">${SEARCH_ICON}<input id="fastFilter" type="search" placeholder="Filter the offenses…" autocomplete="off" aria-label="Filter the offenses" /><span class="fast-filter-count" id="fastCount">${plural(total, "entry").replace("entrys", "entries")}</span></label>
    </div>
    <div class="fast-body">${sections.map(fastSectionBlock).join("")}</div>
  </div>`;
  bindImageFallbacks(app);
  bindFastFilter();
  if (!options.preserveScroll) { scrollTo({ top: 0, behavior: "auto" }); app.focus({ preventScroll: true }); }
  updateProgress();
}
function bindFastFilter() {
  const input = byId("fastFilter");
  const total = offenseSections().reduce((sum, section) => sum + section.cards.length, 0);
  input.addEventListener("input", (event) => {
    const value = event.target.value.trim().toLowerCase();
    let shown = 0;
    app.querySelectorAll(".fast-section").forEach((section) => {
      let visible = 0;
      section.querySelectorAll(".fast-record").forEach((row) => {
        const hit = !value || row.dataset.text.includes(value);
        row.hidden = !hit; if (hit) visible += 1;
      });
      section.hidden = value ? visible === 0 : false;
      shown += visible;
    });
    byId("fastCount").textContent = value ? `${plural(shown, "match").replace("matchs", "matches")}` : `${plural(total, "entry").replace("entrys", "entries")}`;
  });
}

/* ───────── Sentencing Calculator ─────────
 * Pick offenses on the left; the stack and verdict on the right update as you go. Each
 * offense's live title still comes from the Trello record (via its code), only the
 * punishment numbers are local — the board has no notion of arrest time. */
const BANNER_LABEL = { empty: "No Charges", calm: "Minor", elevated: "Elevated", severe: "Severe", "ban-server": "Server Ban", "ban-game": "Game Ban" };
const DROID_LINES = {
  empty: "Awaiting charges, Inquisitor.",
  calm: "Minor infraction logged.",
  elevated: "Escalating — proceed with caution.",
  severe: "Multiple violations confirmed.",
  "ban-server": "Sentence exceeds protocol. Server ban advised.",
  "ban-game": "Game ban on file."
};
function calcOffenseTitle(code) {
  const record = allRecords().find((item) => item.code === code);
  return record ? record.title : code;
}
function computeVerdict() {
  let total = 0, hasBanServer = false, hasBanGame = false, hasKick = false;
  const flags = new Set();
  const resolved = calcState.charges.map((charge, index) => {
    const tier = resolveTier(charge.code, charge.tierIndex);
    if (!tier) return { charge, index, tier: null, minutes: 0 };
    const minutes = tierMinutes(tier, charge.severity);
    total += minutes;
    if (tier.tag === "ban-server") hasBanServer = true;
    if (tier.tag === "ban-game") hasBanGame = true;
    if (tier.tag === "kick") hasKick = true;
    if (tier.reportAlways) flags.add(tier.reportAlways);
    if (calcState.warrior && tier.notifyIfWarrior) flags.add(tier.notifyIfWarrior);
    return { charge, index, tier, minutes };
  });
  if (total >= BAN_MINUTES) hasBanServer = true;
  if (hasKick) flags.add("Kick");
  let tier = "empty";
  if (hasBanServer) tier = "ban-server";
  else if (hasBanGame) tier = "ban-game";
  else if (total >= 30) tier = "severe";
  else if (total >= 15) tier = "elevated";
  else if (resolved.length) tier = "calm";
  return { resolved, total, flags: [...flags], tier };
}
/* A freshly added charge starts at the first tier, with severity defaulted to the
 * middle of whatever range that (possibly redirected) tier turns out to be. */
function snapSeverity(tier, minutes) {
  const snapped = Math.round(minutes / SENTENCE_STEP_MINUTES) * SENTENCE_STEP_MINUTES;
  return Math.max(tier.minutes[0], Math.min(tier.minutes[1], snapped));
}
function defaultSeverity(code, tierIndex) {
  const tier = resolveTier(code, tierIndex);
  return tier && tierIsRange(tier) ? snapSeverity(tier, (tier.minutes[0] + tier.minutes[1]) / 2) : null;
}
function syncCalcPickerSelections() {
  const selected = new Set(calcState.charges.map((charge) => charge.code));
  document.querySelectorAll(".calc-offense[data-add]").forEach((button) => {
    const isSelected = selected.has(button.dataset.add);
    button.disabled = isSelected;
    button.setAttribute("aria-pressed", String(isSelected));
  });
}
function addCharge(code) {
  if (calcState.charges.some((charge) => charge.code === code)) return;
  calcState.charges.push({ code, tierIndex: 0, severity: defaultSeverity(code, 0) });
  renderCalcPanel();
}
function removeChargeAt(index) { calcState.charges.splice(index, 1); renderCalcPanel(); }
function clearCharges() { calcState.charges = []; renderCalcPanel(); }
function setChargeTier(index, tierIndex) {
  const charge = calcState.charges[index];
  if (!charge) return;
  charge.tierIndex = tierIndex;
  charge.severity = defaultSeverity(charge.code, tierIndex);
  renderCalcPanel();
}
function setChargeSeverity(index, minutes) {
  const charge = calcState.charges[index];
  if (!charge) return;
  const tier = resolveTier(charge.code, charge.tierIndex);
  if (!tier || !tierIsRange(tier)) return;
  charge.severity = snapSeverity(tier, minutes);
  updateCalcNumbers(); // patch numbers in place — a full re-render would drop the slider mid-drag
}
function animateCalcTotal(target) {
  const el = byId("calcTotalNum");
  if (!el) return;
  const from = Number(el.dataset.shown ?? target);
  el.dataset.shown = String(target); // correct immediately; the tween below is cosmetic only
  if (motionOff() || from === target) { el.textContent = String(target); return; }
  const began = performance.now(); const duration = 500;
  const token = (animateCalcTotal.token = (animateCalcTotal.token || 0) + 1);
  const tick = (now) => {
    if (animateCalcTotal.token !== token) return; // a newer call already owns the final paint
    const t = Math.min(1, (now - began) / duration);
    el.textContent = String(Math.round(from + (target - from) * (1 - Math.pow(1 - t, 3))));
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  // Safety net: if rAF never fires (backgrounded tab, throttled frame loop, ...) the
  // number must still end up correct — never let a decorative tween own correctness.
  setTimeout(() => { if (animateCalcTotal.token === token) el.textContent = String(target); }, duration + 60);
}
/* Reflects the current verdict on the header droid without touching the rest of the
 * page — called both after a full panel re-render and after a severity drag. */
function updateDroidReaction(v) {
  const wrap = document.querySelector(".calc-droid-wrap");
  if (wrap) wrap.dataset.tier = v.tier;
  const droid = byId("calcDroid");
  if (droid) droid.dataset.tier = v.tier;
  const line = document.querySelector(".calc-droid-line");
  if (line) line.textContent = DROID_LINES[v.tier];
}
/* Dragging the severity slider fires continuously; rebuilding the panel's innerHTML on
 * every tick would recreate the <input> mid-drag and drop the pointer capture. This
 * patches just the numbers that can change from severity alone. */
function updateCalcNumbers() {
  const v = computeVerdict();
  renderQuickbar(v);
  animateCalcTotal(v.total);
  const banner = document.querySelector(".calc-banner");
  if (banner) {
    banner.className = `calc-banner tier-${v.tier}`;
    const label = banner.querySelector(".calc-banner-label");
    if (label) label.textContent = BANNER_LABEL[v.tier];
    const meter = banner.querySelector(".calc-meter i");
    if (meter) meter.style.width = `${Math.min(100, (v.total / BAN_MINUTES) * 100)}%`;
  }
  updateDroidReaction(v);
  v.resolved.forEach(({ index, tier, minutes }) => {
    if (!tier) return;
    const timeEl = document.querySelector(`[data-time="${index}"]`);
    if (timeEl) timeEl.textContent = tierBadge(tier, minutes);
    const labelEl = document.querySelector(`[data-severity-label="${index}"]`);
    if (labelEl) labelEl.textContent = `${minutes}m · ${severityLabel(tier, minutes)}`;
  });
}
function renderChargeRow({ charge, index, tier, minutes }) {
  if (!tier) return `<div class="calc-charge" style="--d:${Math.min(index * 40, 240)}ms"><div class="calc-charge-main"><span class="record-code">${escapeHtml(charge.code)}</span><span class="calc-charge-title">No sentencing data on file for this offense.</span><button type="button" class="calc-remove" data-remove="${index}" aria-label="Remove this charge">×</button></div></div>`;
  const entry = PUNISHMENTS[charge.code];
  const isRange = tierIsRange(tier);
  const tierSelect = entry.tiers.length > 1 ? `<div class="calc-tier-picker" data-tier-picker="${index}">
    <span class="calc-tier-picker-label">Offense count</span>
    <button type="button" class="calc-tier-btn" data-tier-toggle="${index}" aria-haspopup="listbox" aria-expanded="false">
      <span>${escapeHtml(entry.tiers[charge.tierIndex].label)}</span>
      <svg class="calc-tier-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
    </button>
    <div class="calc-tier-options" data-tier-options="${index}" role="listbox" aria-label="Which offense count is this?">
      ${entry.tiers.map((t, i) => `<button type="button" class="calc-tier-option${i === charge.tierIndex ? " active" : ""}" role="option" aria-selected="${i === charge.tierIndex}" data-tier-pick="${index}:${i}">${escapeHtml(t.label)}</button>`).join("")}
    </div>
  </div>` : "";
  const severity = isRange ? `<div class="calc-severity">
    <div class="calc-severity-head"><span>Severity</span><b data-severity-label="${index}">${minutes}m · ${severityLabel(tier, minutes)}</b></div>
    <input type="range" min="${tier.minutes[0]}" max="${tier.minutes[1]}" step="${SENTENCE_STEP_MINUTES}" value="${minutes}" data-severity="${index}" aria-label="Severity for this charge" />
  </div>` : "";
  const via = tier.viaLabel ? `<p class="calc-escalated">${escapeHtml(tier.viaLabel)}${tier.viaNote ? `: ${escapeHtml(tier.viaNote)}` : ""} — treated as ${escapeHtml(calcOffenseTitle(tier.sourceCode))} (${escapeHtml(tier.sourceCode)}).</p>` : "";
  const note = !tier.viaLabel && tier.note ? `<p class="calc-tier-note">${escapeHtml(tier.note)}</p>` : "";
  return `<div class="calc-charge" style="--d:${Math.min(index * 40, 240)}ms">
    <div class="calc-charge-main">
      <span class="record-code">${escapeHtml(charge.code)}</span>
      <span class="calc-charge-title">${escapeHtml(calcOffenseTitle(charge.code))}</span>
      <span class="calc-charge-time" data-time="${index}">${tierBadge(tier, minutes)}</span>
      <button type="button" class="calc-remove" data-remove="${index}" aria-label="Remove this charge">×</button>
    </div>
    ${tierSelect}
    ${severity}
    ${via}${note}
  </div>`;
}
function calcPickerColumn(section, index) {
  const offenses = section.cards.filter((record) => record.code);
  return `<div class="calc-column">
    <div class="calc-column-head"><span class="fast-index">${roman(index + 1)}</span><h3>${escapeHtml(section.name)}</h3></div>
    <div class="calc-offenses">${offenses.map((record) => {
      return `<button type="button" class="calc-offense" data-add="${escapeAttr(record.code)}" aria-pressed="false">
      <span class="record-code">${escapeHtml(record.code)}</span>
      <span class="calc-offense-title">${escapeHtml(record.title)}</span>
    </button>`;
    }).join("")}</div>
  </div>`;
}
function renderQuickbar(v) {
  const bar = byId("calcQuickbar");
  if (!bar) return;
  bar.innerHTML = `<a href="#calcVerdict" data-scroll class="calc-quickbar-inner tier-${v.tier}">
    <span class="calc-quickbar-label">${BANNER_LABEL[v.tier]}</span>
    <span class="calc-quickbar-total">${v.total} <small>min</small></span>
    <span class="calc-quickbar-meter"><i style="width:${Math.min(100, (v.total / BAN_MINUTES) * 100)}%"></i></span>
  </a>`;
}
function renderCalcPanel() {
  const panel = byId("calcVerdict");
  if (!panel) return;
  const v = computeVerdict();
  renderQuickbar(v);
  panel.innerHTML = `
    ${v.resolved.length ? `<button type="button" class="btn calc-clear" id="calcClear"><span aria-hidden="true">×</span> Clear all offenses</button>` : ""}
    <div class="calc-banner tier-${v.tier}">
      <span class="calc-banner-label">${BANNER_LABEL[v.tier]}</span>
      <div class="calc-total"><b id="calcTotalNum">${v.total}</b><span>minutes</span></div>
      <div class="calc-meter"><i style="width:${Math.min(100, (v.total / BAN_MINUTES) * 100)}%"></i></div>
    </div>
    ${v.flags.length ? `<ul class="calc-flags">${v.flags.map((flag) => `<li>${escapeHtml(flag)}</li>`).join("")}</ul>` : ""}
    <label class="calc-warrior"><input type="checkbox" id="calcWarriorToggle" ${calcState.warrior ? "checked" : ""} /><span>Offender holds Warrior rank or above</span></label>
    <div class="calc-stack" id="calcStack">${v.resolved.length ? v.resolved.map(renderChargeRow).join("") : `<p class="no-match">No charges stacked yet.</p>`}</div>
  `;
  animateCalcTotal(v.total);
  updateDroidReaction(v);
  syncCalcPickerSelections();
  byId("calcWarriorToggle").addEventListener("change", (event) => { calcState.warrior = event.target.checked; renderCalcPanel(); });
  panel.querySelectorAll("[data-severity]").forEach((input) => {
    input.addEventListener("input", (event) => setChargeSeverity(Number(input.dataset.severity), Number(event.target.value)));
  });
}
function renderReferenceTable() {
  return offenseSections().map((section) => `
    <h3>${escapeHtml(section.name)}</h3>
    <div class="calc-ref-table-wrap"><table class="calc-ref-table">
      <thead><tr><th>Code</th><th>Offense</th><th>1st</th><th>2nd</th><th>3rd/4th</th></tr></thead>
      <tbody>${section.cards.filter((record) => record.code).map((record) => {
        const entry = PUNISHMENTS[record.code];
        const cell = (i) => entry && entry.tiers[i] ? escapeHtml(tierRangeLabel(entry.tiers[i])) : "—";
        const rest = entry && entry.tiers.length > 2 ? entry.tiers.slice(2).map((t) => escapeHtml(tierRangeLabel(t))).join(" / ") : "—";
        return `<tr><td><span class="record-code">${escapeHtml(record.code)}</span></td><td>${escapeHtml(record.title)}</td><td>${cell(0)}</td><td>${cell(1)}</td><td>${rest}</td></tr>`;
      }).join("")}</tbody>
    </table></div>
  `).join("");
}
function openReference() {
  closeMenus();
  byId("refBody").innerHTML = renderReferenceTable();
  byId("refPanel").hidden = false; document.body.style.overflow = "hidden";
}
function closeReference() {
  if (byId("refPanel").hidden) return;
  byId("refPanel").hidden = true; document.body.style.overflow = "";
}
function renderCalculator(options) {
  document.title = "Sentencing Calculator — TSO Doctrine";
  app.innerHTML = `<div class="page calc-page">
    <nav class="breadcrumb" aria-label="Breadcrumb"><a href="${link("/")}" data-link>Archive</a><span aria-hidden="true">◆</span><span>Sentencing Calculator</span></nav>
    <header class="calc-header">
      <div class="calc-header-text">
        <div class="eyebrow">The Inquisition</div>
        <h1>Sentencing Calculator</h1>
        <p>Stack every offense the individual committed, pick which offense number each one is and how severe it was, and the sentence updates live — a total of ${BAN_MINUTES} minutes or more calls for a server ban.</p>
        <button type="button" class="calc-ref-trigger" data-open-ref>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 9h18M9 9v11"/></svg>
          <span>Reference table</span>
        </button>
      </div>
      <div class="calc-droid-wrap" data-tier="empty">
        <div class="calc-droid-stage">
          <div class="calc-droid" id="calcDroid" data-tier="empty">
            <div class="calc-droid-glow"></div>
            <img src="/assets/inquisitor-droid-red-transparent.webp" alt="An Inquisition arrest droid" />
            <i class="droid-scan" aria-hidden="true"></i>
          </div>
        </div>
        <p class="calc-droid-line" aria-live="polite">${escapeHtml(DROID_LINES.empty)}</p>
      </div>
    </header>
    <div class="calc-quickbar" id="calcQuickbar"></div>
    <div class="calc-layout">
      <div class="calc-picker" id="calcPicker">${offenseSections().map(calcPickerColumn).join("")}</div>
      <aside class="calc-verdict" id="calcVerdict" aria-label="Verdict"></aside>
    </div>
  </div>`;
  renderCalcPanel();
  afterRender(options);
}

/* ───────── Search ───────── */
function openSearch(prefill) {
  closeMenus();
  const input = byId("globalSearch");
  if (typeof prefill === "string") input.value = prefill;
  byId("searchPanel").hidden = false; document.body.style.overflow = "hidden";
  input.focus(); input.setSelectionRange(input.value.length, input.value.length);
  renderSearch(input.value);
}
function closeSearch() {
  if (byId("searchPanel").hidden) return;
  byId("searchPanel").hidden = true; document.body.style.overflow = ""; byId("globalSearch").value = "";
  const hero = byId("heroSearch")?.querySelector("input");
  if (hero) { hero.value = ""; hero.blur(); }
}
function highlight(text, query) {
  if (!query) return escapeHtml(text);
  const at = text.toLowerCase().indexOf(query);
  if (at < 0) return escapeHtml(text);
  return `${escapeHtml(text.slice(0, at))}<mark>${escapeHtml(text.slice(at, at + query.length))}</mark>${escapeHtml(text.slice(at + query.length))}`;
}
function snippet(record, query) {
  const text = stripMarkdown(record.description.replace(/^\s*#{1,6}\s+.*$/gm, ""));
  if (!text) return "";
  const at = query ? text.toLowerCase().indexOf(query) : -1;
  const from = at > 40 ? text.lastIndexOf(" ", at - 40) + 1 : 0;
  return `${from ? "…" : ""}${text.slice(from, from + 140)}`;
}
function renderSearch(query) {
  const value = query.trim().toLowerCase();
  const records = searchableRecords();
  const rank = (record) => (record.name.toLowerCase().includes(value) ? 0 : record.section.name.toLowerCase().includes(value) ? 1 : 2);
  const matches = records.filter((record) => !value || `${record.name} ${record.description} ${record.section.name}`.toLowerCase().includes(value)).sort((a, b) => (value ? rank(a) - rank(b) : 0)).slice(0, 30);
  state.searchMatches = matches; state.searchIndex = 0;
  byId("searchCount").textContent = value ? `${matches.length} ${matches.length === 1 ? "match" : "matches"}` : plural(records.length, "record");
  byId("searchResults").innerHTML = matches.length ? matches.map((record, index) => {
    const image = primaryImage(record);
    return `<a class="search-result${index === 0 ? " active" : ""}" href="${recordHref(record)}" data-link data-index="${index}"><span class="search-thumb">${image ? `<img src="${escapeAttr(image.imageUrl)}" alt="" loading="lazy" />` : glyph(record.id)}</span><span><small>${escapeHtml(record.section.name)}${record.code ? ` · ${escapeHtml(record.code)}` : ""}</small><strong>${highlight(record.title, value)}</strong><p>${highlight(snippet(record, value), value)}</p></span><b aria-hidden="true">→</b></a>`;
  }).join("") : `<div class="search-empty">No records match “${escapeHtml(query)}”.</div>`;
  bindImageFallbacks(byId("searchResults"));
}
function moveSearch(step) {
  const items = byId("searchResults").querySelectorAll(".search-result");
  if (!items.length) return;
  state.searchIndex = (state.searchIndex + step + items.length) % items.length;
  items.forEach((item, index) => item.classList.toggle("active", index === state.searchIndex));
  items[state.searchIndex].scrollIntoView({ block: "nearest" });
}

/* ───────── Interaction ───────── */
function closeMenus() {
  byId("mainNav").classList.remove("open"); byId("menuToggle").setAttribute("aria-expanded", "false");
  byId("sectionsPopover").classList.remove("open"); byId("sectionsButton").setAttribute("aria-expanded", "false");
}
function bindImageFallbacks(root) {
  root.querySelectorAll("img").forEach((image) => image.addEventListener("error", () => {
    const thumb = image.closest(".record-image, .search-thumb");
    if (thumb) { thumb.classList.add("is-glyph"); thumb.innerHTML = glyph(thumb.closest("[data-seed]")?.dataset.seed || image.alt || "record"); return; }
    (image.closest("figure, .hero-media") || image).remove();
  }, { once: true }));
}
function toast(message) {
  const node = byId("toast");
  node.textContent = message; node.classList.add("show");
  clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.remove("show"), 4200);
}
function openLightbox(src, caption) { byId("lightboxImage").src = src; byId("lightboxImage").alt = caption; byId("lightboxCaption").textContent = caption; byId("lightbox").hidden = false; }
function closeLightbox() { byId("lightbox").hidden = true; byId("lightboxImage").removeAttribute("src"); }

document.addEventListener("click", (event) => {
  const anchor = event.target.closest("a[data-link]");
  if (anchor) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    navigate(anchor.getAttribute("href")); return;
  }
  const scroller = event.target.closest("a[data-scroll]");
  if (scroller) { event.preventDefault(); byId(scroller.getAttribute("href").slice(1))?.scrollIntoView({ behavior: motionOff() ? "auto" : "smooth", block: "start" }); return; }
  if (event.target.closest("[data-open-search]")) { openSearch(); return; }
  const addCharge_ = event.target.closest("[data-add]");
  if (addCharge_) { addCharge(addCharge_.dataset.add); return; }
  const removeCharge_ = event.target.closest("[data-remove]");
  if (removeCharge_) { removeChargeAt(Number(removeCharge_.dataset.remove)); return; }
  if (event.target.closest("#calcClear")) { clearCharges(); return; }
  const tierToggle = event.target.closest("[data-tier-toggle]");
  if (tierToggle) {
    const options = document.querySelector(`[data-tier-options="${tierToggle.dataset.tierToggle}"]`);
    const open = options.classList.toggle("open");
    tierToggle.setAttribute("aria-expanded", String(open));
    tierToggle.closest(".calc-charge")?.classList.toggle("tier-menu-open", open);
    document.querySelectorAll(".calc-tier-options.open").forEach((el) => {
      if (el !== options) {
        el.classList.remove("open");
        el.previousElementSibling.setAttribute("aria-expanded", "false");
        el.closest(".calc-charge")?.classList.remove("tier-menu-open");
      }
    });
    return;
  }
  const tierPick = event.target.closest("[data-tier-pick]");
  if (tierPick) { const [index, tierIndex] = tierPick.dataset.tierPick.split(":").map(Number); setChargeTier(index, tierIndex); return; }
  if (event.target.closest("[data-open-ref]")) { openReference(); return; }
  if (event.target.closest("#closeRef") || event.target === byId("refPanel")) { closeReference(); return; }
  const zoom = event.target.closest("[data-zoom]");
  if (zoom) { openLightbox(zoom.dataset.zoom, zoom.dataset.caption || ""); return; }
  if (event.target.closest("#lightbox")) { closeLightbox(); return; }
  if (event.target === byId("searchPanel")) { closeSearch(); return; }
  if (!event.target.closest(".sections-menu")) { byId("sectionsPopover").classList.remove("open"); byId("sectionsButton").setAttribute("aria-expanded", "false"); }
  if (!event.target.closest(".calc-tier-picker")) {
    document.querySelectorAll(".calc-tier-options.open").forEach((el) => {
      el.classList.remove("open");
      el.previousElementSibling.setAttribute("aria-expanded", "false");
      el.closest(".calc-charge")?.classList.remove("tier-menu-open");
    });
  }
});

let revealObserver = null;
function observeReveals(root) {
  const items = root.querySelectorAll("[data-reveal]");
  if (!("IntersectionObserver" in window) || motionOff()) { items.forEach((item) => item.classList.add("in")); return; }
  document.documentElement.classList.add("reveal-ready");
  revealObserver?.disconnect();
  revealObserver = new IntersectionObserver((entries) => entries.forEach((entry) => { if (entry.isIntersecting) { entry.target.classList.add("in"); revealObserver.unobserve(entry.target); } }), { rootMargin: "0px 0px -6% 0px" });
  items.forEach((item) => revealObserver.observe(item));
  clearTimeout(observeReveals.timer);
  observeReveals.timer = setTimeout(() => items.forEach((item) => item.classList.add("in")), 1500); // never leave content hidden
}

let headingObserver = null;
function spyHeadings() {
  headingObserver?.disconnect();
  const links = [...app.querySelectorAll(".article-aside a[data-scroll]")];
  if (!links.length || !("IntersectionObserver" in window)) return;
  const activate = (id) => links.forEach((item) => item.classList.toggle("active", item.getAttribute("href") === `#${id}`));
  links[0].classList.add("active");
  headingObserver = new IntersectionObserver((entries) => entries.forEach((entry) => { if (entry.isIntersecting) activate(entry.target.id); }), { rootMargin: "-15% 0px -70% 0px" });
  app.querySelectorAll(".prose h2[id], .prose h3[id]").forEach((heading) => headingObserver.observe(heading));
}

function bindMotion(root) {
  if (motionOff() || !matchMedia("(hover: hover)").matches) return;
  root.querySelectorAll(".holo").forEach((tile) => {
    tile.addEventListener("pointermove", (event) => {
      const box = tile.getBoundingClientRect();
      const x = (event.clientX - box.left) / box.width; const y = (event.clientY - box.top) / box.height;
      tile.style.setProperty("--card-x", `${x * 100}%`); tile.style.setProperty("--card-y", `${y * 100}%`);
      tile.style.setProperty("--tilt-x", `${(x - .5) * 5}deg`); tile.style.setProperty("--tilt-y", `${(.5 - y) * 5}deg`);
    });
    tile.addEventListener("pointerleave", () => { tile.style.setProperty("--tilt-x", "0deg"); tile.style.setProperty("--tilt-y", "0deg"); });
  });
}

let atmosphere = null;
/* Called at boot and on every lite toggle: starts the embers, resumes them, or stops
 * and clears them, whichever the current setting calls for. */
function applyAtmosphere() {
  if (motionOff()) { atmosphere?.stop(); return; }
  if (atmosphere) atmosphere.resume(); else createAtmosphere();
}
function createAtmosphere() {
  if (motionOff()) return;
  let frame = 0;
  window.addEventListener("pointermove", (event) => {
    if (frame || motionOff()) return;
    frame = requestAnimationFrame(() => {
      const root = document.documentElement.style;
      root.setProperty("--pointer-x", `${event.clientX}px`); root.setProperty("--pointer-y", `${event.clientY}px`);
      const sigil = byId("heroSigil");
      if (sigil) { sigil.style.setProperty("--sx", `${(event.clientX / innerWidth - .5) * 16}deg`); sigil.style.setProperty("--sy", `${(.5 - event.clientY / innerHeight) * 12}deg`); }
      const droid = byId("calcDroid");
      if (droid) { const box = droid.getBoundingClientRect(); const dx = (event.clientX - (box.left + box.width / 2)) / innerWidth; const dy = (event.clientY - (box.top + box.height / 2)) / innerHeight; droid.style.setProperty("--dx", `${dx * 10}deg`); droid.style.setProperty("--dy", `${dy * -8}deg`); }
      frame = 0;
    });
  }, { passive: true });

  const canvas = byId("embers"); const context = canvas?.getContext("2d");
  if (!context) return;
  const colors = ["255,83,99", "217,52,74", "229,168,93", "255,217,201"];
  let width = 0, height = 0, embers = [], running = true;
  const spawn = (anywhere) => ({ x: Math.random() * width, y: anywhere ? Math.random() * height : height + 10, size: .6 + Math.random() * 1.8, speed: .15 + Math.random() * .55, sway: Math.random() * Math.PI * 2, swaySpeed: .004 + Math.random() * .012, alpha: .15 + Math.random() * .5, color: colors[Math.floor(Math.random() * colors.length)] });
  const resize = () => {
    const ratio = Math.min(devicePixelRatio || 1, 2);
    width = innerWidth; height = innerHeight;
    canvas.width = width * ratio; canvas.height = height * ratio; context.setTransform(ratio, 0, 0, ratio, 0, 0);
    embers = Array.from({ length: Math.round(Math.min(70, Math.max(24, width / 22))) }, () => spawn(true));
  };
  const draw = () => {
    if (!running) return;
    if (motionOff()) { running = false; context.clearRect(0, 0, width, height); return; }
    if (document.documentElement.classList.contains("board-open")) { requestAnimationFrame(draw); return; }
    context.clearRect(0, 0, width, height);
    context.globalCompositeOperation = "lighter";
    for (const ember of embers) {
      ember.y -= ember.speed; ember.sway += ember.swaySpeed; ember.x += Math.sin(ember.sway) * .35;
      if (ember.y < -12) Object.assign(ember, spawn(false));
      const fade = Math.min(1, ember.y / (height * .35)) * ember.alpha * (.75 + Math.sin(ember.sway * 3) * .25);
      context.fillStyle = `rgba(${ember.color},${(fade * .1).toFixed(3)})`;
      context.beginPath(); context.arc(ember.x, ember.y, ember.size * 2.6, 0, Math.PI * 2); context.fill();
      context.fillStyle = `rgba(${ember.color},${fade.toFixed(3)})`;
      context.beginPath(); context.arc(ember.x, ember.y, ember.size, 0, Math.PI * 2); context.fill();
    }
    requestAnimationFrame(draw);
  };
  resize(); draw();
  window.addEventListener("resize", resize, { passive: true });
  document.addEventListener("visibilitychange", () => { const wasRunning = running; running = !document.hidden && !motionOff(); if (running && !wasRunning) draw(); });
  atmosphere = {
    stop() { running = false; context.clearRect(0, 0, width, height); },
    resume() { if (running) return; running = true; resize(); draw(); }
  };
}

document.addEventListener("pointerdown", (event) => {
  if (motionOff() || event.button !== 0) return;
  const target = event.target.closest(".btn, .search-trigger, .holo, a.record-row, .attachment-links a, .next-record a");
  if (!target) return;
  target.classList.add("ripple-host");
  const box = target.getBoundingClientRect();
  const ripple = document.createElement("span");
  ripple.className = "click-ripple";
  ripple.style.left = `${event.clientX - box.left}px`; ripple.style.top = `${event.clientY - box.top}px`;
  target.appendChild(ripple);
  ripple.addEventListener("animationend", () => ripple.remove(), { once: true });
});

function updateProgress() {
  const max = document.documentElement.scrollHeight - innerHeight;
  byId("readingProgress").style.transform = `scaleX(${max > 0 ? Math.min(1, scrollY / max) : 0})`;
  byId("siteHeader").classList.toggle("scrolled", scrollY > 12);
}
window.addEventListener("scroll", updateProgress, { passive: true });

/* ───────── Markdown ─────────
 * A small renderer for the flavour of Markdown Trello produces. It understands
 * headings, paragraphs (single newlines become line breaks, as on Trello), bullet and
 * numbered lists, multi-line blockquotes (a bare ">" is a paragraph break inside the
 * quote), horizontal rules, inline images and links, bold, italic and code.
 * A line that is nothing but a code span is treated as a worked example. */
const IMAGE_LINE = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/;
function markdown(source = "", context = {}) {
  const lines = cleanText(source).split("\n");
  const out = [];
  let list = null, paragraph = [], quote = null;
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const flushParagraph = () => {
    if (!paragraph.length) return;
    if (paragraph.length === 1 && /^`[^`]+`$/.test(paragraph[0])) out.push(`<p class="example">${inline(paragraph[0].slice(1, -1))}</p>`);
    else out.push(`<p>${paragraph.map(inline).join("<br>")}</p>`);
    paragraph = [];
  };
  const flushQuote = () => { if (quote) { out.push(`<blockquote>${markdown(quote.join("\n"), context)}</blockquote>`); quote = null; } };
  const flushAll = () => { flushParagraph(); closeList(); flushQuote(); };
  for (const raw of lines) {
    const line = raw.trim();
    const quoted = line.match(/^>\s?(.*)$/);
    if (quoted) { flushParagraph(); closeList(); (quote ||= []).push(quoted[1]); continue; }
    if (quote) flushQuote();
    if (!line) { flushParagraph(); closeList(); continue; }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) { flushAll(); out.push("<hr>"); continue; }
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) { flushAll(); const level = Math.min(3, Math.max(2, heading[1].length)); const text = stripMarkdown(heading[2]); out.push(`<h${level} id="${slug(text)}">${inline(heading[2])}</h${level}>`); continue; }
    const image = line.match(IMAGE_LINE);
    if (image) { flushAll(); const html = figureFor(image[2], image[1], context); if (html) out.push(html); continue; }
    const bullet = line.match(/^[-*+]\s+(.+)$/);
    if (bullet) { flushParagraph(); flushQuote(); if (list !== "ul") { closeList(); list = "ul"; out.push("<ul>"); } out.push(`<li>${inline(bullet[1])}</li>`); continue; }
    const number = line.match(/^\d+[.)]\s+(.+)$/);
    if (number) { flushParagraph(); flushQuote(); if (list !== "ol") { closeList(); list = "ol"; out.push("<ol>"); } out.push(`<li>${inline(number[1])}</li>`); continue; }
    closeList(); paragraph.push(line);
  }
  flushAll();
  return out.join("");
}
/* Trello attachment URLs need a login, so an inline image is only rendered when it maps
 * to an attachment the Worker can proxy. The cover image is already shown above the text. */
function figureFor(url, alt, context) {
  const attachment = (context.record?.attachments || []).find((item) => item.isImage && (url.includes(item.id) || url === item.url));
  if (!attachment) return "";
  if (context.hero && attachment.id === context.hero.id) return "";
  context.shown?.add(attachment.id);
  const caption = alt && !/^(image|img|screenshot)?[\s_-]*\d*(\.\w+)?$/i.test(alt) ? alt : captionOf(attachment, context.record || {});
  return `<figure><button data-zoom="${escapeAttr(attachment.imageUrl)}" data-caption="${escapeAttr(caption)}" aria-label="Enlarge image"><img src="${escapeAttr(attachment.imageUrl)}" alt="${escapeAttr(caption)}" loading="lazy" /></button>${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ""}</figure>`;
}
function inline(value = "") {
  const tokens = [];
  const keep = (html) => { tokens.push(html); return `\u0000${tokens.length - 1}\u0000`; };
  let text = value;
  text = text.replace(/`([^`]+)`/g, (_, code) => keep(`<code>${escapeHtml(code)}</code>`));
  text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, alt) => alt || "");
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, label, url) => keep(anchor(url, label)));
  text = text.replace(/(^|[\s(])((?:https?:\/\/)[^\s<>)]+)/g, (_, lead, url) => `${lead}${keep(anchor(url, url))}`);
  text = escapeHtml(text);
  text = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/__(.+?)__/g, "<strong>$1</strong>");
  text = text.replace(/(^|[^\w*])\*(?!\s)([^*]+?)\*(?!\w)/g, "$1<em>$2</em>").replace(/(^|[^\w_])_(?!\s)([^_]+?)_(?!\w)/g, "$1<em>$2</em>");
  text = text.replace(/~~(.+?)~~/g, "<s>$1</s>");
  return text.replace(/\u0000(\d+)\u0000/g, (_, index) => tokens[Number(index)]);
}
function anchor(url, label) {
  const href = safeUrl(url);
  if (href === "#") return escapeHtml(label);
  const bare = label.trim() === url.trim();
  let text = label;
  if (bare) { try { const parsed = new URL(url); text = parsed.hostname.replace(/^www\./, "") + (parsed.pathname.length > 1 ? parsed.pathname.replace(/\/+$/, "").split("/").slice(0, 3).join("/") + (parsed.pathname.split("/").length > 4 ? "/…" : "") : ""); } catch { text = url; } }
  return `<a href="${href}" target="_blank" rel="noopener"${bare ? ' class="bare-link"' : ""}>${escapeHtml(text)}${bare ? " ↗" : ""}</a>`;
}
function extractHeadings(source = "") {
  return cleanText(source).split("\n").map((line) => line.trim().match(/^(#{1,6})\s+(.+?)\s*#*$/)).filter(Boolean).map((match) => {
    const text = stripMarkdown(match[2]);
    return { level: Math.min(3, Math.max(2, match[1].length)), text, id: slug(text) };
  });
}
function excerpt(record) {
  const text = stripMarkdown(record.description.replace(/^\s*#{1,6}\s.*$/gm, ""));
  if (text) return text.length > 180 ? `${text.slice(0, 177).replace(/\s+\S*$/, "")}…` : text;
  const images = imageAttachments(record).length;
  return images ? `Illustrated record · ${plural(images, "image")}` : "Open this record.";
}
function stripMarkdown(value = "") {
  return cleanText(value)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "")
    .replace(/^(?:-{3,}|\*{3,}|_{3,})$/gm, "")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[^\w*])\*([^*]+?)\*/g, "$1$2")
    .replace(/(^|[^\w_])_([^_]+?)_(?!\w)/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}
function escapeHtml(value = "") { return String(value).replace(/[&<>'"]/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" }[char])); }
function escapeAttr(value = "") { return escapeHtml(value); }
function safeUrl(value = "") { try { const url = new URL(value); return ["http:","https:"].includes(url.protocol) ? escapeAttr(url.href) : "#"; } catch { return "#"; } }

/* ───────── Boot ───────── */
byId("menuToggle").addEventListener("click", () => { const open = byId("mainNav").classList.toggle("open"); byId("menuToggle").setAttribute("aria-expanded", String(open)); });
byId("sectionsButton").addEventListener("click", () => { const open = byId("sectionsPopover").classList.toggle("open"); byId("sectionsButton").setAttribute("aria-expanded", String(open)); });
byId("searchTrigger").addEventListener("click", () => openSearch());
byId("closeSearch").addEventListener("click", closeSearch);
byId("globalSearch").addEventListener("input", (event) => renderSearch(event.target.value));
byId("globalSearch").addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown") { event.preventDefault(); moveSearch(1); }
  if (event.key === "ArrowUp") { event.preventDefault(); moveSearch(-1); }
  if (event.key === "Enter") { const record = state.searchMatches[state.searchIndex]; if (record) { event.preventDefault(); navigate(recordHref(record)); } }
});
document.addEventListener("keydown", (event) => {
  const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || "");
  if ((event.key === "/" && !typing && !event.metaKey && !event.ctrlKey) || (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey))) { event.preventDefault(); openSearch(); }
  if (event.key === "Escape") { closeLightbox(); closeSearch(); closeReference(); closeMenus(); }
});
byId("fxToggle").addEventListener("click", toggleFxMode);
window.addEventListener(PREVIEW ? "hashchange" : "popstate", () => route());
applyChosenFxMode();
applyAtmosphere();
start();
