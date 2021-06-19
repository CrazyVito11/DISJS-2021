const resemble = require('resemblejs');
const fs       = require('fs');

let uniqueImages        = [];
let alreadyScannedFiles = [];

async function scanForDuplicates(images, imagesToCheck) {
    for (let imageToCheckIndex = 0; imageToCheckIndex < imagesToCheck.length; imageToCheckIndex++) {
        const imageToCheck  = imagesToCheck[imageToCheckIndex].path;
        const imageFileData = fs.readFileSync(imageToCheck);
        const imageFileHash = imagesToCheck[imageToCheckIndex].hash;

        for (let comparingImageIndex = 0; comparingImageIndex < images.length; comparingImageIndex++) {
            await setImmediatePromise();

            process.send({ type: 'progress' });

            const comparingImage = images[comparingImageIndex].path;

            if (imageToCheck === comparingImage) {
                continue;
            }

            const comparingImageData = fs.readFileSync(comparingImage);
            const comparingImageHash = images[comparingImageIndex].hash;
            const comparingFiles     = [
                {
                    path: imageToCheck,
                    hash: imageFileHash
                },
                {
                    path: comparingImage,
                    hash: comparingImageHash
                }
            ];

            if (! checkIfAlreadyScanned(comparingFiles)) {
                let misMatchPercentage = 0;

                process.send({
                    type: 'checkedfile',
                    files: comparingFiles
                });

                alreadyScannedFiles.push(comparingFiles);

                if (imageFileHash === comparingImageHash) {
                    // The hash matches completely, the content is identical

                    process.send({
                        type: 'duplicate',
                        files: comparingFiles,
                        misMatchPercentage: 0
                    });

                    continue;
                }

                await resemble(imageFileData)
                    .compareTo(comparingImageData)
                    .scaleToSameSize()
                    .onComplete((data) => {
                        misMatchPercentage = data.misMatchPercentage;
                    });

                if (misMatchPercentage < 50) {
                    process.send({
                        type: 'duplicate',
                        files: comparingFiles,
                        misMatchPercentage: misMatchPercentage
                    });
                }

                uniqueImages.push(comparingFiles);
            }
        }
    }
}

function setImmediatePromise() {
    return new Promise((resolve) => {
        setImmediate(() => resolve());
    });
}

function checkIfAlreadyScanned(file) {
    return alreadyScannedFiles.some(alreadyScanned => {
        return (
            alreadyScanned[0].path === file[0].path &&
            alreadyScanned[1].path === file[1].path &&
            alreadyScanned[0].hash === file[0].hash &&
            alreadyScanned[1].hash === file[1].hash ||

            alreadyScanned[1].path === file[0].path &&
            alreadyScanned[0].path === file[1].path &&
            alreadyScanned[1].hash === file[0].hash &&
            alreadyScanned[0].hash === file[1].hash
        );
    })
}

process.on("message", async (msg) => {
    if (msg.type === 'begin') {
        await scanForDuplicates(msg.allImages, msg.imagesToCheck);
        process.send({ type: 'finished' });
    } else if (msg.type === 'alreadychecked') {
        // Only add items that we don't already have

        msg.alreadyCheckedFiles.forEach((newAlreadyScanned) => {
            if (! checkIfAlreadyScanned(newAlreadyScanned)) {
                alreadyScannedFiles.push(newAlreadyScanned);
            }
        })
    }
});
