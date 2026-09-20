const BOARD_SHORTLINK = "9PiknbOc";
const TRELLO_EXPORT = `https://trello.com/b/${BOARD_SHORTLINK}.json`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/board") {
      try {
        const board = await fetchBoard();
        return Response.json(normaliseBoard(board), {
          headers: { "Cache-Control": "public, max-age=60, s-maxage=90" }
        });
      } catch (error) {
        return Response.json({
          ok: false,
          error: "The live archive is temporarily unavailable.",
          detail: error instanceof Error ? error.message : "Unknown upstream error"
        }, { status: 503 });
      }
    }

    if (url.pathname === "/api/media") {
      try {
        const cardId = url.searchParams.get("card");
        const attachmentId = url.searchParams.get("attachment");
        if (!cardId || !attachmentId) return new Response("Missing media reference", { status: 400 });

        const board = await fetchBoard();
        const card = (board.cards || []).find((item) => item.id === cardId && !item.closed);
        const attachment = card?.attachments?.find((item) => item.id === attachmentId);
        if (!attachment || !isImage(attachment)) return new Response("Image not found", { status: 404 });

        const media = await fetch(attachment.url, {
          headers: { "User-Agent": "TSO-Doctrine-Archive/1.0" },
          redirect: "follow",
          cf: { cacheTtl: 86400, cacheEverything: true }
        });
        const type = media.headers.get("content-type") || attachment.mimeType || "";
        if (!media.ok || !type.toLowerCase().startsWith("image/")) {
          return new Response("Image unavailable", { status: 404 });
        }
        return new Response(media.body, {
          headers: {
            "Content-Type": type,
            "Cache-Control": "public, max-age=86400, s-maxage=604800",
            "X-Content-Type-Options": "nosniff"
          }
        });
      } catch {
        return new Response("Image unavailable", { status: 404 });
      }
    }

    if (env.ASSETS) {
      const asset = await env.ASSETS.fetch(request);
      if (asset.status !== 404 || url.pathname.includes(".")) return asset;
      const home = new URL("/index.html", url);
      return env.ASSETS.fetch(new Request(home, request));
    }
    return new Response("Not found", { status: 404 });
  }
};

async function fetchBoard() {
  const response = await fetch(TRELLO_EXPORT, {
    headers: { "User-Agent": "TSO-Doctrine-Archive/1.0" },
    cf: { cacheTtl: 90, cacheEverything: true }
  });
  if (!response.ok) throw new Error(`Trello returned ${response.status}`);
  return response.json();
}

function isImage(attachment) {
  const type = (attachment.mimeType || "").toLowerCase();
  const name = (attachment.name || attachment.url || "").toLowerCase();
  return type.startsWith("image/") || /\.(png|jpe?g|gif|webp|avif)(\?|$)/.test(name);
}

function normaliseBoard(board) {
  const lists = (board.lists || [])
    .filter((list) => !list.closed)
    .sort((a, b) => a.pos - b.pos)
    .map((list) => ({
      id: list.id,
      name: list.name,
      cards: (board.cards || [])
        .filter((card) => card.idList === list.id && !card.closed)
        .sort((a, b) => a.pos - b.pos)
        .map((card) => ({
          id: card.id,
          name: card.name,
          description: card.desc || "",
          url: card.url || "",
          labels: (card.labels || []).map((label) => ({
            name: label.name || label.color,
            color: label.color
          })),
          attachments: (card.attachments || []).map((attachment) => ({
            id: attachment.id,
            name: attachment.name,
            url: attachment.url,
            mimeType: attachment.mimeType,
            isImage: isImage(attachment),
            imageUrl: isImage(attachment)
              ? `/api/media?card=${encodeURIComponent(card.id)}&attachment=${encodeURIComponent(attachment.id)}`
              : ""
          })),
          coverAttachmentId: card.cover?.idAttachment || ""
        }))
    }));

  return {
    ok: true,
    id: board.id,
    name: board.name || "TSO Sith Doctrine",
    description: board.desc || "",
    updatedAt: new Date().toISOString(),
    lists
  };
}
