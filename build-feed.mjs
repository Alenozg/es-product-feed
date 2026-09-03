import { writeFile } from "node:fs/promises";

const SITE = "https://evliliksepetim.com";
const SITEMAP_URL = `${SITE}/sitemap/products/0.xml`;

function xmlEscape(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function extractJsonLd(html) {
  const matches = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  for (const m of matches) {
    try {
      const data = JSON.parse(m[1]);
      if (data["@type"] === "Product") return data;
    } catch {
      // skip malformed blocks
    }
  }
  return null;
}

function extractMeta(html, name) {
  const re = new RegExp(`<meta name="${name}" content="([^"]*)"`, "i");
  const m = html.match(re);
  return m ? m[1].replace(/&#39;/g, "'").replace(/&amp;/g, "&") : "";
}

async function fetchProductItem(url) {
  const resp = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; EvlilikSepetimFeedBot/1.0)" } });
  if (!resp.ok) return null;
  const html = await resp.text();
  const product = extractJsonLd(html);
  if (!product || !product.offers) return null;

  const description = extractMeta(html, "description") || product.name;
  const id = new URL(url).pathname.replace(/^\/|\/$/g, "");
  const images = Array.isArray(product.image) ? product.image : [product.image].filter(Boolean);
  const availability = product.offers.availability?.includes("InStock") ? "in stock" : "out of stock";

  return {
    id,
    title: product.name,
    description,
    link: product.offers.url || url,
    image_link: images[0] || "",
    additional_images: images.slice(1, 10),
    price: `${Number(product.offers.price).toFixed(2)} ${(product.offers.priceCurrency || "TRY").toUpperCase()}`,
    availability,
    condition: "new",
    brand: product.brand?.name || "Evlilik Sepetim",
  };
}

async function buildFeed() {
  const sitemapResp = await fetch(SITEMAP_URL);
  const sitemapXml = await sitemapResp.text();
  const urls = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

  const items = [];
  for (const url of urls) {
    try {
      const item = await fetchProductItem(url);
      if (item) items.push(item);
    } catch (err) {
      console.error("Failed:", url, err.message);
    }
  }

  const itemsXml = items
    .map(
      (it) => `
  <item>
    <g:id>${xmlEscape(it.id)}</g:id>
    <title>${xmlEscape(it.title)}</title>
    <description>${xmlEscape(it.description)}</description>
    <link>${xmlEscape(it.link)}</link>
    <g:image_link>${xmlEscape(it.image_link)}</g:image_link>
${it.additional_images.map((img) => `    <g:additional_image_link>${xmlEscape(img)}</g:additional_image_link>`).join("\n")}
    <g:availability>${it.availability}</g:availability>
    <g:price>${it.price}</g:price>
    <g:condition>${it.condition}</g:condition>
    <g:brand>${xmlEscape(it.brand)}</g:brand>
    <g:identifier_exists>false</g:identifier_exists>
  </item>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
<channel>
  <title>Evlilik Sepetim Ürün Feed</title>
  <link>${SITE}</link>
  <description>Evlilik Sepetim Google Merchant Center ürün feed'i</description>
${itemsXml}
</channel>
</rss>`;
}

const xml = await buildFeed();
await writeFile(new URL("./docs/feed.xml", import.meta.url), xml, "utf-8");
console.log("Feed written, bytes:", xml.length);
