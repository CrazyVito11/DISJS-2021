const resemble = require('resemblejs');
const fs       = require('fs');

let alreadyScannedFiles = [];

async function scanForDuplicates(allImages, imageToCheck) {
    const imageFileData = fs.readFileSync(imageToCheck.path);

    for(let comparingImageIndex = 0; comparingImageIndex < allImages.length; comparingImageIndex++) {
        const comparingImage = allImages[comparingImageIndex];

        if (imageToCheck.path === comparingImage.path) {
            continue;
        }

        const comparingImageData = fs.readFileSync(comparingImage.path);
        const comparingFiles     = [
            {
                path: imageToCheck.path,
                hash: imageToCheck.hash
            },
            {
                path: comparingImage.path,
                hash: comparingImage.hash
            }
        ];

        if (!checkIfAlreadyScanned(comparingFiles)) {
            let misMatchPercentage = 0;

            alreadyScannedFiles.push(comparingFiles);

            if (imageToCheck.hash === comparingImage.hash) {
                // The hash matches completely, the content is identical

                process.send({
                    type: 'result',
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


            process.send({
                type: 'result',
                files: comparingFiles,
                misMatchPercentage: misMatchPercentage
            });
        } else {
            console.log('already scanned!')
        }
    }
}

function checkIfAlreadyScanned(file) {
    return alreadyScannedFiles.some(alreadyScanned => {
        return (
            alreadyScanned[0].path == file[0].path &&
            alreadyScanned[1].path == file[1].path &&
            alreadyScanned[0].hash == file[0].hash &&
            alreadyScanned[1].hash == file[1].hash ||

            alreadyScanned[1].path == file[0].path &&
            alreadyScanned[0].path == file[1].path &&
            alreadyScanned[1].hash == file[0].hash &&
            alreadyScanned[0].hash == file[1].hash
        );
    })
}

process.on("message", async (msg) => {
    if (msg.type === 'checkfile') {
        msg.alreadyScannedFiles.forEach((newAlreadyScanned) => {
            if (! checkIfAlreadyScanned(newAlreadyScanned)) {
                alreadyScannedFiles.push(newAlreadyScanned);
            }
        })
        //alreadyScannedFiles = msg.alreadyScannedFiles;

        await scanForDuplicates(msg.allImages, msg.imageToCheck);
        process.send({ type: 'finished', file: msg.imageToCheck });
    }
});
