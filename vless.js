import { connect } from "cloudflare:sockets";

const serviceName = "@last_masterX";
let prxIP = "";
const PRX_HEALTH_CHECK_API = "https://id1.foolvpn.me/api/v1/check";
const horse = "dHJvamFu";
const flash = "dmxlc3M=";
// INI SUDAH DIGANTI JADI VLESS GENERATOR
const judul = "VkxFU1MgR0VORVJBVE9S"; 
const PRX_BANK_BASE = "https://raw.githubusercontent.com/rianandre227/cfproxies/refs/heads/main/proxy.txt";
const DNS_SERVER_ADDRESS = "8.8.8.8";
const DNS_SERVER_PORT = 53;
const RELAY_SERVER_UDP = { host: "udp-relay.hobihaus.space", port: 7300 };
const WS_READY_STATE_OPEN = 1;
const WS_READY_STATE_CLOSING = 2;
const CORS_HEADER_OPTIONS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const PROXY_SOURCES = [
  "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt",
  "https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/https.txt",
  "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt",
  "https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt",
  "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=10000&country=all&ssl=all&anonymity=all"
];

let trafficStats = null;
let cachedPrxList = {};
let scrapeCache = { data: null, timestamp: 0, stats: null };
const SCRAPE_CACHE_TTL = 6 * 60 * 60 * 1000;
let pingTestCache = {};
const PING_TEST_TTL = 60 * 60 * 1000;
const PING_TEST_TIMEOUT = 8000;
const PING_BATCH_SIZE = 8;

async function testProxyHealth(ip, port) {
  const key = `${ip}:${port}`;
  if (pingTestCache[key] && (Date.now() - pingTestCache[key].timestamp < PING_TEST_TTL)) return pingTestCache[key];
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PING_TEST_TIMEOUT);
    const res = await fetch(`${PRX_HEALTH_CHECK_API}?ip=${encodeURIComponent(key)}`, { signal: controller.signal, cf: { cacheTtl: 0 } });
    clearTimeout(timeoutId);
    const data = await res.json();
    const delay = (data && typeof data.delay !== 'undefined') ? Number(data.delay) : null;
    const result = { ip, port, key, delay: (delay !== null && !isNaN(delay) && delay > 0) ? delay : null, alive: delay !== null && !isNaN(delay) && delay > 0, timestamp: Date.now() };
    pingTestCache[key] = result;
    return result;
  } catch (e) {
    const result = { ip, port, key, delay: null, alive: false, timestamp: Date.now() };
    pingTestCache[key] = result;
    return result;
  }
}

async function testProxiesBatch(proxies) {
  const results = [];
  for (let i = 0; i < proxies.length; i += PING_BATCH_SIZE) {
    const batch = proxies.slice(i, i + PING_BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(async (p) => {
      const result = await testProxyHealth(p.prxIP, p.prxPort);
      return { proxy: p, test: result };
    }));
    results.push(...batchResults);
  }
  return results;
}

async function scrapeFreshProxies(env, forceTest = false) {
  if (!forceTest && scrapeCache.data && (Date.now() - scrapeCache.timestamp < SCRAPE_CACHE_TTL)) return scrapeCache.data;
  if (!forceTest && env && env.proxy_cache) {
    try {
      const cached = await env.proxy_cache.get("freshProxies", "json");
      if (cached && cached.timestamp && (Date.now() - cached.timestamp < SCRAPE_CACHE_TTL)) { scrapeCache = cached; return cached.data; }
    } catch (e) {}
  }
  console.log("Scraping...");
  const allProxies = [];
  const seenIPs = new Set();
  for (const source of PROXY_SOURCES) {
    try {
      const res = await fetch(source, { headers: { "User-Agent": "Mozilla/5.0" }, cf: { cacheTtl: 0 } });
      if (!res.ok) continue;
      const text = await res.text();
      const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
      for (const line of lines) {
        const match = line.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):(\d+)$/);
        if (match) {
          const key = `${match[1]}:${match[2]}`;
          if (!seenIPs.has(key)) { seenIPs.add(key); allProxies.push({ prxIP: match[1], prxPort: match[2], country: "XX", org: "Fresh Proxy", source: "fresh" }); }
        }
      }
    } catch (e) {}
  }
  const toGeolocate = allProxies.slice(0, 150);
  await Promise.allSettled(toGeolocate.map(async (proxy) => {
    try {
      const res = await fetch(`http://ip-api.com/json/${proxy.prxIP}?fields=countryCode,org`, { cf: { cacheTtl: 86400 } });
      if (res.ok) { const data = await res.json(); if (data.countryCode) proxy.country = data.countryCode; if (data.org) proxy.org = data.org.substring(0, 50); }
    } catch (e) {}
  }));
  console.log(`Testing ${toGeolocate.length} proxies...`);
  const testResults = await testProxiesBatch(toGeolocate);
  const aliveProxies = testResults.filter(r => r.test.alive).map(r => ({ ...r.proxy, delay: r.test.delay, lastTested: r.test.timestamp }));
  const deadCount = testResults.length - aliveProxies.length;
  console.log(`Alive: ${aliveProxies.length}, Dead: ${deadCount}`);
  const filtered = aliveProxies.filter(p => p.country === "SG" || p.country === "ID" || p.country === "XX");
  scrapeCache = { data: filtered, timestamp: Date.now(), stats: { totalScraped: allProxies.length, totalTested: testResults.length, totalAlive: aliveProxies.length, totalDead: deadCount, totalFiltered: filtered.length } };
  if (env && env.proxy_cache) { try { await env.proxy_cache.put("freshProxies", JSON.stringify(scrapeCache), { expirationTtl: SCRAPE_CACHE_TTL / 1000 }); } catch (e) {} }
  return filtered;
}

