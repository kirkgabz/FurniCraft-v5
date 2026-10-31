import http from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";

const root = process.argv[2] || ".";
const port = Number(process.argv[3] || 8934);

const MIME = { ".html": "text/html", ".glb": "model/gltf-binary", ".js": "text/javascript" };

http.createServer(async (req, res) => {
  try {
    const url = decodeURIComponent(req.url.split("?")[0]);
    const filePath = join(root, url === "/" ? "/viewer.html" : url);
    const data = await readFile(filePath);
    res.writeHead(200, { "Content-Type": MIME[extname(filePath)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
}).listen(port, () => console.log(`serving ${root} on http://localhost:${port}`));
