const resemble = require('resemblejs');
const fs       = require('fs');

let imagesPreloaded = [];

async function scanForDuplicates(imageCombinations = []) {
    let combinationMismatchResults = [];

    preloadImages(imageCombinations);
    for (let combinationIndex = 0; combinationIndex < imageCombinations.length; combinationIndex++) {
        const imageCombination = imageCombinations[combinationIndex];
        const imageData        = [imagesPreloaded[imageCombination.combinations[0].pathToUse], imagesPreloaded[imageCombination.combinations[1].pathToUse]]; // todo: optimize this line so it doesn't require as much disk IO
        let misMatchPercentage = 0;

        if (! imageCombination.misMatchPercentage) {
            await resemble(imageData[0])
                .compareTo(imageData[1])
                .scaleToSameSize()
                .onComplete((data) => {
                    misMatchPercentage = parseFloat(data.misMatchPercentage);
                });
        } else {
            misMatchPercentage = imageCombination.misMatchPercentage;
        }

        combinationMismatchResults.push({
            combination: imageCombination.combinations,
            misMatchPercentage: misMatchPercentage,
        });

        process.send({
            type: 'progress',
            scannedCombinations: combinationMismatchResults.length
        });
    }

    return combinationMismatchResults;
}

function preloadImages(imageCombinations = []) {
    imagesPreloaded = [];

    for (let combinationIndex = 0; combinationIndex < imageCombinations.length; combinationIndex++) {
        const imageCombination = imageCombinations[combinationIndex];

        imagesPreloaded[imageCombination.combinations[0].pathToUse] = fs.readFileSync(imageCombination.combinations[0].pathToUse);
        imagesPreloaded[imageCombination.combinations[1].pathToUse] = fs.readFileSync(imageCombination.combinations[1].pathToUse);
    }
}

process.on("message", async (msg) => {
    if (msg.type === 'begin') {
        const result = await scanForDuplicates(msg.imageCombinations);

        process.send({ type: 'finished', result: result });
    }
});
