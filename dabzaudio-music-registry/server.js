require("dotenv").config();

const express = require("express");
const path = require("path");

const registryRoutes = require("./src/routes/registry");
const { connectDatabase } = require("./src/services/database");

const app = express();
const PORT = process.env.PORT || 3000;

app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/public", express.static(path.join(__dirname, "public")));

app.get("/health", function (req, res) {
    res.json({
        ok: true,
        service: "DabzAudio Music Registry",
        version: "0.1.0"
    });
});

app.use("/api/registry", registryRoutes);

app.get("/music-id/:musicId", function (req, res) {
    res.sendFile(path.join(__dirname, "public", "verify.html"));
});

app.get("/registry", function (req, res) {
    res.sendFile(path.join(__dirname, "public", "registry.html"));
});

async function startServer() {
    try {
        await connectDatabase();

        app.listen(PORT, function () {
            console.log(`DabzAudio Music Registry running on port ${PORT}`);
        });
    } catch (error) {
        console.error("Server startup failed:", error);
        process.exit(1);
    }
}

startServer();
