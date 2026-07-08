# Seedream 5.0 Pro Waitlist MVP

Updated: 2026-07-08<br>
Canonical site: <https://doubaoseedream5pro.cc/>

This repository hosts a static GitHub Pages MVP for the keyword **Seedream 5.0 Pro**. The site is intentionally built as a demand-validation page: a polished product experience, a simulated private queue, and a real waitlist-intent capture flow that can later be connected to a backend form endpoint.

## Live pages

- Landing page: <https://doubaoseedream5pro.cc/>
- Waitlist page: <https://doubaoseedream5pro.cc/waitlist.html>
- Sitemap: <https://doubaoseedream5pro.cc/sitemap.xml>
- Robots: <https://doubaoseedream5pro.cc/robots.txt>

## MVP strategy

The product surface follows a three-hour MVP pattern:

1. **Richer design and experience**: the homepage looks like a real AI creative product, with a hero workspace, capability cards, queue panel, source notes, FAQ, and waitlist CTA.
2. **Fake queue**: the site simulates queue position and wait time in the browser. It does not pretend to generate images.
3. **Real intent capture**: form submissions are stored in browser `localStorage` and opened as an email draft via `mailto:`. For production, replace the form action with Supabase, Formspree, Airtable, Google Forms, or a serverless API endpoint.

This keeps the MVP honest: the user sees demand pressure and can join the waitlist, while the project collects a useful signal before building a full generation backend.

## What the site says about Seedream 5.0 Pro

The site positions Seedream 5.0 Pro around the creative workflow areas users are likely to evaluate:

- prompt-based image creation and editing
- interactive/local editing workflows
- layer-style production handoff
- dense visual layouts such as ads, e-commerce pages, diagrams, and slide-like pages
- multilingual creative assets

The page is **not** an official Seedream, Doubao, ByteDance, Dreamina, CapCut, or Volcano Engine website. API access, price, commercial terms, supported regions, and official model availability must be verified through official documentation.

## Public source notes

Useful reference pages inspected for the launch copy:

- ByteDance Seedream 5.0 Lite: <https://seed.bytedance.com/en/seedream5_0_lite>
- ByteDance Seedream 4.0: <https://seed.bytedance.com/en/seedream4_0>
- Dreamina Seedream 5.0 Pro: <https://dreamina.capcut.com/seedream/seedream-5-0-pro>
- Volcano Engine image generation docs: <https://www.volcengine.com/docs/82379/1541523>

## Files

- `index.html` - English-first SEO landing page, queue demo, capability sections, source notes, FAQ, and waitlist form.
- `waitlist.html` - standalone waitlist page that accepts `queue`, `prompt`, and `source` URL parameters.
- `assets/seedream-interface-hero.jpg` - local hero/media image generated for the page and compressed for GitHub Pages.
- `robots.txt` - crawl policy and sitemap pointer.
- `sitemap.xml` - homepage, waitlist, and README URLs.
- `CNAME` - custom domain for GitHub Pages.
- `google6f7d8765f4c7bf70.html` - existing Google Search Console verification file.

## Backend upgrade path

For true server-side storage, create one endpoint such as:

```http
POST /api/waitlist
Content-Type: application/json
```

Suggested fields:

```json
{
  "email": "user@example.com",
  "role": "Designer",
  "scenario": "Advertising creative",
  "message": "Describe the workflow",
  "queue_position": 214,
  "source": "queue-demo",
  "created_at": "2026-07-08T00:00:00.000Z"
}
```

Do not put API keys or database credentials in GitHub Pages static files. Use environment variables in a serverless function or backend service.

## Local preview

```bash
cd /Users/chinamanor/Downloads/cursor/doubao-seedream-5pro
python3 -m http.server 8765
```

Open <http://localhost:8765/>.
