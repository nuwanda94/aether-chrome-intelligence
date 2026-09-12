import express from "express";
import path from "path";

const app = express();
const PORT = 3000;
const HOST = "0.0.0.0";
const rootDir = process.cwd();

app.use(express.json());

// API health endpoint
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", name: "aether-chrome-intelligence" });
});

// Serve static files from root
app.use(express.static(rootDir, {
  extensions: ["html", "htm"],
  index: "index.html",
}));

// Route aliases
app.get("/sidepanel", (req, res) => {
  res.sendFile(path.join(rootDir, "sidepanel", "index.html"));
});

app.get("/options", (req, res) => {
  res.sendFile(path.join(rootDir, "options", "index.html"));
});

// Fallback to index.html for client-side routing
app.get("*all", (req, res) => {
  res.sendFile(path.join(rootDir, "index.html"));
});

app.listen(PORT, HOST, () => {
  console.log(`Aether server listening on http://${HOST}:${PORT}`);
});
