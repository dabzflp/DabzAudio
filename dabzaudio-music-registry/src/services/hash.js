const crypto = require("crypto");
const fs = require("fs");

function createFileHash(filePath) {
    return new Promise(function (resolve, reject) {
        const hash = crypto.createHash("sha256");
        const stream = fs.createReadStream(filePath);

        stream.on("data", function (chunk) {
            hash.update(chunk);
        });

        stream.on("end", function () {
            resolve(hash.digest("hex"));
        });

        stream.on("error", reject);
    });
}

function createMusicId() {
    const random = crypto.randomBytes(5).toString("hex").toUpperCase();
    const timestamp = Date.now().toString(36).toUpperCase();

    return `DZ-${timestamp}-${random}`;
}

module.exports = {
    createFileHash,
    createMusicId
};
