const fs = require('fs');
const path = require('path');
const moduleAlias = require('module-alias');

/**
 * Recursively loops up the directory structure until the specified root file is found.
 *
 * @param {string} startPath - The starting directory path.
 * @param {string} [rootFileName='ROOT'] - The name of the root file to search for.
 * @returns {string|null} The directory path containing the root file if found, otherwise null.
 */
function findRootDir(startPath, rootFileName = 'ROOT') {
    let currentPath = startPath;

    while (currentPath !== path.parse(currentPath).root) {
        const potentialRootFile = path.join(currentPath, rootFileName);

        if (fs.existsSync(potentialRootFile)) {
            return currentPath; // Return the directory path if the root file is found
        }

        // Move up one directory
        currentPath = path.dirname(currentPath);
    }

    return null; // Return null if the root file is not found
}

const rootDir = findRootDir(__dirname); // eslint-disable-line
if (rootDir != null)
    moduleAlias.addAlias('@root', rootDir)