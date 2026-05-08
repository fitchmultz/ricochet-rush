import { resolve } from "node:path";
import { createApiServer } from "./api.js";

const port = Number(process.env.PORT ?? 4177);
const staticDir = resolve("dist");
const server = createApiServer({ staticDir });

server.listen(port, "127.0.0.1", () => {
  console.log(`Ricochet Rush preview at http://127.0.0.1:${port}`);
});
