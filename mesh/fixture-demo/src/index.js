import { createServer } from "node:http";
import { listOrganisms } from "./routes.js";

const PORT = Number(process.env.PORT ?? 3101);

const server = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.url === "/organisms") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(listOrganisms()));
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

server.listen(PORT, () => {
  console.log(`mesh-demo listening on ${PORT}`);
});
