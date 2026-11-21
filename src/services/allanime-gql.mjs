import { createCipheriv, createDecipheriv, createHash } from "crypto";

const getElectronUserAgent = () => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36';

export const ALLANIME_REFERER = "https://mkissa.to";
const ALLANIME_ORIGIN = ALLANIME_REFERER;

// Embed paths still live on allanime.day; the GraphQL gateway moved to mkissa.
export const ALLANIME_API = "https://api.mkissa.net";
const ALLANIME_LANE = "k7";
const IS_DEV = process.env.NODE_ENV !== "production";

const TOBE_PARSED_FIELD = "tobeparsed";
const ALLANIME_AES_ALGO = "aes-256-gcm";
const ALLANIME_BLOB_VERSION = 0x01;
const ALLANIME_VERSION_LENGTH = 1;
const ALLANIME_IV_LENGTH = 12;
const ALLANIME_AUTH_TAG_LENGTH = 16;
const ALLANIME_TS_BUCKET_MS = 300_000;
const MKISSA_URL = "https://mkissa.to/";
const CDN_IMMUTABLE = "https://cdn.allanime.day/all/mk/_app/immutable/";

const FALLBACK_EPOCH = 2961;
const FALLBACK_BUILD_ID = "177";
// AES-256 key (ani-cli `allanime_key`), already derived — used when the live scrape misses.
const FALLBACK_KEY_HEX = "8ae218aa46cdade3faf53276be7d5ff7cd8fc657efb0138965b701492bd90e64";
// Persisted-query SHA-256 for the episode embed query.
const FALLBACK_EPISODE_QUERY_HASH =
  "670bbf38d0868f446e2346c1e956ca2c40c416e733ca248fd54e04f1c8b99145";
const FALLBACK_EPISODE_QUERY =
  "query ($showId: String!, $translationType: VaildTranslationTypeEnumType!, $episodeString: String!) { episode( showId: $showId translationType: $translationType episodeString: $episodeString ) { episodeString sourceUrls } }";

// Site still accepts (and currently encrypts tobeparsed with) the legacy
// static key as a decrypt fallback when the XOR key fails auth.
const LEGACY_SECRET = "Xot36i3lK3:v1";
const LEGACY_KEY = createHash("sha256").update(LEGACY_SECRET).digest();

                 
                    
                
                  
              
               
                    
                       
  

let cryptoCache                  = null;
let cryptoInflight                           = null;

function fallbackKey()         {
  return Buffer.from(FALLBACK_KEY_HEX, "hex");
}

function xorKey(maskHex        , partB        )         {
  const mask = Buffer.from(maskHex, "hex");
  const part = Buffer.from(partB, "base64");
  const key = Buffer.alloc(32);
  for (let i = 0; i < 32; i++) {
    key[i] = part[i]  ^ mask[i % mask.length] ;
  }
  return key;
}

function browserHeaders()                         {
  return { "User-Agent": getElectronUserAgent() };
}

async function fetchText(url        )                  {
  const res = await fetch(url, { headers: browserHeaders(), signal: AbortSignal.timeout(6000) });
  if (!res.ok) {
    throw new Error(`fetch ${url} failed: ${res.status}`);
  }
  return res.text();
}

/**
 * Port of anipy-cli keygen.py `source_query_hash`: reconstruct the episode
 * sourceUrls GraphQL query from CDN chunk template literals and SHA-256 it.
 */
