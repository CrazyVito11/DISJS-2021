const fs          = require('fs');
const path        = require('path');
const cliProgress = require('cli-progress');
const { fork }    = require('child_process');
const yargs       = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const argv        = yargs(hideBin(process.argv)).argv;

const directoryToScan = argv._[0];
if (! directoryToScan) {
    console.error("No directory given, exiting...");

    return;
}

if (! fs.existsSync(directoryToScan)) {
    console.error("Directory not found, exiting...");

    return;
}

const disjsFolderName                = ".disjs";                                               // Main disjs folder name
const disjsFolderPath                = path.join(directoryToScan, `/${disjsFolderName}`);      // Main disjs folder where disjs data is stored
const disjsThumbnailPath             = path.join(disjsFolderPath, "/thumbnails");              // Folder where the thumbnail versions are stored of the images
const disjsNotDuplicatesFilePath     = path.join(disjsFolderPath, "/not_duplicates.json");     // Image combinations that are scanned before and are known to not be duplicates
const disjsIgnoredDuplicatesFilePath = path.join(disjsFolderPath, "/ignored_duplicates.json"); // Image combinations that the user said are not duplicates
const disjsSessionFilePath           = path.join(disjsFolderPath, "/session.json");            // Optional restore file in case the application crashes mid scan
if (! fs.existsSync(disjsFolderPath)) {
    fs.mkdirSync(disjsFolderPath);
}

let sessionData = null;
if (fs.existsSync(disjsSessionFilePath)) {
    console.log('Reading session file...');
    //sessionData = JSON.parse(fs.readFileSync(disjsSessionFilePath));
    console.log('Session file loaded');
}

let threads = 4;
if (argv.threads) {
    const parsedThreadsParameter = Number.parseInt(argv.threads);

    if (! Number.isNaN(parsedThreadsParameter) && parsedThreadsParameter > 0) {
        threads = parsedThreadsParameter;
    }
}

let images               = [];
const supportedFiletypes = [
    '.jpeg',
    '.png',
    '.gif',
    '.jpg',
    '.bmp',
];

if (! sessionData) {
    console.log(`Searching for images in ${directoryToScan}`);

    (function searchDirectory(dir = directoryToScan) {
        let files = fs.readdirSync(dir);
        for(let file of files) {
            if (file === disjsFolderName) continue;

            let stat = fs.lstatSync(path.join(dir, file));
            if (stat.isDirectory()) {
                searchDirectory(path.join(dir, file));
            } else {
                if (supportedFiletypes.includes(path.extname(file).toLowerCase())) {
                    images.push(path.join(dir, file));
                }
            }
        }
    })();

    console.log(`Found ${images.length} image(s)`);
}

console.log(`Generating hashes`);
addHashToImagesList(images, threads)
    .then((imagesHashed) => {
        console.log('Generating thumbnails');

        // todo: hier eerst kijken naar hash duplicates en die er uit filteren
        generateThumbnails(imagesHashed)
            .then(() => {
                console.log('Scanning for duplicates');

                scanImagesForDuplicates(imagesHashed)
                    .then((result) => {
                        const filteredResults = result.results.filter((resultItem) => resultItem.misMatchPercentage < 50);

                        if (filteredResults.length === 0) {
                            console.log(`Scanning took ${result.timeTook}ms`);
                            console.log("No duplicates found ;)");

                            return process.exit();
                        }

                        const resultsTextFilePath = path.join(disjsFolderPath, "/result.txt");
                        let resultsAsText         = `Scanning took ${result.timeTook}ms\nThe following ${filteredResults.length} file(s) might be duplicates:\n`;
                        filteredResults.forEach((resultItem) => {
                            resultsAsText += `\n-\n   File #1: ${resultItem.combination[0].originalPath}\n   File #2: ${resultItem.combination[1].originalPath}\n   Mismatch: ${resultItem.misMatchPercentage}%`;
                        });

                        fs.writeFileSync(resultsTextFilePath, resultsAsText);
                        console.log(`${resultsAsText}\n\nYou can also find the results in ${resultsTextFilePath}`);

                        process.exit();
                    });
            });
    })



