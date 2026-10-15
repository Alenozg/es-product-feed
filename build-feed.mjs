import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

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

function decodeEntities(str) {
  return String(str || "")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ");
}

// Türkçe büyük harfli kategori adlarını ("ÇİÇEK ŞEKİLLİ MUMLAR") okunur hâle getirir.
function trTitle(str) {
  const lower = String(str || "").trim().toLocaleLowerCase("tr-TR");
  return lower.replace(/(^|[\s&(-])(\p{L})/gu, (m, sep, ch) => sep + ch.toLocaleUpperCase("tr-TR"));
}

// Sayfadaki BreadcrumbList'ten (Anasayfa ve ürünün kendisi hariç) kategori yolunu çıkarır.
function extractBreadcrumb(html) {
  const list = html.match(/<ul class="breadcrumb"[\s\S]*?<\/ul>/i);
  if (!list) return [];
  const names = [...list[0].matchAll(/itemprop=['"]name['"]>([^<]*)</g)].map((m) => decodeEntities(m[1]).trim());
  return names.slice(1, -1).filter(Boolean);
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

  const longDescription = decodeEntities(product.description || "").replace(/\s+/g, " ").trim();
  const description = (longDescription.length > 60 ? longDescription : extractMeta(html, "description") || longDescription || product.name).slice(0, 4900);
  const categories = extractBreadcrumb(html);
  const productType = categories.map(trTitle).join(" > ");
  // İade politikası etiketi: kişiye özel üretilen ürünler iade edilemez (Mesafeli Sözleşmeler Yönetmeliği md. 15),
  // mum ve aksesuar gibi standart ürünlerde 14 gün iade geçerli. Etiketler Merchant Center'daki iade politikalarıyla eşleşir.
  // Kişiye özel yazı/fotoğraf formu zorunlu olan mumlar (kartlı mumlar, etiketli hediyelikler, polaroid kart) da kişiye özeldir.
  // "İsteğe Bağlı Kişiselleştirme" formlu buketler ve formsuz mumlar standart iadededir.
  const top = (categories[0] || "").toLocaleUpperCase("tr-TR");
  // Ticimax sayfa verisindeki form numarası: 13 = Kişiye Özel Yazı Bilgileri, 19 = Fotoğraflı Kart Bilgileri.
  const personalizedForm = /"formId":(13|19)\b/.test(html);
  const returnLabel = /MUMLAR|AKSESUAR/.test(top) && !personalizedForm ? "standart-iade" : "kisiye-ozel";
  const slug = new URL(url).pathname.replace(/^\/|\/$/g, "");
  const id = createHash("sha1").update(slug).digest("hex").slice(0, 16);
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
    brand: "Evlilik Sepetim",
    product_type: productType,
    return_label: returnLabel,
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
${it.product_type ? `    <g:product_type>${xmlEscape(it.product_type)}</g:product_type>\n` : ""}    <g:return_policy_label>${it.return_label}</g:return_policy_label>
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
