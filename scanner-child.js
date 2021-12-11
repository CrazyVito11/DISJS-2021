const resemble = require('resemblejs');
const fs       = require('fs');

async function scanForDuplicates(imageCombinations = []) {
    let combinationMismatchResults = [];

    for (let combinationIndex = 0; combinationIndex < imageCombinations.length; combinationIndex++) {
        const imageCombination = imageCombinations[combinationIndex];
        const imageData        = [fs.readFileSync(imageCombination[0].pathToUse), fs.readFileSync(imageCombination[1].pathToUse)]; // todo: optimize this line so it doesn't require as much disk IO
        let misMatchPercentage = 0;

        await resemble(imageData[0])
            .compareTo(imageData[1])
            .scaleToSameSize()
            .onComplete((data) => {
                misMatchPercentage = parseFloat(data.misMatchPercentage);
            });

        combinationMismatchResults.push({
            combination: imageCombination,
            misMatchPercentage: misMatchPercentage,
        });

        process.send({
            type: 'progress',
            scannedCombinations: combinationMismatchResults.length
        });
    }

    return combinationMismatchResults;
}

process.on("message", async (msg) => {
    if (msg.type === 'begin') {
        const result = await scanForDuplicates(msg.imageCombinations);

        process.send({ type: 'finished', result: result });
    }
});