async function testBankProxies(bankProxies) {
  const testResults = await testProxiesBatch(bankProxies);
  return testResults.filter(r => r.test.alive).map(r => ({ ...r.proxy, delay: r.test.delay, lastTested: r.test.timestamp, source: "bank" }));
}

async function loadTrafficStats(env) {
  if (trafficStats) return trafficStats;
  try { if (env && env.traffic_stats) { const raw = await env.traffic_stats.get("trafficStats"); if (raw) { const parsed = JSON.parse(raw); parsed.uniqueVisitors = new Set(parsed.uniqueVisitors || []); trafficStats = parsed; } } } catch (e) {}
  if (!trafficStats) trafficStats = { totalVisitors: 0, uniqueVisitors: new Set(), bandwidthUsed: 0, todayVisitors: 0, todayBandwidth: 0, lastReset: new Date().toISOString().split('T')[0] };
  return trafficStats;
}

async function saveTrafficStats(env) {
  if (!trafficStats || !env || !env.traffic_stats) return;
  try { await env.traffic_stats.put("trafficStats", JSON.stringify({ ...trafficStats, uniqueVisitors: Array.from(trafficStats.uniqueVisitors) })); } catch (e) {}
}

function getVisitorId(request) {
  const data = (request.headers.get('cf-connecting-ip') || '') + (request.headers.get('user-agent') || '') + (request.headers.get('accept') || '');
  let hash = 0;
  for (let i = 0; i < data.length; i++) { hash = ((hash << 5) - hash) + data.charCodeAt(i); hash = hash & hash; }
  return Math.abs(hash).toString(36);
}

async function updateTrafficStats(request, responseSize = 0, env) {
  try {
    await loadTrafficStats(env);
    const visitorId = getVisitorId(request);
    const today = new Date().toISOString().split('T')[0];
    if (trafficStats.lastReset !== today) { trafficStats.todayVisitors = 0; trafficStats.todayBandwidth = 0; trafficStats.lastReset = today; trafficStats.uniqueVisitors = new Set(); }
    if (!trafficStats.uniqueVisitors.has(visitorId)) { trafficStats.uniqueVisitors.add(visitorId); trafficStats.totalVisitors++; trafficStats.todayVisitors++; }
    trafficStats.bandwidthUsed += responseSize; trafficStats.todayBandwidth += responseSize;
    await saveTrafficStats(env);
  } catch (e) {}
}

function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024; const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}

