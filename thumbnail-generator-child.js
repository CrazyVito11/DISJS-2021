const path  = require('path');
const sharp = require('sharp');

async function hashImages(imagesToCompress, destinationPath) {
    for(let index = 0; index < imagesToCompress.length; index++) {
        const image = imagesToCompress[index];

        await sharp(image.path)
            .resize({
                fit: sharp.fit.inside,
                width: 200,
                height: 200
            })
            .toFile(path.join(destinationPath, `${image.hash}.jpg`));
    }
}

process.on("message", async (msg) => {
    if (msg.type === 'begin') {
        await hashImages(msg.images, msg.destinationPath);
        process.send({ type: 'finished' });
    }
});
