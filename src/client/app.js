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

const state = { board: null };
const app = document.getElementById("app");
const byId = (id) => document.getElementById(id);
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

async function start() {
  try {
    const response = await fetch("/api/board");
    if (!response.ok) throw new Error("Board unavailable");
    state.board = await response.json();
  } catch {
    state.board = fallback;
  }
  byId("syncStatus").textContent = state.board.preview ? "Preview archive" : "Synced with Trello";
  renderMenus();
  route();
}

function slug(value = "") {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "record";
}
function sectionHref(section) { return `/section/${slug(section.name)}`; }
function recordHref(record) { return `/record/${encodeURIComponent(record.id)}/${slug(record.name)}`; }
function allRecords() { return state.board.lists.flatMap((section, sectionIndex) => section.cards.map((record, recordIndex) => ({ ...record, section, sectionIndex, recordIndex }))); }
function imageAttachments(record) { return (record.attachments || []).filter((item) => item.isImage && item.imageUrl); }
function primaryImage(record) {
  const images = imageAttachments(record);
  return images.find((item) => item.id === record.coverAttachmentId) || images[0] || null;
}

function renderMenus() {
  byId("sectionsPopover").innerHTML = state.board.lists.map((section) => `<a href="${sectionHref(section)}" data-link><span>${escapeHtml(section.name)}</span><small>${section.cards.length}</small></a>`).join("");
  bindLinks(byId("sectionsPopover"));
}

function route() {
  const parts = location.pathname.split("/").filter(Boolean);
  if (!parts.length) return renderHome();
  if (parts[0] === "section") {
    const section = state.board.lists.find((item) => slug(item.name) === parts[1]);
    return section ? renderSection(section) : renderNotFound();
  }
  if (parts[0] === "record") {
    const record = allRecords().find((item) => item.id === decodeURIComponent(parts[1] || ""));
    return record ? renderRecord(record) : renderNotFound();
  }
  renderNotFound();
}

function renderHome() {
  document.title = `${state.board.name || "TSO"} — Archive`;
  const total = allRecords().length;
  app.innerHTML = `<div class="page">
    <div class="eyebrow">The Sith Order</div>
    <h1 class="page-title">Doctrine Archive</h1>
    <p class="page-lead">${escapeHtml(state.board.description || "The central record of the Order: doctrine, authority, training and law.")}</p>
    <div class="archive-meta"><span><b>${state.board.lists.length}</b> sections</span><span><b>${total}</b> records</span><span>${state.board.preview ? "Preview source" : "Live Trello source"}</span></div>
    <section class="section-index" aria-label="Doctrine sections">
      ${state.board.lists.map((section, index) => `<a class="section-tile" href="${sectionHref(section)}" data-link style="--reveal-delay:${Math.min(index * 55, 440)}ms">
        <span class="section-number">SECTION ${String(index + 1).padStart(2, "0")}</span><span class="arrow">→</span>
        <h2>${escapeHtml(section.name)}</h2><p>${section.cards.length} ${section.cards.length === 1 ? "record" : "records"}</p>
      </a>`).join("")}
    </section>
  </div>`;
  bindLinks(app); bindMotion(app); focusPage();
}

function renderSection(section) {
  document.title = `${section.name} — TSO Doctrine`;
  const index = state.board.lists.indexOf(section);
  app.innerHTML = `<div class="page">
    <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/" data-link>Archive</a><span>/</span><span>${escapeHtml(section.name)}</span></nav>
    <header class="section-header"><div class="eyebrow">Section ${String(index + 1).padStart(2, "0")}</div><h1>${escapeHtml(section.name)}</h1></header>
    <section class="record-list" aria-label="Records in ${escapeHtml(section.name)}">
      ${section.cards.length ? section.cards.map((record, index) => recordRow(record, index)).join("") : `<div class="empty-page"><p>No records are currently filed in this section.</p></div>`}
    </section>
  </div>`;
  bindLinks(app); bindImageFallbacks(app); bindMotion(app); focusPage();
}

function recordRow(record, index = 0) {
  const image = primaryImage(record);
  return `<a class="record-row" href="${recordHref(record)}" data-link style="--reveal-delay:${Math.min(index * 45, 360)}ms">
    <div><h2>${escapeHtml(record.name)}</h2><p>${escapeHtml(excerpt(record.description))}</p></div>
    ${image ? `<div class="record-image"><img src="${escapeAttr(image.imageUrl)}" alt="${escapeAttr(image.name || record.name)}" loading="lazy" /></div>` : `<div></div>`}
    <span class="record-arrow">→</span>
  </a>`;
}