async function getPrx(countryCode = "ALL", env = null) {
  const code = (countryCode || "ALL").toUpperCase();
  const cacheKey = `${code}_${Math.floor(Date.now() / 300000)}`;
  if (cachedPrxList[cacheKey]) return cachedPrxList[cacheKey];
  let allProxies = [];
  try {
    const res = await fetch(PRX_BANK_BASE);
    if (res.ok) {
      const text = await res.text();
      const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
      const parsed = lines.map(line => { const parts = line.split(",").map(p => p.trim()); return { prxIP: parts[0], prxPort: parts[1] || "443", country: (parts[2] || code).toUpperCase(), org: parts[3] || "Unknown Org", source: "bank" }; }).filter(p => p.prxIP && /^\d+\.\d+\.\d+\.\d+$/.test(p.prxIP));
      const aliveBank = await testBankProxies(parsed);
      allProxies.push(...aliveBank);
    }
  } catch (e) {}
  try { const fresh = await scrapeFreshProxies(env); if (fresh && fresh.length > 0) allProxies.push(...fresh); } catch (e) {}
  const seen = new Set(); const unique = [];
  for (const p of allProxies) { const key = `${p.prxIP}:${p.prxPort}`; if (!seen.has(key)) { seen.add(key); unique.push(p); } }
  let filtered = unique;
  if (code !== "ALL") filtered = unique.filter(p => p.country === code);
  filtered.sort((a, b) => (a.delay || 9999) - (b.delay || 9999));
  cachedPrxList[cacheKey] = filtered;
  return filtered;
}

async function websocketHandler(request) {
  const webSocketPair = new WebSocketPair();
  const [client, webSocket] = Object.values(webSocketPair);
  webSocket.accept();
  let addressLog = "", portLog = "";
  const log = (info, event) => console.log(`[${addressLog}:${portLog}] ${info}`, event || "");
  const earlyDataHeader = request.headers.get("sec-websocket-protocol") || "";
  const readableWebSocketStream = makeReadableWebSocketStream(webSocket, earlyDataHeader, log);
  let remoteSocketWrapper = { value: null };
  let isDNS = false;
  readableWebSocketStream.pipeTo(new WritableStream({
    async write(chunk, controller) {
      if (isDNS) return handleUDPOutbound(DNS_SERVER_ADDRESS, DNS_SERVER_PORT, chunk, webSocket, null, log, RELAY_SERVER_UDP);
      if (remoteSocketWrapper.value) { const writer = remoteSocketWrapper.value.writable.getWriter(); await writer.write(chunk); writer.releaseLock(); return; }
      const protocol = await protocolSniffer(chunk);
      let protocolHeader;
      if (protocol === atob(horse)) protocolHeader = readHorseHeader(chunk);
      else if (protocol === atob(flash)) protocolHeader = readFlashHeader(chunk);
      else if (protocol === "ss") protocolHeader = readSsHeader(chunk);
      else throw new Error("Unknown Protocol!");
      addressLog = protocolHeader.addressRemote;
      portLog = `${protocolHeader.portRemote} -> ${protocolHeader.isUDP ? "UDP" : "TCP"}`;
      if (protocolHeader.hasError) throw new Error(protocolHeader.message);
      if (protocolHeader.isUDP) {
        if (protocolHeader.portRemote === 53) { isDNS = true; return handleUDPOutbound(DNS_SERVER_ADDRESS, DNS_SERVER_PORT, chunk, webSocket, protocolHeader.version, log, RELAY_SERVER_UDP); }
        return handleUDPOutbound(protocolHeader.addressRemote, protocolHeader.portRemote, chunk, webSocket, protocolHeader.version, log, RELAY_SERVER_UDP);
      }
      handleTCPOutBound(remoteSocketWrapper, protocolHeader.addressRemote, protocolHeader.portRemote, protocolHeader.rawClientData, webSocket, protocolHeader.version, log);
    },
    close() { log(`readableWebSocketStream is close`); },
    abort(reason) { log(`readableWebSocketStream is abort`, JSON.stringify(reason)); },
  })).catch((err) => log("pipeTo error", err));
  return new Response(null, { status: 101, webSocket: client });
}

async function protocolSniffer(buffer) {
  if (buffer.byteLength >= 62) { const d = new Uint8Array(buffer.slice(56, 60)); if (d[0] === 0x0d && d[1] === 0x0a && (d[2] === 0x01 || d[2] === 0x03 || d[2] === 0x7f) && (d[3] === 0x01 || d[3] === 0x03 || d[3] === 0x04)) return atob(horse); }
  const d = new Uint8Array(buffer.slice(1, 17));
  if (arrayBufferToHex(d).match(/^[0-9a-f]{8}[0-9a-f]{4}4[0-9a-f]{3}[89ab][0-9a-f]{3}[0-9a-f]{12}$/i)) return atob(flash);
  return "ss";
}

