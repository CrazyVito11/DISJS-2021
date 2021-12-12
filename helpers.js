const fs   = require("fs");
const path = require("path");

function chunkGenerator(array, chunk_size) {
    return Array(Math.ceil(array.length / chunk_size)).fill().map((_, index) => index * chunk_size).map(begin => array.slice(begin, begin + chunk_size));
}

function generateImageCombinations(images) {
    return images.flatMap(
        (v, i) => images.slice(i+1).map( w => [v, w])
    ).filter((imageCombination) => imageCombination[0].originalPath !== imageCombination[1].originalPath);
}

function scanDirectoryForImages(directory) {
    let images               = [];
    const supportedFiletypes = [
        '.jpeg',
        '.png',
        '.gif',
        '.jpg',
        '.bmp',
    ];

    function searchDirectory(dir) {
        let files = fs.readdirSync(dir);

        for(let file of files) {
            if (file === global.disjsFolderName) continue;
            let stat = fs.lstatSync(path.join(dir, file));
            if (stat.isDirectory()) {
                searchDirectory(path.join(dir, file));
            } else {
                if (supportedFiletypes.includes(path.extname(file).toLowerCase())) {
                    images.push(path.join(dir, file));
                }
            }
        }
    }

    searchDirectory(directory);

    return images;
}

module.exports = {
    chunkGenerator,
    generateImageCombinations,
    scanDirectoryForImages
};