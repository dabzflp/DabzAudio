const { MongoClient } = require("mongodb");

let client;
let db;

async function connectDatabase() {
    if (!process.env.MONGODB_URI) {
        console.warn("MONGODB_URI is not configured. Running in memory mode.");
        return null;
    }

    client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();

    db = client.db(process.env.MONGODB_DB || "dabzaudio_registry");

    await db.collection("music").createIndex({ musicId: 1 }, { unique: true });
    await db.collection("music").createIndex({ audioHash: 1 });
    await db.collection("music").createIndex({ createdAt: -1 });

    console.log("Connected to MongoDB");
    return db;
}

function getDatabase() {
    return db;
}

module.exports = {
    connectDatabase,
    getDatabase
};