async function handleTCPOutBound(remoteSocket, addressRemote, portRemote, rawClientData, webSocket, responseHeader, log) {
  async function connectAndWrite(address, port) { const tcpSocket = connect({ hostname: address, port: port }); remoteSocket.value = tcpSocket; log(`connected to ${address}:${port}`); const writer = tcpSocket.writable.getWriter(); await writer.write(rawClientData); writer.releaseLock(); return tcpSocket; }
  async function retry() { const tcpSocket = await connectAndWrite(prxIP.split(/[:=-]/)[0] || addressRemote, prxIP.split(/[:=-]/)[1] || portRemote); tcpSocket.closed.catch((e) => console.log("retry error", e)).finally(() => safeCloseWebSocket(webSocket)); remoteSocketToWS(tcpSocket, webSocket, responseHeader, null, log); }
  const tcpSocket = await connectAndWrite(addressRemote, portRemote);
  remoteSocketToWS(tcpSocket, webSocket, responseHeader, retry, log);
}

async function handleUDPOutbound(targetAddress, targetPort, dataChunk, webSocket, responseHeader, log, relay) {
  try {
    let protocolHeader = responseHeader;
    const tcpSocket = connect({ hostname: relay.host, port: relay.port });
    const header = `udp:${targetAddress}:${targetPort}`;
    const headerBuffer = new TextEncoder().encode(header);
    const separator = new Uint8Array([0x7c]);
    const relayMessage = new Uint8Array(headerBuffer.length + separator.length + dataChunk.byteLength);
    relayMessage.set(headerBuffer, 0); relayMessage.set(separator, headerBuffer.length); relayMessage.set(new Uint8Array(dataChunk), headerBuffer.length + separator.length);
    const writer = tcpSocket.writable.getWriter();
    await writer.write(relayMessage); writer.releaseLock();
    await tcpSocket.readable.pipeTo(new WritableStream({
      async write(chunk) { if (webSocket.readyState === WS_READY_STATE_OPEN) { if (protocolHeader) { webSocket.send(await new Blob([protocolHeader, chunk]).arrayBuffer()); protocolHeader = null; } else webSocket.send(chunk); } },
      close() { log(`UDP to ${targetAddress} closed`); },
      abort(reason) { console.error(`UDP abort: ${reason}`); },
    }));
  } catch (e) { console.error(`UDP error: ${e.message}`); }
}

function makeReadableWebSocketStream(webSocketServer, earlyDataHeader, log) {
  let readableStreamCancel = false;
  const stream = new ReadableStream({
    start(controller) {
      webSocketServer.addEventListener("message", (event) => { if (readableStreamCancel) return; controller.enqueue(event.data); });
      webSocketServer.addEventListener("close", () => { safeCloseWebSocket(webSocketServer); if (readableStreamCancel) return; controller.close(); });
      webSocketServer.addEventListener("error", (err) => { log("webSocket error"); controller.error(err); });
      const { earlyData, error } = base64ToArrayBuffer(earlyDataHeader);
      if (error) controller.error(error); else if (earlyData) controller.enqueue(earlyData);
    },
    pull() {},
    cancel(reason) { if (readableStreamCancel) return; log(`Stream canceled: ${reason}`); readableStreamCancel = true; safeCloseWebSocket(webSocketServer); },
  });
  return stream;
}

function readSsHeader(ssBuffer) {
  const view = new DataView(ssBuffer); const addressType = view.getUint8(0);
  let addressLength = 0, addressValueIndex = 1, addressValue = "";
  switch (addressType) {
    case 1: addressLength = 4; addressValue = new Uint8Array(ssBuffer.slice(addressValueIndex, addressValueIndex + addressLength)).join("."); break;
    case 3: addressLength = new Uint8Array(ssBuffer.slice(addressValueIndex, addressValueIndex + 1))[0]; addressValueIndex += 1; addressValue = new TextDecoder().decode(ssBuffer.slice(addressValueIndex, addressValueIndex + addressLength)); break;
    case 4: addressLength = 16; const dv = new DataView(ssBuffer.slice(addressValueIndex, addressValueIndex + addressLength)); const ipv6 = []; for (let i = 0; i < 8; i++) ipv6.push(dv.getUint16(i * 2).toString(16)); addressValue = ipv6.join(":"); break;
    default: return { hasError: true, message: `Invalid SS type: ${addressType}` };
  }
  if (!addressValue) return { hasError: true, message: "Empty address" };
  const portIndex = addressValueIndex + addressLength;
  const portRemote = new DataView(ssBuffer.slice(portIndex, portIndex + 2)).getUint16(0);
  return { hasError: false, addressRemote: addressValue, addressType, portRemote, rawDataIndex: portIndex + 2, rawClientData: ssBuffer.slice(portIndex + 2), version: null, isUDP: portRemote == 53 };
}