function renderRecord(record) {
  document.title = `${record.name} — TSO Doctrine`;
  const images = imageAttachments(record);
  const hero = primaryImage(record);
  const gallery = images.filter((image) => image.id !== hero?.id);
  const documents = (record.attachments || []).filter((item) => !item.isImage);
  const sectionRecords = record.section.cards;
  const current = sectionRecords.findIndex((item) => item.id === record.id);
  const previous = current > 0 ? sectionRecords[current - 1] : null;
  const next = current < sectionRecords.length - 1 ? sectionRecords[current + 1] : null;
  const headings = extractHeadings(record.description);

  app.innerHTML = `<article class="page article-page">
    <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/" data-link>Archive</a><span>/</span><a href="${sectionHref(record.section)}" data-link>${escapeHtml(record.section.name)}</a><span>/</span><span>${escapeHtml(record.name)}</span></nav>
    <header class="article-header"><div class="eyebrow">${escapeHtml(record.section.name)}</div><h1>${escapeHtml(record.name)}</h1></header>
    ${hero ? `<figure class="hero-media"><img src="${escapeAttr(hero.imageUrl)}" alt="${escapeAttr(hero.name || record.name)}" /><figcaption>${escapeHtml(hero.name || record.name)}</figcaption></figure>` : ""}
    <div class="article-layout">
      <div class="prose">${markdown(record.description)}</div>
      <aside class="article-aside"><strong>In this record</strong>${headings.length ? headings.map((heading) => `<a href="#${heading.id}">${escapeHtml(heading.text)}</a>`).join("") : `<a href="${sectionHref(record.section)}" data-link>Back to section</a>`}</aside>
    </div>
    ${gallery.length ? `<section class="gallery" aria-label="Record images">${gallery.map((image) => `<figure><img src="${escapeAttr(image.imageUrl)}" alt="${escapeAttr(image.name || record.name)}" loading="lazy" /><figcaption>${escapeHtml(image.name || "Archive image")}</figcaption></figure>`).join("")}</section>` : ""}
    ${documents.length || record.url ? `<section class="attachments"><h2>References</h2><div class="attachment-links">${documents.map((item) => `<a href="${safeUrl(item.url)}" target="_blank" rel="noopener">${escapeHtml(item.name || "Attachment")} ↗</a>`).join("")}${record.url ? `<a href="${safeUrl(record.url)}" target="_blank" rel="noopener">View source card ↗</a>` : ""}</div></section>` : ""}
    ${(previous || next) ? `<nav class="next-record" aria-label="Adjacent records"><div>${previous ? `<a href="${recordHref({...previous, section:record.section})}" data-link><small>Previous</small>← ${escapeHtml(previous.name)}</a>` : ""}</div><div>${next ? `<a href="${recordHref({...next, section:record.section})}" data-link><small>Next</small>${escapeHtml(next.name)} →</a>` : ""}</div></nav>` : ""}
  </article>`;
  bindLinks(app); bindImageFallbacks(app); bindMotion(app); focusPage();
}

function renderNotFound() {
  document.title = "Record not found — TSO Doctrine";
  app.innerHTML = `<div class="empty-page"><h1>Record not found</h1><p>This archive reference does not exist.</p><a href="/" data-link>Return to the archive</a></div>`;
  bindLinks(app); focusPage();
}

function openSearch() { byId("searchPanel").hidden = false; document.body.style.overflow = "hidden"; byId("globalSearch").focus(); renderSearch(""); }
function closeSearch() { byId("searchPanel").hidden = true; document.body.style.overflow = ""; byId("globalSearch").value = ""; }
function renderSearch(query) {
  const value = query.trim().toLowerCase();
  const matches = allRecords().filter((record) => !value || `${record.name} ${record.description} ${record.section.name}`.toLowerCase().includes(value)).slice(0, 30);
  byId("searchResults").innerHTML = matches.length ? matches.map((record) => {
    const image = primaryImage(record);
    return `<a class="search-result" href="${recordHref(record)}" data-link>${image ? `<span class="search-thumb"><img src="${escapeAttr(image.imageUrl)}" alt="" /></span>` : `<span class="search-thumb"></span>`}<span><strong>${escapeHtml(record.name)}</strong><span>${escapeHtml(record.section.name)}</span></span><b>→</b></a>`;
  }).join("") : `<div class="search-empty">No records match “${escapeHtml(query)}”.</div>`;
  bindLinks(byId("searchResults")); bindImageFallbacks(byId("searchResults"));
}

function bindLinks(root = document) {
  root.querySelectorAll("[data-link]").forEach((link) => link.addEventListener("click", (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    history.pushState({}, "", link.getAttribute("href"));
    closeSearch();
    byId("mainNav").classList.remove("open");
    byId("sectionsPopover").classList.remove("open");
    route();
  }));
}
function bindImageFallbacks(root) {
  root.querySelectorAll("img").forEach((image) => image.addEventListener("error", () => {
    const container = image.closest("figure, .record-image, .search-thumb");
    if (container) container.remove(); else image.remove();
  }, { once: true }));
}
function focusPage() { scrollTo({ top: 0, behavior: "auto" }); app.focus({ preventScroll: true }); }

