const fs          = require('fs');
const path        = require('path');
const cliProgress = require('cli-progress');
const { fork }    = require('child_process');
const SparkMD5    = require('spark-md5');
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

console.log(`Searching for images in ${directoryToScan}`);

(function searchDirectory(dir = directoryToScan){
    let files = fs.readdirSync(dir);
    for (let file of files) {
        let stat = fs.lstatSync(path.join(dir, file));
        if (stat.isDirectory()) {
            searchDirectory(path.join(dir, file));
        } else {
            if (supportedFiletypes.includes(path.extname(file).toLowerCase())) {
                images.push({
                    path: path.join(dir, file),
                    hash: SparkMD5.hash(fs.readFileSync(path.join(dir, file)))
                });
            }
        }
    }
})();

console.log(`Found ${images.length} image(s)`);

let progressCounter     = 0;
let progressTotal       = (images.length) * (images.length);
let children            = [];
let duplicates          = [];
let alreadyCheckedFiles = [];
const startTimeStamp    = new Date();
const progress          = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);


console.log(`Starting scan using ${threads} thread(s)`);
progress.start(progressTotal);

for (let threadIndex = 0; threadIndex < threads; threadIndex++) {
    const child       = fork(`${__dirname}/scanner-child.js`);
    const chunkSize   = Math.ceil(images.length / threads);
    const offset      = Math.floor(threadIndex * chunkSize);
    const chunkImages = images.slice(offset, offset + chunkSize);

    children[threadIndex] = child;

    if (! chunkImages.length) {
        child.kill();

        continue;
    }

    child.send({ type: 'begin', allImages: images, imagesToCheck: chunkImages });
    child.on("message",(data) => {
        if (data.type === 'progress') {
            progressCounter += 1;
            progress.update(progressCounter);
        } else if (data.type === 'checkedfile') {
            alreadyCheckedFiles.push(data.files);
        } else if (data.type === 'duplicate') {
            duplicates.push({ files: data.files, misMatchPercentage: data.misMatchPercentage });
        } else if (data.type === 'finished') {
            child.kill();
        }
    });
}

const waitForCompletion = setInterval(() => {
    const hasActiveChild = children.find((child) => {
        return ! child.killed;
    }) !== undefined;

    if (! hasActiveChild) {
        clearInterval(waitForCompletion);
        progress.stop();

        console.log(`Duplicates:\n${JSON.stringify(duplicates)}`);

        var timeTook = (new Date().getTime() - startTimeStamp.getTime());
        console.log(`Scan took ${timeTook}ms`);
    } else {
        children.forEach((child, index) => {
            if (child.connected) {
                try {
                    child.send({ type: `alreadychecked`, alreadyCheckedFiles: alreadyCheckedFiles })
                } catch(e) {
                    console.error(`Unable to send checked list to child #${index}`);
                }
            }
        })
    }
}, 500);