function readFlashHeader(buffer) {
  const version = new Uint8Array(buffer.slice(0, 1)); let isUDP = false;
  const optLength = new Uint8Array(buffer.slice(17, 18))[0];
  const cmd = new Uint8Array(buffer.slice(18 + optLength, 18 + optLength + 1))[0];
  if (cmd === 1) {} else if (cmd === 2) { isUDP = true; } else return { hasError: true, message: `Unsupported cmd ${cmd}` };
  const portIndex = 18 + optLength + 1;
  const portRemote = new DataView(buffer.slice(portIndex, portIndex + 2)).getUint16(0);
  let addressIndex = portIndex + 2;
  const addressType = new Uint8Array(buffer.slice(addressIndex, addressIndex + 1))[0];
  let addressLength = 0, addressValueIndex = addressIndex + 1, addressValue = "";
  switch (addressType) {
    case 1: addressLength = 4; addressValue = new Uint8Array(buffer.slice(addressValueIndex, addressValueIndex + addressLength)).join("."); break;
    case 2: addressLength = new Uint8Array(buffer.slice(addressValueIndex, addressValueIndex + 1))[0]; addressValueIndex += 1; addressValue = new TextDecoder().decode(buffer.slice(addressValueIndex, addressValueIndex + addressLength)); break;
    case 3: addressLength = 16; const dv = new DataView(buffer.slice(addressValueIndex, addressValueIndex + addressLength)); const ipv6 = []; for (let i = 0; i < 8; i++) ipv6.push(dv.getUint16(i * 2).toString(16)); addressValue = ipv6.join(":"); break;
    default: return { hasError: true, message: `Invalid type ${addressType}` };
  }
  if (!addressValue) return { hasError: true, message: "Empty address" };
  return { hasError: false, addressRemote: addressValue, addressType, portRemote, rawDataIndex: addressValueIndex + addressLength, rawClientData: buffer.slice(addressValueIndex + addressLength), version: new Uint8Array([version[0], 0]), isUDP };
}

function readHorseHeader(buffer) {
  const dataBuffer = buffer.slice(58);
  if (dataBuffer.byteLength < 6) return { hasError: true, message: "Invalid data" };
  let isUDP = false; const view = new DataView(dataBuffer); const cmd = view.getUint8(0);
  if (cmd == 3) isUDP = true; else if (cmd != 1) throw new Error("Unsupported cmd");
  let addressType = view.getUint8(1);
  let addressLength = 0, addressValueIndex = 2, addressValue = "";
  switch (addressType) {
    case 1: addressLength = 4; addressValue = new Uint8Array(dataBuffer.slice(addressValueIndex, addressValueIndex + addressLength)).join("."); break;
    case 3: addressLength = new Uint8Array(dataBuffer.slice(addressValueIndex, addressValueIndex + 1))[0]; addressValueIndex += 1; addressValue = new TextDecoder().decode(dataBuffer.slice(addressValueIndex, addressValueIndex + addressLength)); break;
    case 4: addressLength = 16; const dv = new DataView(dataBuffer.slice(addressValueIndex, addressValueIndex + addressLength)); const ipv6 = []; for (let i = 0; i < 8; i++) ipv6.push(dv.getUint16(i * 2).toString(16)); addressValue = ipv6.join(":"); break;
    default: return { hasError: true, message: `Invalid type ${addressType}` };
  }
  if (!addressValue) return { hasError: true, message: "Empty address" };
  const portIndex = addressValueIndex + addressLength;
  const portRemote = new DataView(dataBuffer.slice(portIndex, portIndex + 2)).getUint16(0);
  return { hasError: false, addressRemote: addressValue, addressType, portRemote, rawDataIndex: portIndex + 4, rawClientData: dataBuffer.slice(portIndex + 4), version: null, isUDP };
}

async function remoteSocketToWS(remoteSocket, webSocket, responseHeader, retry, log) {
  let header = responseHeader; let hasIncomingData = false;
  await remoteSocket.readable.pipeTo(new WritableStream({
    async write(chunk, controller) {
      hasIncomingData = true;
      if (webSocket.readyState !== WS_READY_STATE_OPEN) controller.error("WS not open");
      if (header) { webSocket.send(await new Blob([header, chunk]).arrayBuffer()); header = null; } else webSocket.send(chunk);
    },
    close() { log(`Remote closed, hasData: ${hasIncomingData}`); },
    abort(reason) { console.error(`Remote abort: ${reason}`); },
  })).catch((error) => { console.error(`remoteSocketToWS error`, error); safeCloseWebSocket(webSocket); });
  if (!hasIncomingData && retry) { log(`retry`); retry(); }
}