function createAtmosphere() {
  const field = byId("embers");
  if (!field || reducedMotion.matches) return;
  const colors = ["#ff5363", "#d9344a", "#e5a85d"];
  for (let i = 0; i < 18; i += 1) {
    const ember = document.createElement("i");
    ember.className = "ember";
    ember.style.cssText = `--x:${(i * 37) % 101}%;--size:${1 + (i % 3)}px;--duration:${12 + (i % 7) * 2}s;--delay:${-i * 1.9}s;--drift:${((i % 5) - 2) * 2.6}rem;--opacity:${.18 + (i % 4) * .09};--ember-color:${colors[i % colors.length]}`;
    field.appendChild(ember);
  }

  let pointerFrame = 0;
  window.addEventListener("pointermove", (event) => {
    if (pointerFrame) return;
    pointerFrame = requestAnimationFrame(() => {
      document.documentElement.style.setProperty("--pointer-x", `${event.clientX}px`);
      document.documentElement.style.setProperty("--pointer-y", `${event.clientY}px`);
      pointerFrame = 0;
    });
  }, { passive: true });
}

function bindMotion(root) {
  if (reducedMotion.matches) return;
  root.querySelectorAll(".section-tile").forEach((tile) => {
    tile.addEventListener("pointermove", (event) => {
      const box = tile.getBoundingClientRect();
      const x = (event.clientX - box.left) / box.width;
      const y = (event.clientY - box.top) / box.height;
      tile.style.setProperty("--card-x", `${x * 100}%`);
      tile.style.setProperty("--card-y", `${y * 100}%`);
      tile.style.setProperty("--tilt-x", `${(x - .5) * 3.2}deg`);
      tile.style.setProperty("--tilt-y", `${(.5 - y) * 3.2}deg`);
    });
    tile.addEventListener("pointerleave", () => {
      tile.style.setProperty("--tilt-x", "0deg");
      tile.style.setProperty("--tilt-y", "0deg");
    });
  });
}

document.addEventListener("pointerdown", (event) => {
  if (reducedMotion.matches || event.button !== 0) return;
  const target = event.target.closest("button, .section-tile, .record-row, .attachment-links a");
  if (!target) return;
  target.classList.add("ripple-host");
  const box = target.getBoundingClientRect();
  const ripple = document.createElement("span");
  ripple.className = "click-ripple";
  ripple.style.left = `${event.clientX - box.left}px`;
  ripple.style.top = `${event.clientY - box.top}px`;
  target.appendChild(ripple);
  ripple.addEventListener("animationend", () => ripple.remove(), { once: true });
});

window.addEventListener("scroll", () => {
  const max = document.documentElement.scrollHeight - innerHeight;
  byId("readingProgress").style.transform = `scaleX(${max > 0 ? scrollY / max : 0})`;
}, { passive: true });

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
function extractHeadings(source = "") { return source.split(/\r?\n/).map((line) => line.match(/^#{2,3}\s+(.+)$/)).filter(Boolean).map((match) => ({ text: stripMarkdown(match[1]), id: slug(stripMarkdown(match[1])) })); }
function excerpt(source = "") { const text = stripMarkdown(source).replace(/\s+/g, " ").trim(); return text.length > 180 ? `${text.slice(0,177)}…` : text || "Open this doctrine record."; }
function stripMarkdown(value = "") { return value.replace(/^#{1,6}\s+/gm, "").replace(/[>*_`\[\]()#-]/g, " ").replace(/\s+/g, " ").trim(); }
function escapeHtml(value = "") { return String(value).replace(/[&<>'"]/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" }[char])); }
function escapeAttr(value = "") { return escapeHtml(value); }
function safeUrl(value = "") { try { const url = new URL(value); return ["http:","https:"].includes(url.protocol) ? escapeAttr(url.href) : "#"; } catch { return "#"; } }

byId("menuToggle").addEventListener("click", () => byId("mainNav").classList.toggle("open"));
byId("sectionsButton").addEventListener("click", () => { const menu = byId("sectionsPopover"); const open = menu.classList.toggle("open"); byId("sectionsButton").setAttribute("aria-expanded", String(open)); });
byId("searchTrigger").addEventListener("click", openSearch);
byId("closeSearch").addEventListener("click", closeSearch);
byId("globalSearch").addEventListener("input", (event) => renderSearch(event.target.value));
document.addEventListener("keydown", (event) => { if (event.key === "/" && !event.metaKey && !event.ctrlKey && document.activeElement.tagName !== "INPUT") { event.preventDefault(); openSearch(); } if (event.key === "Escape") closeSearch(); });
window.addEventListener("popstate", route);
bindLinks(document);
createAtmosphere();
start();