function sourceQueryFromChunk(chunkJs        )                                         {
  const templates = [...chunkJs.matchAll(/(\nquery\([^`]*)`/g)].map((m) => m[1] );
  const template = templates.find((t) => t.includes("sourceUrls") && t.includes("episode("));
  if (!template) return null;

  const resolve = (tmpl        , depth = 0)         => {
    if (depth > 6) return tmpl;
    let resolved = tmpl;
    const interpolators = [...tmpl.matchAll(/\$\{([^}]+)\}/g)].map((m) => m[1] );
    for (const interpolator of interpolators) {
      let repl = "";
      if (interpolator.endsWith("()")) {
        // helper = e => e ? `...` : `...`
        const fnName = interpolator.slice(0, -2);
        const fn = chunkJs.match(
          new RegExp(
            `\\b${escapeRegExp(fnName)}\\s*=\\s*\\w+\\s*=>\\s*\\w+\\s*\\?\\s*\`[^\`]*\`\\s*:\\s*\`([^\`]*)\``
          )
        );
        repl = fn?.[1] ?? "";
      } else {
        const varMatch = chunkJs.match(
          new RegExp(`\\b${escapeRegExp(interpolator)}\\s*=\\s*\`([^\`]*)\``)
        );
        repl = varMatch?.[1] != null ? resolve(varMatch[1], depth + 1) : "";
      }
      resolved = resolved.replaceAll(`\${${interpolator}}`, repl);
    }
    return resolved;
  };

  const query = resolve(template);
  if (query.includes("${")) return null;
  return { query, hash: createHash("sha256").update(query).digest("hex") };
}

function escapeRegExp(value        )         {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function fetchAaCryptoFromSite()                           {
  try {
    const html = await fetchText(MKISSA_URL);
    const aaMatch = html.match(/window\.__aaCrypto\s*=\s*(\{.*?\})/);
    if (!aaMatch?.[1]) return null;

    const aa = JSON.parse(aaMatch[1])     
                     
                     
                        
                       
     ;
    if (typeof aa.epoch !== "number" || typeof aa.partB !== "string") return null;

    const expiresMs = Math.max((aa.switchAt ?? 0) + (aa.graceMs ?? 0), Date.now() + 3_600_000);

    const appMatch = html.match(/_app\/immutable\/(entry\/app\.[^"']+\.js)/);
    if (!appMatch?.[1]) return null;

    const appJs = await fetchText(`${CDN_IMMUTABLE}${appMatch[1]}`);
    // SvelteKit lists route chunks in a deps array, not only as import/from statements.
    // Match anipy-cli keygen.py: any "../chunks/*.js" string reference.
    const imports = [...appJs.matchAll(/["']\.\.\/(chunks\/[A-Za-z0-9_-]+\.js)["']/g)].map(
      (m) => m[1] 
    );

    for (const chunk of imports) {
      const js = await fetchText(`${CDN_IMMUTABLE}${chunk}`);
      if (!js.includes("__aaCrypto")) continue;

      const masks = js.match(/[0-9a-f]{64}/g) ?? [];
      if (masks.length !== 1) continue;

      // buildId is inlined near the mask as a short numeric string fallback
      // (currently "177"). Prefer that when present; otherwise use the last known value.
      const buildIdMatch = js.match(new RegExp(`${masks[0]}["']?[\\s\\S]{0,80}?"(\\d{1,4})"`));
      const sourced = sourceQueryFromChunk(js);

      return {
        expiresMs,
        epoch: aa.epoch,
        buildId: buildIdMatch?.[1] ?? FALLBACK_BUILD_ID,
        key: xorKey(masks[0] , aa.partB),
        mask: masks[0] ,
        queryHash: sourced?.hash ?? FALLBACK_EPISODE_QUERY_HASH,
        episodeQuery: sourced?.query ?? FALLBACK_EPISODE_QUERY,
      };
    }
    return null;
  } catch (error         ) {
    if (IS_DEV) {
      const message = error instanceof Error ? error.message : "unknown error";
      console.warn(`[allanime-gql] aaReq crypto fetch failed: ${message}`);
    }
    return null;
  }
}

function fallbackCrypto()           {
  return {
    expiresMs: Date.now() + 3_600_000,
    epoch: FALLBACK_EPOCH,
    buildId: FALLBACK_BUILD_ID,
    key: fallbackKey(),
    mask: FALLBACK_KEY_HEX,
    queryHash: FALLBACK_EPISODE_QUERY_HASH,
    episodeQuery: FALLBACK_EPISODE_QUERY,
  };
}

async function loadAaCrypto()                    {
  const fetched = await fetchAaCryptoFromSite();
  if (fetched) {
    cryptoCache = fetched;
    if (IS_DEV) {
      console.info(
        `[allanime-gql] fetched aaReq crypto (epoch ${fetched.epoch}, mask ${fetched.mask.slice(0, 8)}, buildId ${fetched.buildId}, queryHash ${fetched.queryHash})`
      );
    }
    return fetched;
  }
  if (IS_DEV) {
    console.warn("[allanime-gql] could not fetch aaReq crypto, using fallback values");
  }
  const fallback = fallbackCrypto();
  // Don't cache a long-lived failure; retry next request after a short window.
  cryptoCache = { ...fallback, expiresMs: Date.now() + 60_000 };
  return fallback;
}

async function ensureAaCrypto()                    {
  if (cryptoCache && cryptoCache.expiresMs > Date.now()) {
    return cryptoCache;
  }
  if (cryptoInflight) return cryptoInflight;

  cryptoInflight = loadAaCrypto();

  try {
    return await cryptoInflight;
  } finally {
    cryptoInflight = null;
  }
}

/** Force-refresh aaReq crypto (used when AllAnime becomes the active provider). */
export async function refreshAaCrypto()                    {
  cryptoCache = null;
  if (cryptoInflight) return cryptoInflight;
  cryptoInflight = loadAaCrypto();
  try {
    return await cryptoInflight;
  } finally {
    cryptoInflight = null;
  }
}

export async function getEpisodeEmbedQueryHash()                  {
  const crypto = await ensureAaCrypto();
  return crypto.queryHash;
}

export async function getEpisodeEmbedPersistedQuery()           
               
                
   {
  const crypto = await ensureAaCrypto();
  return { hash: crypto.queryHash, query: crypto.episodeQuery };
}

/**
 * Match ani-cli #1899 `get_aa_req`: payload is `{v,ts,epoch,buildId,qh,k}`
 * and IV material is `epoch:buildId:qh:ts:lane`.
 */
function buildAaReq(persistedQueryHash        , crypto          )         {
  const ts = Math.floor(Date.now() / ALLANIME_TS_BUCKET_MS) * ALLANIME_TS_BUCKET_MS;
  const aaReqBase = {
    v: 1,
    ts,
    epoch: crypto.epoch,
    buildId: crypto.buildId,
    qh: persistedQueryHash,
    k: ALLANIME_LANE,
  };
  const ivMaterial = `${crypto.epoch}:${crypto.buildId}:${persistedQueryHash}:${ts}:${ALLANIME_LANE}`;
  const iv = createHash("sha256").update(ivMaterial).digest().subarray(0, ALLANIME_IV_LENGTH);
  const jsonBlob = JSON.stringify(aaReqBase);
  const cipher = createCipheriv(ALLANIME_AES_ALGO, crypto.key, iv);
  const ciphertext = Buffer.concat([cipher.update(jsonBlob, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([ALLANIME_BLOB_VERSION]), iv, ciphertext, tag]).toString(
    "base64"
  );
}

function parseDecryptedPayload(payload        )          {
  try {
    return JSON.parse(payload);
  } catch {
    return payload;
  }
}

function decryptWithKey(blob        , key        )          {
  const ivStart = ALLANIME_VERSION_LENGTH;
  const ivEnd = ivStart + ALLANIME_IV_LENGTH;
  const ciphertextStart = ivEnd;
  const ciphertextEnd = blob.length - ALLANIME_AUTH_TAG_LENGTH;
  if (ciphertextEnd < ciphertextStart) {
    throw new Error("Encrypted payload has invalid ciphertext boundaries");
  }

  const iv = blob.subarray(ivStart, ivEnd);
  const ciphertext = blob.subarray(ciphertextStart, ciphertextEnd);
  const tag = blob.subarray(ciphertextEnd);

  const decipher = createDecipheriv(ALLANIME_AES_ALGO, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return parseDecryptedPayload(decrypted.toString("utf8"));
}

function decryptTobeparsed(blobBase64        , cryptoKey        )          {
  const blob = Buffer.from(blobBase64, "base64");
  const minimumLength = ALLANIME_VERSION_LENGTH + ALLANIME_IV_LENGTH + ALLANIME_AUTH_TAG_LENGTH;
  if (blob.length < minimumLength) {
    throw new Error("Encrypted payload is too short");
  }
  const version = blob[0];
  if (version !== ALLANIME_BLOB_VERSION) {
    throw new Error(`Unsupported Allanime blob version: ${version}`);
  }

  // Match the site: try the epoch XOR key first, then the legacy static key.
  try {
    return decryptWithKey(blob, cryptoKey);
  } catch {
    return decryptWithKey(blob, LEGACY_KEY);
  }
}

export function normalizeAllAnimePayload(
  value         ,
  cryptoKey         = cryptoCache?.key ?? fallbackKey()
)          {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeAllAnimePayload(item, cryptoKey));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const record = value                           ;
  const normalized                          = {};
  for (const [key, entry] of Object.entries(record)) {
    normalized[key] = normalizeAllAnimePayload(entry, cryptoKey);
  }

  const encrypted =
    typeof normalized[TOBE_PARSED_FIELD] === "string" ? normalized[TOBE_PARSED_FIELD] : null;
  if (encrypted) {
    try {
      const decrypted = normalizeAllAnimePayload(
        decryptTobeparsed(encrypted, cryptoKey),
        cryptoKey
      );
      delete normalized[TOBE_PARSED_FIELD];

      if (decrypted && typeof decrypted === "object" && !Array.isArray(decrypted)) {
        return {
          ...normalized,
          ...(decrypted                           ),
        };
      }

      normalized.data = decrypted;
    } catch (error         ) {
      if (IS_DEV) {
        const message = error instanceof Error ? error.message : "unknown decryption error";
        const preview = encrypted.slice(0, 24);
        console.warn(
          `[allanime-gql] Failed to decrypt tobeparsed payload: ${message} | blob=${preview}...`
        );
      }
    }
  }

  return normalized;
}

function isAcceptableGetResponse(parsed         )          {
  if (!parsed || typeof parsed !== "object") return false;
  const record = parsed                                        ;

  if (Array.isArray(record.errors) && record.errors.length > 0) return false;
  if (record.data == null) return false;
  return true;
}

function isPersistedQueryNotFound(parsed         )          {
  if (!parsed || typeof parsed !== "object") return false;
  const errors = (parsed                        ).errors;
  if (!Array.isArray(errors)) return false;
  return errors.some((error) => {
    if (!error || typeof error !== "object") return false;
    const record = error                                                          ;
    return (
      record.extensions?.code === "PERSISTED_QUERY_NOT_FOUND" ||
      record.message === "PersistedQueryNotFound"
    );
  });
}

async function tryPersistedQueryGet(
  variables         ,
  persistedQueryHash        ,
  crypto          ,
  queryText         
)                                                                       {
  const extensions                          = {
    persistedQuery: { version: 1, sha256Hash: persistedQueryHash },
    k: ALLANIME_LANE,
    aaReq: buildAaReq(persistedQueryHash, crypto),
  };
  const url = new URL(`${ALLANIME_API}/api`);
  url.searchParams.set("variables", JSON.stringify(variables));
  url.searchParams.set("extensions", JSON.stringify(extensions));
  if (queryText) {
    url.searchParams.set("query", queryText);
  }

  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      signal: AbortSignal.timeout(6000),
      headers: {
        Referer: ALLANIME_REFERER,
        Origin: ALLANIME_ORIGIN,
        "x-build-id": crypto.buildId,
        "User-Agent": getElectronUserAgent(),
      },
    });

    if (!res.ok) return { parsed: null, persistedQueryNotFound: false };

    const text = await res.text();
    let parsed         ;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { parsed: null, persistedQueryNotFound: false };
    }

    if (isPersistedQueryNotFound(parsed)) {
      return { parsed: null, persistedQueryNotFound: true };
    }

    // Accept any well-formed GraphQL response that carries `data` and no `errors`.
    // This covers both the encrypted episode sourceUrls (tobeparsed) payload and the
    // plain `shows` payload used by search / recent uploads.
    if (!isAcceptableGetResponse(parsed)) return { parsed: null, persistedQueryNotFound: false };
    return { parsed, persistedQueryNotFound: false };
  } catch (error         ) {
    if (IS_DEV) {
      const message = error instanceof Error ? error.message : "unknown error";
      console.warn(`[allanime-gql] persisted query GET failed, falling back to POST: ${message}`);
    }
    return { parsed: null, persistedQueryNotFound: false };
  }
}

export async function allAnimeGql   (
  variables         ,
  query        ,
  persistedQueryHash         
)             {
  const crypto = persistedQueryHash ? await ensureAaCrypto() : null;
  const episodeQuery =
    persistedQueryHash && crypto && crypto.queryHash === persistedQueryHash
      ? crypto.episodeQuery
      : query;

  if (persistedQueryHash && crypto) {
    const hashOnly = await tryPersistedQueryGet(variables, persistedQueryHash, crypto);
    if (hashOnly.parsed) {
      return normalizeAllAnimePayload(hashOnly.parsed, crypto.key)     ;
    }

    // Apollo APQ / Cloudflare: hash-only can 520 or return PersistedQueryNotFound.
    // Retry with the full site query text that produces the hash (anipy-compatible).
    if (IS_DEV) {
      console.info(
        `[allanime-gql] hash-only GET missed (${
          hashOnly.persistedQueryNotFound ? "PersistedQueryNotFound" : "no data"
        }); retrying with full episode query (${episodeQuery.length} chars)`
      );
    }
    const withQuery = await tryPersistedQueryGet(
      variables,
      persistedQueryHash,
      crypto,
      episodeQuery
    );
    if (withQuery.parsed) {
      return normalizeAllAnimePayload(withQuery.parsed, crypto.key)     ;
    }
  }

  // POST path intentionally omits the Origin header. ani-cli only sets Origin on the
  // persisted-query GET, and AllAnime's gateway rejects POST bodies for `shows` queries
  // (search / recent uploads) when an Origin that doesn't match an allowed origin is sent.
  const body                          = {
    variables,
    query: persistedQueryHash ? episodeQuery : query,
  };
  if (persistedQueryHash && crypto) {
    body.extensions = {
      persistedQuery: { version: 1, sha256Hash: persistedQueryHash },
      k: ALLANIME_LANE,
      aaReq: buildAaReq(persistedQueryHash, crypto),
    };
  }

  const res = await fetch(`${ALLANIME_API}/api`, {
    method: "POST",
    signal: AbortSignal.timeout(6000),
    headers: {
      "Content-Type": "application/json",
      Referer: ALLANIME_REFERER,
      ...(crypto ? { "x-build-id": crypto.buildId } : {}),
      "User-Agent": getElectronUserAgent(),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`allanime request failed: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json())           ;
  if (IS_DEV && persistedQueryHash) {
    const record = json                                                                          ;
    if (Array.isArray(record.errors) && record.errors.length > 0) {
      console.warn(
        `[allanime-gql] episode POST errors: ${record.errors.map((e) => e.message).join("; ")}`
      );
    } else if (record.data && "tobeparsed" in (record.data          )) {
      console.info("[allanime-gql] episode response has root tobeparsed");
    } else if (record.data?.episode == null) {
      console.warn("[allanime-gql] episode POST returned null episode");
    }
  }
  return normalizeAllAnimePayload(json, crypto?.key)     ;
}