function safeCloseWebSocket(socket) { try { if (socket.readyState === WS_READY_STATE_OPEN || socket.readyState === WS_READY_STATE_CLOSING) socket.close(); } catch (e) {} }
function base64ToArrayBuffer(base64Str) { if (!base64Str) return { error: null }; try { base64Str = base64Str.replace(/-/g, "+").replace(/_/g, "/"); const decode = atob(base64Str); const arryBuffer = Uint8Array.from(decode, (c) => c.charCodeAt(0)); return { earlyData: arryBuffer.buffer, error: null }; } catch (error) { return { error }; } }
function arrayBufferToHex(buffer) { return [...new Uint8Array(buffer)].map((x) => x.toString(16).padStart(2, "0")).join(""); }

async function generateSubscription(params, request) {
  const domainParam = params.domain || "bug.com";
  const customIP = params.ip || null;
  const customPort = params.port || null;
  const fillerHost = request && request.headers.get("Host");
  let prx;
  if (customIP && customPort) { prx = { prxIP: customIP, prxPort: customPort, country: "CUSTOM", org: "Custom Proxy" }; }
  else {
    const prxList = await getPrx("ALL", request.env);
    const aliveList = prxList.filter(p => p.delay !== null && p.delay !== undefined);
    const finalList = aliveList.length > 0 ? aliveList : prxList;
    if (!finalList.length) return JSON.stringify({ error: "No alive proxy available" });
    finalList.sort((a, b) => (a.delay || 9999) - (b.delay || 9999));
    prx = finalList[Math.floor(Math.random() * Math.min(10, finalList.length))];
  }
  const uuid = crypto.randomUUID();
  const config_vls = {
    [atob(flash)]: (() => {
      const uri = new URL(`${atob(flash)}://${domainParam}`);
      uri.searchParams.set("encryption", "none");
      uri.searchParams.set("type", "ws");
      uri.searchParams.set("host", fillerHost);
      uri.protocol = atob(flash);
      uri.port = "443";
      uri.username = uuid;
      uri.searchParams.set("security", "tls");
      uri.searchParams.set("sni", fillerHost);
      uri.searchParams.set("path", `/${prx.prxIP}-${prx.prxPort}`);
      uri.hash = `${prx.org} WS TLS [${serviceName}]`;
      return uri.toString();
    })()
  };
  return JSON.stringify({ uuid, ip: prx.prxIP, port: prx.prxPort, country: prx.country, org: prx.org, source: prx.source || "bank", delay: prx.delay || null, config_vls }, null, 2);
}

async function reverseWeb(request, target, targetPath, env, ctx) {
  const targetUrl = new URL(request.url);
  const targetChunk = (target || "example.com").split(":");
  targetUrl.hostname = targetChunk[0];
  targetUrl.port = targetChunk[1]?.toString() || "443";
  targetUrl.pathname = targetPath || targetUrl.pathname;
  const modifiedRequest = new Request(targetUrl, request);
  modifiedRequest.headers.set("X-Forwarded-Host", request.headers.get("Host") || "");
  const response = await fetch(modifiedRequest);
  const contentLength = response.headers.get('content-length');
  let responseSize = contentLength ? parseInt(contentLength) : 0;
  if (!responseSize) { try { const clone = response.clone(); const body = await clone.text(); responseSize = new TextEncoder().encode(body).length; } catch (_) { responseSize = 0; } }
  const newResponse = new Response(response.body, response);
  for (const [key, value] of Object.entries(CORS_HEADER_OPTIONS)) newResponse.headers.set(key, value);
  newResponse.headers.set("X-Proxied-By", "Worker");
  if (env && ctx) ctx.waitUntil(updateTrafficStats(request, responseSize, env));
  return newResponse;
}

