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
  if (PREVIEW) return prepareBoard({ ...PREVIEW.board, preview: true });
  const response = await fetch("/api/board", { cache: "no-store" });
  if (!response.ok) throw new Error("Board unavailable");
  const board = await response.json();
  if (!board.ok || !Array.isArray(board.lists)) throw new Error("Board unavailable");
  return prepareBoard(board);
}
const signatureOf = (board) => JSON.stringify([board.name, board.description, board.lists]);

/* Trello boards are written by people, not for a website, so a little interpretation
 * happens here before anything renders:
 *  - cards named "---" (or similar) are visual dividers on the board and are dropped;
 *  - a list whose first card has no description is using that card as a heading for
 *    the list ("Imperial Crimes", "Special Locations"…). It becomes the section's
 *    tagline (and artwork, if it carries an image) instead of an empty record;
 *  - names like "A-01 | Trespassing" are split into a code and a title;
 *  - a leading heading or bold line that just repeats the card's name is removed
 *    from the description, since the page already shows the title. */
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
  resetGuide();
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
  if (document.startViewTransition && !reducedMotion.matches && !options.instant && !document.hidden) {
    const transition = document.startViewTransition(render);
    transition.ready.catch(() => {}); transition.finished.catch(() => {}); // a skipped transition still renders
  } else render();
}
function navigate(href) {
  const path = href.replace(/^#/, "") || "/";
  closeSearch(); closeMenus(); closeGuide();
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

/* ───────── Search ───────── */
function openSearch(prefill) {
  closeMenus(); closeGuide();
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

/* ───────── Archive Guide ─────────
 * A deliberately local retrieval assistant. It never sends the question or archive
 * text anywhere: records are ranked in this tab using phrase, token and typo matches. */
const GUIDE_STOP_WORDS = new Set(["a", "an", "and", "are", "about", "can", "do", "does", "find", "for", "from", "give", "how", "i", "in", "is", "it", "me", "of", "on", "or", "please", "show", "tell", "that", "the", "this", "to", "what", "when", "where", "which", "who", "why", "with"]);
const GUIDE_ALIASES = {
  offence: ["offense", "crime", "violation"], offences: ["offenses", "crimes", "violations"],
  offense: ["offence", "crime", "violation"], offenses: ["offences", "crimes", "violations"],
  law: ["rule", "rules", "doctrine"], rules: ["rule", "law", "doctrine"],
  punishment: ["penalty", "sentence", "sanction"], penalties: ["punishment", "sentence", "sanction"],
  inquisitor: ["inquisitorius", "inquisition"], sith: ["order", "doctrine"]
};
function searchNormal(value = "") { return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").replace(/\boffences\b/g, "offenses").replace(/\boffence\b/g, "offense").trim(); }
function searchIntent(query) {
  return searchNormal(query)
    .replace(/^(?:please\s+)?(?:can you\s+|could you\s+|would you\s+)?(?:tell me about|show me|find|search for|look for)\s+/, "")
    .replace(/^(?:what|which|where|who)\s+(?:is|are|was|were)\s+/, "")
    .trim();
}
function searchTerms(query) {
  const raw = searchNormal(query); const base = raw.split(/\s+/).filter(Boolean);
  const useful = base.filter((word) => !GUIDE_STOP_WORDS.has(word));
  const terms = useful.length ? useful : base;
  return [...new Set(terms.flatMap((word) => [word, ...(GUIDE_ALIASES[word] || [])]))];
}
function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j += 1) { const saved = row[j]; row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1)); previous = saved; }
  }
  return row[b.length];
}
function rankRecords(query, limit = 30) {
  const phrase = searchIntent(query) || searchNormal(query); const terms = searchTerms(query);
  if (!phrase) return searchableRecords().map((record) => ({ record, score: 0 })).slice(0, limit);
  return searchableRecords().map((record) => {
    const title = searchNormal(record.title); const name = searchNormal(record.name); const section = searchNormal(record.section.name);
    const description = searchNormal(stripMarkdown(record.description)); const labels = searchNormal((record.labels || []).map((label) => label.name).join(" "));
    const titleWords = title.split(" "); const sectionWords = section.split(" ");
    let score = 0; const hits = [];
    if (title === phrase || name === phrase) score += 150;
    else if (title.includes(phrase) || name.includes(phrase)) score += 85;
    if (section === phrase) score += 240; else if (section.includes(phrase) || phrase.includes(section)) score += 100;
    if (description.includes(phrase)) score += 42;
    if (record.code && searchNormal(record.code) === phrase) score += 130;
    for (const term of terms) {
      let hit = false;
      if (titleWords.includes(term)) { score += 34; hit = true; }
      else if (title.includes(term)) { score += 24; hit = true; }
      if (sectionWords.includes(term)) { score += 22; hit = true; }
      else if (section.includes(term)) { score += 14; hit = true; }
      const occurrences = description.split(term).length - 1;
      if (occurrences) { score += Math.min(18, 5 + occurrences * 2); hit = true; }
      if (labels.includes(term)) { score += 10; hit = true; }
      if (!hit && term.length >= 4) {
        const words = [...titleWords, ...sectionWords].filter((word) => Math.abs(word.length - term.length) <= 2);
        const near = words.some((word) => editDistance(term, word) <= (term.length > 7 ? 2 : 1));
        if (near) { score += 12; hit = true; }
      }
      if (hit) hits.push(term);
    }
    const wanted = Math.min(terms.length, 4); if (wanted > 1 && new Set(hits).size >= wanted) score += 24;
    return { record, score };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.record.recordIndex - b.record.recordIndex).slice(0, limit);
}
function guideSectionFor(query) {
  const wanted = searchIntent(query); if (!wanted) return null;
  return state.board.lists.find((section) => {
    const name = searchNormal(section.name);
    return name === wanted || wanted.includes(name) || (wanted.length >= 6 && editDistance(wanted, name) <= 2);
  }) || null;
}
function guideWelcome() {
  const sections = state.board?.lists || [];
  const suggestions = sections.slice(0, 3).map((section) => `<button type="button" data-guide-query="${escapeAttr(section.name)}">${escapeHtml(section.name)}</button>`).join("");
  return `<div class="guide-message"><span class="guide-avatar">◆</span><div class="guide-bubble"><p><strong>Koolbot is ready.</strong></p><p>Ask about any rule, offence, principle, or doctrine. I will find the closest records and take you directly to them.</p><span class="guide-note">Search happens entirely on this device.</span></div></div>${suggestions ? `<div class="guide-quick">${suggestions}</div>` : ""}`;
}
function resetGuide() {
  byId("guideMessages").innerHTML = guideWelcome();
  byId("guideIndexStatus").textContent = `${plural(searchableRecords().length, "record")} indexed`;
}
function openGuide() {
  closeSearch(); closeMenus();
  byId("guidePanel").hidden = false; byId("guideTrigger").setAttribute("aria-expanded", "true");
  setTimeout(() => byId("guideInput").focus(), reducedMotion.matches ? 0 : 220);
}
function closeGuide(returnFocus = false) {
  if (byId("guidePanel").hidden) return;
  byId("guidePanel").hidden = true; byId("guideTrigger").setAttribute("aria-expanded", "false");
  if (returnFocus) byId("guideTrigger").focus();
}
function guideExcerpt(record, terms) {
  const text = stripMarkdown(record.description); if (!text) return excerpt(record);
  const lower = searchNormal(text); const found = terms.map((term) => lower.indexOf(term)).filter((at) => at >= 0).sort((a, b) => a - b)[0] ?? -1;
  const from = found > 72 ? Math.max(0, text.lastIndexOf(" ", found - 55)) : 0;
  const piece = text.slice(from, from + 210).trim(); return `${from ? "…" : ""}${piece}${from + 210 < text.length ? "…" : ""}`;
}
function submitGuideQuery(rawQuery) {
  const query = rawQuery.trim(); if (!query) return;
  const messages = byId("guideMessages"); const input = byId("guideInput"); input.value = "";
  messages.insertAdjacentHTML("beforeend", `<div class="guide-message user"><div class="guide-bubble"><p>${escapeHtml(query)}</p></div></div>`);
  const greeting = /^(hi|hello|hey|help|what can you do)[!?. ]*$/i.test(query);
  if (greeting) {
    messages.insertAdjacentHTML("beforeend", guideWelcome());
  } else {
    const matchedSection = guideSectionFor(query);
    const ranked = matchedSection
      ? matchedSection.cards.filter((record) => !record.titleOnly).map((record) => ({ record: { ...record, section: matchedSection }, score: 300 })).slice(0, 8)
      : rankRecords(query, 8);
    const visible = ranked.slice(0, 4); const terms = searchTerms(query);
    if (!ranked.length) {
      messages.insertAdjacentHTML("beforeend", `<div class="guide-message"><span class="guide-avatar">◆</span><div class="guide-bubble guide-empty"><p>I could not find a close doctrine match. Try fewer words, a section name, or the wording used in the archive.</p><span class="guide-note">Example: “Class-A offences” or “Sith Code”</span></div></div>`);
    } else {
      const top = ranked[0].record; const total = ranked.length;
      const results = visible.map(({ record }) => `<a class="guide-result" href="${recordHref(record)}" data-link><span><small>${escapeHtml(record.section.name)}${record.code ? ` · ${escapeHtml(record.code)}` : ""}</small><strong>${escapeHtml(record.title)}</strong></span><span aria-hidden="true">→</span></a>`).join("");
      const answer = matchedSection
        ? `<p>I found <strong>${escapeHtml(matchedSection.name)}</strong>. This section contains ${plural(total, "searchable record")}.</p><p>Select a record to read its complete doctrine.</p>`
        : `<p>The closest match is <strong>${escapeHtml(top.title)}</strong> in ${escapeHtml(top.section.name)}.</p><p>${escapeHtml(guideExcerpt(top, terms))}</p>`;
      messages.insertAdjacentHTML("beforeend", `<div class="guide-message"><span class="guide-avatar">◆</span><div class="guide-bubble">${answer}<span class="guide-note">${matchedSection ? "Section match · first records shown" : total === 1 ? "1 relevant record found" : `${total} relevant records found · strongest matches shown`}</span><div class="guide-results">${results}</div></div></div>`);
    }
  }
  requestAnimationFrame(() => { messages.scrollTop = messages.scrollHeight; });
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
  const guideQuery = event.target.closest("[data-guide-query]");
  if (guideQuery) { submitGuideQuery(guideQuery.dataset.guideQuery); return; }
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
  const target = event.target.closest(".btn, .search-trigger, .holo, a.record-row, .attachment-links a, .next-record a, .guide-trigger, .guide-form button, .guide-quick button, .guide-result");
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
byId("guideTrigger").addEventListener("click", openGuide);
byId("guideClose").addEventListener("click", () => closeGuide(true));
byId("guideForm").addEventListener("submit", (event) => { event.preventDefault(); submitGuideQuery(byId("guideInput").value); });
document.addEventListener("keydown", (event) => {
  const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || "");
  if ((event.key === "/" && !typing && !event.metaKey && !event.ctrlKey) || (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey))) { event.preventDefault(); openSearch(); }
  if (event.key === "Escape") { closeLightbox(); closeSearch(); closeMenus(); closeGuide(true); }
});
window.addEventListener(PREVIEW ? "hashchange" : "popstate", () => route());
createAtmosphere();
start();
