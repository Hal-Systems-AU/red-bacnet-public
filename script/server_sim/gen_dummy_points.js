'use strict';
require('../_alias.js');

const { pointsGenerator } = require('@root/script/server_sim/data.js')
const fs = require('fs');

// ---------------------------------- constants ----------------------------------


// ---------------------------------- var ----------------------------------


// ---------------------------------- main function ----------------------------------
async function main() {
    const filename = 'bacnet_points.json'
    const points = pointsGenerator(
        // 1, 1, 1, 1, 1, // analog
        // 1, 1, 1, 1, 1, // binary
        // 1, 1, 1, 1, 1, // multistate
        // 1, 1 // proprietary
        40, 20, 20, 20, 20, // analog
        40, 20, 20, 20, 20, // binary
        40, 20, 20, 20, 20, // multistate
        40, 40, // proprietary
    )

    // console.log(points)

    fs.writeFile(filename, JSON.stringify(points), (err) => {
        if (err) {
            console.error(err);
            return;
        }
        console.log(`Array has been exported to ${filename}`);
    });

}

// ---------------------------------- main ----------------------------------
main();