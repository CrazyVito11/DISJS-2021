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

let sessionData = null;
if (argv.session) {
    console.log('Reading session file...');
    sessionData = JSON.parse(fs.readFileSync(argv.session));
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

// if (! sessionData) {
    console.log(`Searching for images in ${directoryToScan}`);

    (function searchDirectory(dir = directoryToScan) {
        let files = fs.readdirSync(dir);
        for(let file of files) {
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
// }
console.log(`Generating hashes`);



addHashToImagesList(images, threads)
    .then((imagesHashed) => {
        console.log(
            'we hashed those images'
        );
        scanImagesForDuplicates(imagesHashed)
            .then(() => {
                console.log("*dies*");
            })
    })



// const writeToSessionFile = setInterval(async () => {
//     const fileContent = {
//         directoryToScan: directoryToScan,
//         progress: {
//             total: progressTotal,
//             current: progressCounter
//         },
//         currentlyScanning: currentlyScanning,
//         imagesLeftToScan: imagesLeftToScan,
//         duplicates: duplicates,
//         alreadyScannedFiles: alreadyScannedFiles
//     };
//
//     fs.writeFileSync(path.join(__dirname, 'session.json'), JSON.stringify(fileContent));
// }, 10000000)






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
        })
    });
}

async function scanImagesForDuplicates(images) {
    let progressCounter     = sessionData ? sessionData.progress.current : 0;
    let progressTotal       = sessionData ? sessionData.progress.total : images.length;
    let duplicates          = sessionData ? sessionData.duplicates : [];
    let alreadyScannedFiles = sessionData ? sessionData.alreadyScannedFiles : [];
    let currentlyScanning   = sessionData ? sessionData.currentlyScanning : [];
    let imagesLeftToScan    = sessionData ? sessionData.imagesLeftToScan : images;

    let children            = [];
    const startTimeStamp    = new Date();
    const progress          = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);


    console.log(`Starting scan using ${threads} thread(s)`);
    progress.start(progressTotal);
    progress.update(progressCounter);

    for (let threadIndex = 0; threadIndex < threads; threadIndex++) {
        // const child = fork(`${__dirname}/scanner-child.js`, { execArgv:["--prof"] });
        const child = fork(`${__dirname}/scanner-child.js`);

        children[threadIndex] = child;

        child.on("message",(data) => {
            if (data.type === 'result') {
                alreadyScannedFiles.push(data.files);

                if (data.misMatchPercentage < 50) {
                    duplicates.push({ files: data.files, misMatchPercentage: data.misMatchPercentage });
                }
            } else if (data.type === 'finished') {
                progressCounter += 1
                progress.update(progressCounter);

                currentlyScanning.some((currentScan, index) => {
                    if (
                        currentScan.path === data.file.path &&
                        currentScan.hash === data.file.hash
                    ) {
                        currentlyScanning.splice(index, 1);
                    }
                })

                sendNewCompareTaskToChild(child);
            }
        });
        sendNewCompareTaskToChild(child);
    }

    const waitForCompletion = setInterval(() => {
        const hasActiveChild = children.find((child) => {
            return ! child.killed;
        }) !== undefined;

        if (! hasActiveChild) {
            clearInterval(waitForCompletion);
            //clearInterval(writeToSessionFile);
            progress.stop();

            console.log(`Duplicates:\n${JSON.stringify(duplicates)}`);

            let timeTook = (new Date().getTime() - startTimeStamp.getTime());
            console.log(`Scan took ${timeTook}ms`);
        }
    }, 250);

    function sendNewCompareTaskToChild(child) {
        let imageToCheck = imagesLeftToScan[0];

        if (! imageToCheck) {
            console.log(`No more work left, killing thread`);
            child.kill();

            return;
        }

        imagesLeftToScan.splice(0, 1);
        currentlyScanning.push(imageToCheck);

        child.send({
            type: 'checkfile',
            allImages: images,
            alreadyScannedFiles: alreadyScannedFiles,
            imageToCheck: imageToCheck
        });
    }
}
