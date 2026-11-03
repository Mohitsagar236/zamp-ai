// Disposable in-memory receiver. Receives no invoice content or credentials.
import { createServer } from "node:http";
const events = [];
createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/events") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(events));
    return;
  }
  if (req.method !== "POST" || req.url !== "/alerts") {
    res.writeHead(404).end();
    return;
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 65536) {
      res.writeHead(413).end();
      return;
    }
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString());
    events.push({
      at: new Date().toISOString(),
      status: body.status,
      alerts: (body.alerts ?? []).map((alert) => ({
        status: alert.status,
        name: alert.labels?.alertname,
      })),
    });
    if (events.length > 100) events.shift();
    res.writeHead(204).end();
  } catch {
    res.writeHead(400).end();
  }
}).listen(8080, "0.0.0.0");
