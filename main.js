const fs          = require('fs');
const path        = require('path');
const cliProgress = require('cli-progress');
const { fork }    = require('child_process');
const yargs       = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const uuid        = require('uuid');
const SparkMD5    = require('spark-md5');
const helpers     = require('./helpers');
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

global.disjsFolderName                  = ".disjs";                                                 // Name for the main DISJS folder
global.disjsFolderPath                  = path.join(directoryToScan, `/${global.disjsFolderName}`); // Main DISJS folder where DISJS data is stored
global.disjsThumbnailPath               = path.join(global.disjsFolderPath, "/thumbnails");         // Folder where the thumbnail versions are stored of the images
global.disjsFilesDatabaseFilePath       = path.join(global.disjsFolderPath, "/f_db.json");          // Database file of all the registered images in that folder
global.disjsScannedCombinationsFilePath = path.join(global.disjsFolderPath, "/sc_db.json");         // Image combinations that we have scanned before
global.disjsIgnoredCombinationsFilePath = path.join(global.disjsFolderPath, "/ic_db.json");         // Image combinations that the user said are not duplicates

if (!fs.existsSync(global.disjsFolderPath)) {
    fs.mkdirSync(global.disjsFolderPath);
}


let threads = 4;
if (argv.threads) {
    const parsedThreadsParameter = Number.parseInt(argv.threads);

    if (! Number.isNaN(parsedThreadsParameter) && parsedThreadsParameter > 0) {
        threads = parsedThreadsParameter;
    }
}

let filesDb               = [];
let scannedCombinationsDb = [];
let ignoredCombinationsDb = [];
if (fs.existsSync(global.disjsFilesDatabaseFilePath)) {
    console.log('Reading database...');

    filesDb = JSON.parse(fs.readFileSync(global.disjsFilesDatabaseFilePath, "utf8"));

    if (fs.existsSync(global.disjsScannedCombinationsFilePath)) {
        scannedCombinationsDb = JSON.parse(fs.readFileSync(global.disjsScannedCombinationsFilePath, "utf8"));
    }

    if (fs.existsSync(global.disjsIgnoredCombinationsFilePath)) {
        ignoredCombinationsDb = JSON.parse(fs.readFileSync(global.disjsIgnoredCombinationsFilePath, "utf8"));
    }

    console.log('Database loaded');
}

console.log(`Searching for images in ${directoryToScan}`);

const images = helpers.scanDirectoryForImages(directoryToScan);

console.log(`Found ${images.length} image(s)`);
console.log("Syncing database...");

syncFilesDb(images);

console.log("Database synced");


console.log('Generating thumbnails...');

generateThumbnails(filesDb)
    .then(() => {
        console.log('Scanning for duplicates... (It might stall for the first couple seconds because of image preloading)');

        scanImagesForDuplicates(filesDb)
            .then((result) => {
                const filteredResults = result.results.filter((resultItem) => resultItem.misMatchPercentage < 20);

                syncScannedCombinationsDb(result.results);

                if (filteredResults.length === 0) {
                    console.log(`Scanning took ${result.timeTook}ms`);
                    console.log("No duplicates found ;)");

                    return process.exit();
                }

                const resultsTextFilePath = path.join(global.disjsFolderPath, "/result.txt");
                let resultsAsText         = `Scanning took ${result.timeTook}ms\nThe following ${filteredResults.length} file(s) might be duplicates:\n`;
                filteredResults.forEach((resultItem) => {
                    resultsAsText += `\n-\n   File #1: ${resultItem.combination[0].originalPath}\n   File #2: ${resultItem.combination[1].originalPath}\n   Mismatch: ${resultItem.misMatchPercentage}%`;
                });

                fs.writeFileSync(resultsTextFilePath, resultsAsText);
                console.log(`${resultsAsText}\n\nYou can also find the results in ${resultsTextFilePath}`);

                process.exit();
            });
    });

async function generateThumbnails(images) {
    if (! fs.existsSync(global.disjsThumbnailPath)) {
        fs.mkdirSync(global.disjsThumbnailPath)
    }

    const chunks          = helpers.chunkGenerator(images, Math.ceil(images.length / threads));
    let childrenStillBusy = chunks.length;

    return new Promise((resolve) => {
        chunks.forEach((chunk) => {
            const child = fork(`${__dirname}/thumbnail-generator-child.js`);

            child.send({ type: 'begin', images: chunk, destinationPath: global.disjsThumbnailPath });
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
    return new Promise((resolve) => {
        const imagesMapped = images.map((image) => ({
            uid: image.uid,
            originalPath: image.p,
            pathToUse: path.join(global.disjsThumbnailPath, `${image.uid}.jpg`),
            hash: image.h
        }));

        const imageCombinations = helpers.generateImageCombinations(imagesMapped).map((combination) => {
            const scannedCombinationIndex = scannedCombinationsDb.findIndex((scannedCombination) =>
                (
                    (scannedCombination.c[0] === combination[0].uid && scannedCombination.c[1] === combination[1].uid) ||
                    (scannedCombination.c[0] === combination[1].uid && scannedCombination.c[1] === combination[0].uid)
                )
            );

            return {
                combinations: [combination[0], combination[1]],
                misMatchPercentage: scannedCombinationIndex !== -1 ? scannedCombinationsDb[scannedCombinationIndex].m : null
            }
        });

        const startTimeStamp         = new Date();
        const chunks                 = helpers.chunkGenerator(imageCombinations, Math.ceil(imageCombinations.length / threads));
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

function syncFilesDb(files = []) {
    // Add new items to the database
    files.forEach((file) => {
        if (! filesDb.find((findFile) => findFile.p === file)) {
            filesDb.push({
                uid: uuid.v4(),
                p: file,
                h: SparkMD5.hash(fs.readFileSync(file))
            });
        }
    });
    // todo: add multi-threading support to improve performance of adding new files to database


    // Remove files from database that no longer exist in the folder
    let fileDbIndex = filesDb.length
    while (fileDbIndex--) {
        const fileDb = filesDb[fileDbIndex];

        if (! files.find((findFile) => fileDb.p === findFile)) {
            filesDb.splice(fileDbIndex, 1);
        }
    }

    fs.writeFileSync(global.disjsFilesDatabaseFilePath, JSON.stringify(filesDb));
}

function syncScannedCombinationsDb(combinations = []) {
    combinations.forEach((combinationItem) => {
        const combinationDbIndex = scannedCombinationsDb.findIndex((scannedCombination) =>
            (
                (scannedCombination.c[0] === combinationItem.combination[0].uid && scannedCombination.c[1] === combinationItem.combination[1].uid) ||
                (scannedCombination.c[0] === combinationItem.combination[1].uid && scannedCombination.c[1] === combinationItem.combination[0].uid)
            )
        );

        if (combinationDbIndex === -1) {
            scannedCombinationsDb.push({ c: [combinationItem.combination[0].uid, combinationItem.combination[1].uid], m: combinationItem.misMatchPercentage });
        }
    })

    fs.writeFileSync(global.disjsScannedCombinationsFilePath, JSON.stringify(scannedCombinationsDb));
}