function serveUI() {
  const decodedJudul = atob(judul);
  const decodedFlash = atob(flash);
  // UI HTML yang sudah dibersihkan dari spasi aneh
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${decodedJudul}</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
<style>
body { background: #0f172a; color: #f8fafc; font-family: sans-serif; margin: 0; padding: 20px; }
.container { max-width: 800px; margin: 0 auto; }
h1 { color: #06b6d4; text-align: center; }
.card { background: #1e293b; padding: 20px; border-radius: 10px; margin-bottom: 20px; border: 1px solid #334155; }
.btn { background: #6366f1; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer; margin: 5px; }
.btn:disabled { opacity: 0.5; }
.proxy-list { max-height: 300px; overflow-y: auto; background: #020617; padding: 10px; border-radius: 5px; }
.proxy-item { padding: 10px; border-bottom: 1px solid #334155; cursor: pointer; display: flex; justify-content: space-between; }
.proxy-item:hover { background: #1e293b; }
.proxy-item.selected { background: #312e81; border: 1px solid #6366f1; }
.ping-good { color: #10b981; }
.ping-bad { color: #ef4444; }
</style>
</head>
<body>
<div class="container">
  <h1>${decodedJudul}</h1>
  <div class="card">
    <h3>Proxy Selector</h3>
    <div class="proxy-list" id="proxy-list">Loading...</div>
    <div style="margin-top: 15px;">
      <button class="btn" id="refresh-btn">Refresh</button>
      <button class="btn" id="force-scrape-btn">Force Scrape</button>
    </div>
  </div>
  <div class="card">
    <h3>Config Generator</h3>
    <input type="text" id="domain-input" value="bug.com" style="width: 100%; padding: 10px; margin-bottom: 10px; background: #020617; color: white; border: 1px solid #334155; border-radius: 5px;">
    <button class="btn" id="generate-btn" disabled>Generate VLESS</button>
    <textarea id="config-output" style="width: 100%; height: 100px; margin-top: 10px; background: #020617; color: white; border: 1px solid #334155; border-radius: 5px; padding: 10px;" readonly></textarea>
    <button class="btn" id="copy-btn" disabled>Copy</button>
  </div>
</div>
<script>
let selectedProxy = null;
let allProxies = [];

async function loadProxies() {
  document.getElementById('proxy-list').innerHTML = 'Loading...';
  try {
    const res = await fetch('/ALL.txt');
    const data = await res.json();
    allProxies = data || [];
    renderProxies();
  } catch (e) { document.getElementById('proxy-list').innerHTML = 'Error loading proxies'; }
}

function renderProxies() {
  const list = document.getElementById('proxy-list');
  list.innerHTML = '';
  if (allProxies.length === 0) { list.innerHTML = 'No proxies found'; return; }
  allProxies.forEach(p => {
    const div = document.createElement('div');
    div.className = 'proxy-item' + (selectedProxy && selectedProxy.prxIP === p.prxIP ? ' selected' : '');
    const pingClass = p.delay && p.delay < 300 ? 'ping-good' : 'ping-bad';
    const pingText = p.delay ? p.delay + 'ms' : 'Unverified';
    div.innerHTML = '<span><b>' + p.prxIP + ':' + p.prxPort + '</b> (' + p.country + ')</span><span class="' + pingClass + '">' + pingText + '</span>';
    div.onclick = () => { selectedProxy = p; renderProxies(); document.getElementById('generate-btn').disabled = false; };
    list.appendChild(div);
  });
}

document.getElementById('refresh-btn').onclick = loadProxies;
document.getElementById('force-scrape-btn').onclick = async () => {
  document.getElementById('proxy-list').innerHTML = 'Scraping...';
  await fetch('/scrape?force=true');
  loadProxies();
};

document.getElementById('generate-btn').onclick = async () => {
  if (!selectedProxy) return;
  const domain = document.getElementById('domain-input').value;
  const res = await fetch('/sub?domain=' + domain + '&ip=' + selectedProxy.prxIP + '&port=' + selectedProxy.prxPort);
  const data = await res.json();
  if (data.config_vls) {
    const key = Object.keys(data.config_vls)[0];
    document.getElementById('config-output').value = data.config_vls[key];
    document.getElementById('copy-btn').disabled = false;
  }
};

document.getElementById('copy-btn').onclick = () => {
  const textarea = document.getElementById('config-output');
  textarea.select();
  document.execCommand('copy');
  alert('Copied!');
};

loadProxies();
</script>
</body>
</html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

async function serveTrafficStats(request, env) {
  await loadTrafficStats(env);
  const url = new URL(request.url);
  if (url.searchParams.get('reset') === 'true' && request.method === 'POST') {
    trafficStats = { totalVisitors: 0, uniqueVisitors: new Set(), bandwidthUsed: 0, todayVisitors: 0, todayBandwidth: 0, lastReset: new Date().toISOString().split('T')[0] };
    await saveTrafficStats(env);
    return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
  }
  return new Response(JSON.stringify({ totalVisitors: trafficStats.totalVisitors, todayVisitors: trafficStats.todayVisitors }), { headers: { "Content-Type": "application/json" } });
}

async function servePing() { return new Response(JSON.stringify({ status: "ok" }), { headers: { "Content-Type": "application/json" } }); }
async function servePrxList(country, env) { const list = await getPrx(country, env); return new Response(JSON.stringify(list, null, 2), { headers: { "Content-Type": "application/json" } }); }
async function checkPrxHealth(proxyIP, proxyPort) { const req = await fetch(`${PRX_HEALTH_CHECK_API}?ip=${proxyIP}:${proxyPort}`); return await req.json(); }

function formatDuration(ms) { const s = Math.floor(ms / 1000); const m = Math.floor(s / 60); const h = Math.floor(m / 60); const d = Math.floor(h / 24); if (d > 0) return `${d}d ${h % 24}h ${m % 60}m`; if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`; if (m > 0) return `${m}m ${s % 60}s`; return `${s}s`; }
async function getServerStartTime(env) { if (!globalThis._serverStartTime) { const now = Date.now() + 7 * 60 * 60 * 1000; globalThis._serverStartTime = now; globalThis._serverStartDate = new Date(now); } return { time: globalThis._serverStartTime, date: globalThis._serverStartDate }; }
async function getUptimeResponse(env) { const start = await getServerStartTime(env); const diff = Date.now() + 7 * 60 * 60 * 1000 - start.time; return { status: "ok", uptime: formatDuration(diff) }; }

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const upgradeHeader = request.headers.get("Upgrade");
      if (upgradeHeader !== "websocket") {
        const originalResponse = await this.handleRequest(request, env, ctx);
        const contentLength = originalResponse.headers.get("content-length");
        let responseSize = contentLength ? parseInt(contentLength) : 0;
        if (!responseSize) { try { const clone = originalResponse.clone(); const body = await clone.text(); responseSize = new TextEncoder().encode(body).length; } catch (_) { responseSize = 0; } }
        if (env && ctx) ctx.waitUntil(updateTrafficStats(request, responseSize, env));
        return originalResponse;
      }
      return await this.handleRequest(request, env, ctx);
    } catch (err) { return new Response(`Error: ${err.toString()}`, { status: 500 }); }
  },
  async handleRequest(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const upgradeHeader = request.headers.get("Upgrade");
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADER_OPTIONS });
    if (pathname === "/") return serveUI();
    if (pathname === "/traffic") return await serveTrafficStats(request, env);
    if (pathname === "/health") {
      const ipPort = url.searchParams.get("ip");
      if (!ipPort) return new Response(JSON.stringify({ error: "missing_ip" }), { status: 400 });
      const [ip, port] = ipPort.split(":");
      return new Response(JSON.stringify(await checkPrxHealth(ip, port || "443")), { status: 200 });
    }
    if (pathname === "/SG.txt") return await servePrxList("SG", env);
    if (pathname === "/ID.txt") return await servePrxList("ID", env);
    if (pathname === "/ALL.txt") return await servePrxList("ALL", env);
    if (pathname === "/scrape") {
      const force = url.searchParams.get("force") === "true";
      if (force) { scrapeCache = { data: null, timestamp: 0, stats: null }; if (env && env.proxy_cache) { try { await env.proxy_cache.delete("freshProxies"); } catch (e) {} } }
      const fresh = await scrapeFreshProxies(env, force);
      return new Response(JSON.stringify({ success: true, count: fresh.length, stats: scrapeCache.stats }), { headers: { "Content-Type": "application/json" } });
    }
    if (pathname === "/scrape-stats") return new Response(JSON.stringify({ timestamp: scrapeCache.timestamp, stats: scrapeCache.stats }), { headers: { "Content-Type": "application/json" } });
    if (pathname.startsWith("/sub")) { const params = Object.fromEntries(url.searchParams.entries()); return new Response(await generateSubscription(params, request), { status: 200 }); }
    if (pathname === "/ping") return servePing();
    if (pathname === "/uptime") return new Response(JSON.stringify(await getUptimeResponse(env)), { headers: { "Content-Type": "application/json" } });
    if (upgradeHeader === "websocket") { const prxMatch = url.pathname.match(/^\/(.+[:=-]\d+)$/); if (prxMatch) { prxIP = prxMatch[1]; return await websocketHandler(request); } }
    return await reverseWeb(request, (env && env.REVERSE_PRX_TARGET) || "example.com", null, env, ctx);
  }
};