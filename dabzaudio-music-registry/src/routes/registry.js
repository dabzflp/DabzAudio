const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

const { getDatabase } = require("../services/database");
const { createFileHash, createMusicId } = require("../services/hash");
const { registerOnBlockchain } = require("../services/blockchain");

const router = express.Router();

const uploadDirectory = path.join(__dirname, "..", "..", "uploads");

if (!fs.existsSync(uploadDirectory)) {
    fs.mkdirSync(uploadDirectory, { recursive: true });
}

const upload = multer({
    dest: uploadDirectory,
    limits: {
        fileSize: 50 * 1024 * 1024
    },
    fileFilter: function (req, file, callback) {
        const allowed = [
            "audio/mpeg",
            "audio/wav",
            "audio/x-wav",
            "audio/mp4",
            "audio/aac",
            "audio/flac"
        ];

        if (!allowed.includes(file.mimetype)) {
            return callback(new Error("Unsupported audio format."));
        }

        callback(null, true);
    }
});

router.post("/register", upload.single("audio"), async function (req, res) {
    let temporaryFile = null;

    try {
        if (!req.file) {
            return res.status(400).json({
                error: "Upload an audio file."
            });
        }

        temporaryFile = req.file.path;

        const musicId = createMusicId();
        const audioHash = await createFileHash(temporaryFile);

        const contributors = parseContributors(req.body.contributors);
        const ownership = parseOwnership(req.body.ownership);

        const record = {
            musicId,
            title: String(req.body.title || "").trim(),
            artist: String(req.body.artist || "").trim(),
            producer: String(req.body.producer || "").trim(),
            isrc: String(req.body.isrc || "").trim(),
            genre: String(req.body.genre || "").trim(),
            audioHash,
            contributors,
            ownership,
            status: "registered",
            blockchain: {
                status: "pending",
                transactionHash: null
            },
            createdAt: new Date(),
            updatedAt: new Date()
        };

        if (!record.title || !record.artist) {
            return res.status(400).json({
                error: "Title and artist are required."
            });
        }

        const database = getDatabase();

        if (database) {
            await database.collection("music").insertOne(record);
        }

        const metadataUri = `${process.env.APP_BASE_URL || "http://localhost:3000"}/api/registry/${musicId}`;

        const blockchainResult = await registerOnBlockchain(
            audioHash,
            musicId,
            metadataUri
        );

        record.blockchain = blockchainResult;
        record.updatedAt = new Date();

        if (database) {
            await database.collection("music").updateOne(
                { musicId },
                {
                    $set: {
                        blockchain: blockchainResult,
                        updatedAt: record.updatedAt
                    }
                }
            );
        }

        return res.status(201).json({
            success: true,
            music: sanitizeRecord(record)
        });
    } catch (error) {
        console.error("Registration error:", error);

        return res.status(500).json({
            error: error.message || "Unable to register music."
        });
    } finally {
        if (temporaryFile && fs.existsSync(temporaryFile)) {
            fs.unlinkSync(temporaryFile);
        }
    }
});

router.get("/:musicId", async function (req, res) {
    try {
        const database = getDatabase();

        if (!database) {
            return res.status(503).json({
                error: "Database is not configured."
            });
        }

        const record = await database.collection("music").findOne({
            musicId: req.params.musicId
        });

        if (!record) {
            return res.status(404).json({
                error: "Music ID not found."
            });
        }

        return res.json({
            success: true,
            music: sanitizeRecord(record)
        });
    } catch (error) {
        console.error("Lookup error:", error);

        return res.status(500).json({
            error: "Unable to retrieve music record."
        });
    }
});

function parseContributors(value) {
    if (!value) {
        return [];
    }

    try {
        return JSON.parse(value);
    } catch (error) {
        return [];
    }
}

function parseOwnership(value) {
    if (!value) {
        return [];
    }

    try {
        const ownership = JSON.parse(value);

        if (!Array.isArray(ownership)) {
            return [];
        }

        return ownership;
    } catch (error) {
        return [];
    }
}

function sanitizeRecord(record) {
    return {
        musicId: record.musicId,
        title: record.title,
        artist: record.artist,
        producer: record.producer,
        isrc: record.isrc,
        genre: record.genre,
        audioHash: record.audioHash,
        contributors: record.contributors,
        ownership: record.ownership,
        status: record.status,
        blockchain: record.blockchain,
        createdAt: record.createdAt
    };
}

module.exports = router;
