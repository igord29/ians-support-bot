// Web tools — fetch a URL as readable text; search the web.
// web_fetch needs nothing. web_search needs BRAVE_API_KEY (free tier at
// brave.com/search/api).

const TIMEOUT = AbortSignal.timeout.bind(AbortSignal);

export async function webFetch({ url }) {
  if (!/^https?:\/\//i.test(url)) throw new Error("URL must start with http(s)://");
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (ians-support-bot)" },
    signal: TIMEOUT(20_000),
    redirect: "follow"
  });
  if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
  const html = await res.text();
  // Crude but effective: strip scripts/styles/tags, collapse whitespace
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  return { url, text: text.slice(0, 6000) };
}

export async function webSearch({ query }) {
  const key = process.env.BRAVE_API_KEY;
  if (!key) throw new Error("Web search is not configured — set BRAVE_API_KEY (free at brave.com/search/api)");
  const res = await fetch(
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`,
    { headers: { "X-Subscription-Token": key, Accept: "application/json" }, signal: TIMEOUT(20_000) }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Search failed (${res.status})`);
  return (data.web?.results || []).slice(0, 5).map(r => ({
    title: r.title, url: r.url, description: r.description?.slice(0, 200)
  }));
}
