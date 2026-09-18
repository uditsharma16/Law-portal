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
const app = document.getElementById("app");
const byId = (id) => document.getElementById(id);
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const LABEL_COLORS = { green: "#5fbf8a", yellow: "#e2c45a", orange: "#f0994a", red: "#ff6471", purple: "#b48cf2", blue: "#6aa5ff", sky: "#63cdf0", lime: "#a6d65c", pink: "#f58ac4", black: "#a79da0" };

/* ───────── Data + live sync ───────── */
async function loadBoard() {
  if (PREVIEW) return { ...PREVIEW.board, preview: true };
  const response = await fetch("/api/board", { cache: "no-store" });
  if (!response.ok) throw new Error("Board unavailable");
  const board = await response.json();
  if (!board.ok || !Array.isArray(board.lists)) throw new Error("Board unavailable");
  return board;
}
const signatureOf = (board) => JSON.stringify([board.name, board.description, board.lists]);

async function start() {
  try {
    state.board = await loadBoard();
    state.live = !state.board.preview;
  } catch {
    state.board = fallback;
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
}

async function refresh() {
  if (document.hidden) return;
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
  if (document.startViewTransition && !reducedMotion.matches && !options.instant) document.startViewTransition(render);
  else render();
}
function navigate(href) {
  const path = href.replace(/^#/, "") || "/";
  closeSearch(); closeMenus();
  if (path === currentPath()) { scrollTo({ top: 0, behavior: "smooth" }); return; }
  if (PREVIEW) location.hash = path; // hashchange triggers route()
  else { history.pushState({}, "", path); route(); }
}
function afterRender(options = {}) {
  bindImageFallbacks(app); bindMotion(app); observeReveals(app);
  if (!options.preserveScroll) { scrollTo({ top: 0, behavior: "auto" }); app.focus({ preventScroll: true }); }
  updateProgress();
}

/* ───────── Views ───────── */
function renderMenus() {
  byId("sectionsPopover").innerHTML = state.board.lists.map((section, index) => `<a href="${sectionHref(section)}" data-link><em>${roman(index + 1)}</em><span>${escapeHtml(section.name)}</span><small>${section.cards.length}</small></a>`).join("");
}

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
  const records = allRecords();
  const tickerItems = records.map((record) => `<a href="${recordHref(record)}" data-link tabindex="-1">${escapeHtml(record.name)}</a>`).join("");
  app.innerHTML = `<div class="page">
    <section class="hero">
      <div class="hero-copy">
        <div class="eyebrow">The Sith Order</div>
        <h1 class="hero-title"><span>Doctrine</span><span>Archive</span></h1>
        <p class="hero-lead">${escapeHtml(state.board.description || "The central record of the Order: doctrine, authority, training and law.")}</p>
        <div class="hero-actions">
          <button class="btn btn-primary" data-open-search>Search the archive <kbd>/</kbd></button>
          <a class="btn" href="#sections" data-scroll>Browse sections ↓</a>
        </div>
        <ul class="hero-stats">
          <li><b data-count="${state.board.lists.length}">${state.board.lists.length}</b><span>Sections</span></li>
          <li><b data-count="${records.length}">${records.length}</b><span>Records</span></li>
          <li><b data-count="${records.filter((record) => primaryImage(record)).length}">${records.filter((record) => primaryImage(record)).length}</b><span>Illustrated</span></li>
        </ul>
      </div>
      <div class="hero-sigil" id="heroSigil">${HERO_SIGIL}</div>
    </section>
    ${records.length > 3 ? `<div class="ticker" aria-hidden="true"><div class="ticker-track" style="--ticker-time:${Math.max(30, records.length * 4)}s">${tickerItems}${tickerItems}</div></div>` : ""}
    <div class="rule" id="sections"><i></i>Sections of the doctrine<i></i></div>
    <section class="section-index" aria-label="Doctrine sections">
      ${state.board.lists.map((section, index) => `<a class="holo" href="${sectionHref(section)}" data-link data-reveal style="--d:${Math.min(index * 70, 420)}ms">
        ${glyph(section.id + section.name)}
        <div class="holo-top"><span>Section ${roman(index + 1)}</span><span>${section.cards.length} ${section.cards.length === 1 ? "record" : "records"}</span></div>
        <h2>${escapeHtml(section.name)}</h2>
        ${section.cards.length ? `<ul>${section.cards.slice(0, 3).map((record) => `<li>${escapeHtml(record.name)}</li>`).join("")}</ul>` : `<ul><li>Awaiting records</li></ul>`}
        <span class="holo-arrow" aria-hidden="true">→</span>
      </a>`).join("")}
    </section>
  </div>`;
  afterRender(options);
  if (!options?.preserveScroll) countUp(app);
}

function renderSection(section, options) {
  document.title = `${section.name} — TSO Doctrine`;
  const index = state.board.lists.indexOf(section);
  app.innerHTML = `<div class="page">
    <nav class="breadcrumb" aria-label="Breadcrumb"><a href="${link("/")}" data-link>Archive</a><span aria-hidden="true">◆</span><span>${escapeHtml(section.name)}</span></nav>
    <header class="section-header">
      ${glyph(section.id + section.name)}
      <div class="eyebrow">Section ${roman(index + 1)}</div>
      <h1>${escapeHtml(section.name)}</h1>
      <div class="section-tools">
        <span id="sectionCount">${section.cards.length} ${section.cards.length === 1 ? "record" : "records"} on file</span>
        ${section.cards.length > 3 ? `<label class="filter"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><input id="sectionFilter" type="search" placeholder="Filter this section…" autocomplete="off" aria-label="Filter records in this section" /></label>` : ""}
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
    byId("sectionCount").textContent = value ? `${shown} of ${section.cards.length} records` : `${section.cards.length} records on file`;
  });
  afterRender(options);
}

function recordRow(record, index = 0) {
  const image = primaryImage(record);
  return `<a class="record-row" href="${recordHref(record)}" data-link data-reveal data-seed="${escapeAttr(record.id)}" data-text="${escapeAttr(`${record.name} ${stripMarkdown(record.description)}`.toLowerCase())}" style="--d:${Math.min(index * 50, 300)}ms">
    <span class="record-num">${pad(index + 1)}</span>
    <div><h2>${escapeHtml(record.name)}</h2><p>${escapeHtml(excerpt(record.description))}</p>${chips(record)}</div>
    ${image ? `<div class="record-image"><img src="${escapeAttr(image.imageUrl)}" alt="${escapeAttr(image.name || record.name)}" loading="lazy" /></div>` : `<div class="record-image is-glyph">${glyph(record.id)}</div>`}
    <span class="record-arrow" aria-hidden="true">→</span>
  </a>`;
}

function renderRecord(record, options) {
  document.title = `${record.name} — TSO Doctrine`;
  const images = imageAttachments(record);
  const hero = primaryImage(record);
  const gallery = images.filter((image) => image.id !== hero?.id);
  const documents = (record.attachments || []).filter((item) => !item.isImage);
  const siblings = record.section.cards;
  const current = siblings.findIndex((item) => item.id === record.id);
  const previous = current > 0 ? siblings[current - 1] : null;
  const next = current < siblings.length - 1 ? siblings[current + 1] : null;
  const headings = extractHeadings(record.description);
  const figure = (image, lazy) => `<figure><button data-zoom="${escapeAttr(image.imageUrl)}" data-caption="${escapeAttr(image.name || record.name)}" aria-label="Enlarge image"><img src="${escapeAttr(image.imageUrl)}" alt="${escapeAttr(image.name || record.name)}" ${lazy ? 'loading="lazy"' : ""} /></button><figcaption>${escapeHtml(image.name || "Archive image")}</figcaption></figure>`;

  app.innerHTML = `<article class="page article-page">
    <nav class="breadcrumb" aria-label="Breadcrumb"><a href="${link("/")}" data-link>Archive</a><span aria-hidden="true">◆</span><a href="${sectionHref(record.section)}" data-link>${escapeHtml(record.section.name)}</a><span aria-hidden="true">◆</span><span>${escapeHtml(record.name)}</span></nav>
    <header class="article-header">
      <div class="eyebrow">${escapeHtml(record.section.name)}</div>
      <h1>${escapeHtml(record.name)}</h1>
      <div class="article-meta"><span>Record ${pad(current + 1)} of ${pad(siblings.length)}</span><span>${readingTime(record.description)} min read</span>${chips(record)}</div>
    </header>
    ${hero ? `<div class="hero-media">${figure(hero, false)}</div>` : ""}
    <div class="article-layout">
      <div class="prose">${markdown(record.description)}</div>
      <aside class="article-aside" aria-label="In this record"><strong>In this record</strong>${headings.length ? headings.map((heading) => `<a href="#${heading.id}" data-scroll class="${heading.level === 3 ? "sub" : ""}">${escapeHtml(heading.text)}</a>`).join("") : `<a href="${sectionHref(record.section)}" data-link>← Back to section</a>`}</aside>
    </div>
    ${gallery.length ? `<div class="rule"><i></i>Archive imagery<i></i></div><section class="gallery" aria-label="Record images">${gallery.map((image) => figure(image, true)).join("")}</section>` : ""}
    ${documents.length || record.url ? `<div class="rule"><i></i>References<i></i></div><section class="attachments"><div class="attachment-links">${documents.map((item) => `<a href="${safeUrl(item.url)}" target="_blank" rel="noopener">${escapeHtml(item.name || "Attachment")} ↗</a>`).join("")}${record.url ? `<a href="${safeUrl(record.url)}" target="_blank" rel="noopener">View source card ↗</a>` : ""}</div></section>` : ""}
    ${(previous || next) ? `<nav class="next-record" aria-label="Adjacent records">${previous ? `<a href="${recordHref(previous)}" data-link><small>← Previous record</small>${escapeHtml(previous.name)}</a>` : ""}${next ? `<a class="next" href="${recordHref(next)}" data-link><small>Next record →</small>${escapeHtml(next.name)}</a>` : ""}</nav>` : ""}
  </article>`;
  afterRender(options);
  spyHeadings();
}

function renderNotFound() {
  document.title = "Record not found — TSO Doctrine";
  app.innerHTML = `<div class="empty-page">${glyph("void")}<h1>Record not found</h1><p>This archive reference does not exist, or it has been struck from the record.</p><a class="btn" href="${link("/")}" data-link>Return to the archive</a></div>`;
  afterRender();
}

/* ───────── Search ───────── */
function openSearch() { closeMenus(); byId("searchPanel").hidden = false; document.body.style.overflow = "hidden"; byId("globalSearch").focus(); renderSearch(byId("globalSearch").value); }
function closeSearch() { if (byId("searchPanel").hidden) return; byId("searchPanel").hidden = true; document.body.style.overflow = ""; byId("globalSearch").value = ""; }
function highlight(text, query) {
  if (!query) return escapeHtml(text);
  const at = text.toLowerCase().indexOf(query);
  if (at < 0) return escapeHtml(text);
  return `${escapeHtml(text.slice(0, at))}<mark>${escapeHtml(text.slice(at, at + query.length))}</mark>${escapeHtml(text.slice(at + query.length))}`;
}
function snippet(record, query) {
  const text = stripMarkdown(record.description.replace(/^\s*#{1,6}\s+/gm, ""));
  if (!text) return "";
  const at = query ? text.toLowerCase().indexOf(query) : -1;
  const from = at > 40 ? at - 40 : 0;
  return `${from ? "…" : ""}${text.slice(from, from + 120)}`;
}
function renderSearch(query) {
  const value = query.trim().toLowerCase();
  const records = allRecords();
  const rank = (record) => (record.name.toLowerCase().includes(value) ? 0 : record.section.name.toLowerCase().includes(value) ? 1 : 2);
  const matches = records.filter((record) => !value || `${record.name} ${record.description} ${record.section.name}`.toLowerCase().includes(value)).sort((a, b) => (value ? rank(a) - rank(b) : 0)).slice(0, 30);
  state.searchMatches = matches; state.searchIndex = 0;
  byId("searchCount").textContent = value ? `${matches.length} ${matches.length === 1 ? "match" : "matches"}` : `${records.length} records`;
  byId("searchResults").innerHTML = matches.length ? matches.map((record, index) => {
    const image = primaryImage(record);
    return `<a class="search-result${index === 0 ? " active" : ""}" href="${recordHref(record)}" data-link data-index="${index}"><span class="search-thumb">${image ? `<img src="${escapeAttr(image.imageUrl)}" alt="" loading="lazy" />` : glyph(record.id)}</span><span><small>${escapeHtml(record.section.name)}</small><strong>${highlight(record.name, value)}</strong><p>${highlight(snippet(record, value), value)}</p></span><b aria-hidden="true">→</b></a>`;
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
    event.preventDefault(); navigate(anchor.getAttribute("href")); return;
  }
  const scroller = event.target.closest("a[data-scroll]");
  if (scroller) { event.preventDefault(); byId(scroller.getAttribute("href").slice(1))?.scrollIntoView({ behavior: reducedMotion.matches ? "auto" : "smooth", block: "start" }); return; }
  if (event.target.closest("[data-open-search]")) { openSearch(); return; }
  const zoom = event.target.closest("[data-zoom]");
  if (zoom) { openLightbox(zoom.dataset.zoom, zoom.dataset.caption || ""); return; }
  if (event.target.closest("#lightbox")) { closeLightbox(); return; }
  if (event.target === byId("searchPanel")) { closeSearch(); return; }
  if (!event.target.closest(".sections-menu")) { byId("sectionsPopover").classList.remove("open"); byId("sectionsButton").setAttribute("aria-expanded", "false"); }
});

let revealObserver = null;
function observeReveals(root) {
  const items = root.querySelectorAll("[data-reveal]");
  if (!("IntersectionObserver" in window) || reducedMotion.matches) { items.forEach((item) => item.classList.add("in")); return; }
  document.documentElement.classList.add("reveal-ready");
  revealObserver?.disconnect();
  revealObserver = new IntersectionObserver((entries) => entries.forEach((entry) => { if (entry.isIntersecting) { entry.target.classList.add("in"); revealObserver.unobserve(entry.target); } }), { rootMargin: "0px 0px -6% 0px" });
  items.forEach((item) => revealObserver.observe(item));
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

function countUp(root) {
  if (reducedMotion.matches) return;
  root.querySelectorAll("[data-count]").forEach((node) => {
    const target = Number(node.dataset.count); const began = performance.now(); const duration = 1100;
    const tick = (now) => { const t = Math.min(1, (now - began) / duration); node.textContent = Math.round(target * (1 - Math.pow(1 - t, 3))); if (t < 1) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
}

function bindMotion(root) {
  if (reducedMotion.matches || !matchMedia("(hover: hover)").matches) return;
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

function createAtmosphere() {
  if (reducedMotion.matches) return;
  let frame = 0;
  window.addEventListener("pointermove", (event) => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      const root = document.documentElement.style;
      root.setProperty("--pointer-x", `${event.clientX}px`); root.setProperty("--pointer-y", `${event.clientY}px`);
      const sigil = byId("heroSigil");
      if (sigil) { sigil.style.setProperty("--sx", `${(event.clientX / innerWidth - .5) * 16}deg`); sigil.style.setProperty("--sy", `${(.5 - event.clientY / innerHeight) * 12}deg`); }
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
  document.addEventListener("visibilitychange", () => { const wasRunning = running; running = !document.hidden; if (running && !wasRunning) draw(); });
}

document.addEventListener("pointerdown", (event) => {
  if (reducedMotion.matches || event.button !== 0) return;
  const target = event.target.closest(".btn, .search-trigger, .holo, .record-row, .attachment-links a, .next-record a");
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

/* ───────── Markdown ───────── */
function markdown(source = "") {
  const lines = source.replace(/\r/g, "").split("\n");
  const out = []; let list = null;
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { closeList(); continue; }
    if (/^---+$/.test(line)) { closeList(); out.push("<hr>"); continue; }
    const heading = line.match(/^(#{2,3})\s+(.+)$/);
    if (heading) { closeList(); const level = heading[1].length; const text = stripMarkdown(heading[2]); out.push(`<h${level} id="${slug(text)}">${inline(heading[2])}</h${level}>`); continue; }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) { if (list !== "ul") { closeList(); list = "ul"; out.push("<ul>"); } out.push(`<li>${inline(bullet[1])}</li>`); continue; }
    const number = line.match(/^\d+[.)]\s+(.+)$/);
    if (number) { if (list !== "ol") { closeList(); list = "ol"; out.push("<ol>"); } out.push(`<li>${inline(number[1])}</li>`); continue; }
    if (line.startsWith("> ")) { closeList(); out.push(`<blockquote>${inline(line.slice(2))}</blockquote>`); continue; }
    closeList(); out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return out.join("") || "<p>No additional doctrine has been recorded for this entry.</p>";
}
function inline(value = "") {
  let text = escapeHtml(value);
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
  return text;
}
function extractHeadings(source = "") { return source.split(/\r?\n/).map((line) => line.trim().match(/^(#{2,3})\s+(.+)$/)).filter(Boolean).map((match) => ({ level: match[1].length, text: stripMarkdown(match[2]), id: slug(stripMarkdown(match[2])) })); }
function excerpt(source = "") { const text = stripMarkdown(source.replace(/^\s*#{1,6}\s.*$/gm, "")).replace(/\s+/g, " ").trim(); return text.length > 180 ? `${text.slice(0,177)}…` : text || "Open this doctrine record."; }
function stripMarkdown(value = "") { return value.replace(/^#{1,6}\s+/gm, "").replace(/[>*_`\[\]()#-]/g, " ").replace(/\s+/g, " ").trim(); }
function escapeHtml(value = "") { return String(value).replace(/[&<>'"]/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" }[char])); }
function escapeAttr(value = "") { return escapeHtml(value); }
function safeUrl(value = "") { try { const url = new URL(value); return ["http:","https:"].includes(url.protocol) ? escapeAttr(url.href) : "#"; } catch { return "#"; } }

/* ───────── Boot ───────── */
byId("menuToggle").addEventListener("click", () => { const open = byId("mainNav").classList.toggle("open"); byId("menuToggle").setAttribute("aria-expanded", String(open)); });
byId("sectionsButton").addEventListener("click", () => { const open = byId("sectionsPopover").classList.toggle("open"); byId("sectionsButton").setAttribute("aria-expanded", String(open)); });
byId("searchTrigger").addEventListener("click", openSearch);
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
  if (event.key === "Escape") { closeLightbox(); closeSearch(); closeMenus(); }
});
window.addEventListener(PREVIEW ? "hashchange" : "popstate", () => route());
createAtmosphere();
start();
