const fs    = require('fs');
const path  = require('path');
const sharp = require('sharp');

async function hashImages(imagesToCompress, destinationPath) {
    for(let index = 0; index < imagesToCompress.length; index++) {
        const image               = imagesToCompress[index];
        const destinationFilePath = path.join(destinationPath, `${image.uid}.jpg`);

        if (fs.existsSync(destinationFilePath)) {
            // We already have this thumbnail, skip

            continue;
        }

        await sharp(image.p)
            .resize({
                fit: sharp.fit.inside,
                width: 200,
                height: 200
            })
            .toFile(destinationFilePath);
    }
}

process.on("message", async (msg) => {
    if (msg.type === 'begin') {
        await hashImages(msg.images, msg.destinationPath);
        process.send({ type: 'finished' });
    }
});
