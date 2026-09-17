# Law Portal

A searchable doctrine portal powered by a Trello board and deployed as a Cloudflare Worker with static assets.

## Local development

```bash
npm install
npm run dev
```

## Deployment

```bash
npm run deploy
```

The Worker serves the frontend, retrieves the Trello board, and safely proxies image attachments so they can be embedded in article pages.
