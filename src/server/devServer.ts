import { createApiServer } from "./api.js";
import { loadLocalEnv } from "./env.js";
import { createServer as createViteServer } from "vite";

loadLocalEnv();

const port = Number(process.env.PORT ?? 4177);
const vite = await createViteServer({
  server: {
    middlewareMode: true
  },
  appType: "spa"
});
const server = createApiServer({ fallback: vite.middlewares });

server.listen(port, "127.0.0.1", () => {
  console.log(`Ricochet Rush dev server at http://127.0.0.1:${port}`);
});