// const writeToSessionFile = setInterval(async () => {
//     const fileContent = {
//         dts: directoryToScan,
//         p: {
//             total: progressTotal,
//             current: progressCounter
//         },
//         cs: currentlyScanning,
//         ilts: imagesLeftToScan,
//         d: duplicates,
//         asf: alreadyScannedFiles
//     };
//
//     fs.writeFileSync(path.join(__dirname, 'session.json'), JSON.stringify(fileContent));
// }, 60000);






async function addHashToImagesList(images, threads) {
    let imagesHashed = [];

    return new Promise((resolve) => {
        for(let threadIndex = 0; threadIndex < threads; threadIndex++) {
            const child       = fork(`${__dirname}/hasher-child.js`);
            const chunkSize   = Math.ceil(images.length / threads);
            const offset      = Math.floor(threadIndex * chunkSize);
            const chunkImages = images.slice(offset, offset + chunkSize);

            if (!chunkImages.length) {
                child.kill();

                continue;
            }

            child.send({ type: 'begin', images: chunkImages });
            child.on("message", (data) => {
                if (data.type === 'finished') {
                    imagesHashed = imagesHashed.concat(data.files);

                    child.kill();
                }
            });
        }

        setInterval(() => {
            if (imagesHashed.length === images.length) {
                resolve(imagesHashed);
            }
        }, 100)
    });
}

async function generateThumbnails(images) {
    if (! fs.existsSync(disjsThumbnailPath)) {
        fs.mkdirSync(disjsThumbnailPath)
    }

    const chunks          = chunkGenerator(images, Math.ceil(images.length / threads));
    let childrenStillBusy = chunks.length;

    return new Promise((resolve) => {
        chunks.forEach((chunk) => {
            const child = fork(`${__dirname}/thumbnail-generator-child.js`);

            child.send({ type: 'begin', images: chunk, destinationPath: disjsThumbnailPath });
            child.on("message", (data) => {
                if (data.type === 'finished') {
                    childrenStillBusy--;

                    child.kill();
                }
            });
        });

        setInterval(() => {
            if (childrenStillBusy === 0) {
                resolve();
            }
        }, 500);
    });
}

async function scanImagesForDuplicates(images = []) {
    return new Promise((resolve, reject) => {
        const imagesMapped = images.map((image) => ({
            originalPath: image.path,
            pathToUse: path.join(disjsThumbnailPath, `${image.hash}.jpg`),
            hash: image.hash
        }));

        const imageCombinations      = generateImageCombinations(imagesMapped);
        const startTimeStamp         = new Date();
        const chunks                 = chunkGenerator(imageCombinations, Math.ceil(imageCombinations.length / threads));
        let scanImagesResults        = [];
        let childrenStillBusy        = chunks.length;
        let combinationsScannedCount = [];

        chunks.forEach((chunk, index) => {
            const child = fork(`${__dirname}/scanner-child.js`);

            child.send({ type: "begin", imageCombinations: chunk });
            child.on("message", (data) => {
                switch (data.type) {
                    case "finished":
                        scanImagesResults = scanImagesResults.concat(data.result)
                        childrenStillBusy--;
                        child.kill();

                        break;
                    case "progress":
                        combinationsScannedCount[index] = data.scannedCombinations;

                        break;
                }
            });
        });

        const scanInterval = setInterval(() => {
            if (childrenStillBusy === 0) {
                const timeTook = (new Date().getTime() - startTimeStamp.getTime());

                clearInterval(scanInterval);
                resolve({ results: scanImagesResults, timeTook: timeTook });
            }

            const currentProgress      = combinationsScannedCount.reduce((accumulator, a) => accumulator + a, 0);
            const progressAsPercentage = currentProgress / imageCombinations.length * 100;
            console.log(`${currentProgress} / ${imageCombinations.length} (${progressAsPercentage.toFixed(1)}%)`);
        }, 500);
    });
}

function generateImageCombinations(images) {
    return images.flatMap(
        (v, i) => images.slice(i+1).map( w => [v, w])
    ).filter((imageCombination) => imageCombination[0].originalPath !== imageCombination[1].originalPath);
}

const chunkGenerator = (array, chunk_size) => Array(Math.ceil(array.length / chunk_size)).fill().map((_, index) => index * chunk_size).map(begin => array.slice(begin, begin + chunk_size));
