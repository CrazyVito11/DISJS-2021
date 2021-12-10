const fs       = require('fs');
const SparkMD5 = require('spark-md5');

let hashedFiles = [];

async function hashImages(imagesToHash) {
    for(let hashIndex = 0; hashIndex < imagesToHash.length; hashIndex++) {
        const hashingImage     = imagesToHash[hashIndex];
        const hashingImageData = fs.readFileSync(hashingImage);

        hashedFiles.push({
            path: hashingImage,
            hash: SparkMD5.hash(hashingImageData)
        });
    }
}

process.on("message", async (msg) => {
    if (msg.type === 'begin') {
        await hashImages(msg.images);
        process.send({ type: 'finished', files: hashedFiles });
    }
});
