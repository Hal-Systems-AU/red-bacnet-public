'use strict';
require('./_alias.js');

const fs = require('fs');
const EventEmitter = require('events');
const path = require('path');

const bacnet = require('@root/ext/node-bacstack/dist/index.js')

const { print } = require('@root/common/core/util.js')
const { ReadPointJob } = require('@root/common/job/read_point.js')
const {
    EVENT_UPDATE_STATUS, EVENT_ERROR, EVENT_OUTPUT
} = require('@root/common/core/constant.js')

const outputFolder = 'output'

// ---------------------------------- expose ----------------------------------
const devices = JSON.parse(fs.readFileSync(path.join(outputFolder, 'devices.json'), 'utf8'));
const points = JSON.parse(fs.readFileSync(path.join(outputFolder, 'points.json'), 'utf8'));
const readMethod = 1 // 0:single read only;1:multi read fallback single;2:2 x multi read fallback
const maxConcurrentDeviceRead = 3
const maxConcurrentSinglePointRead = 10

// ---------------------------------- constants ----------------------------------
const eventEmitter = new EventEmitter();
const config = {
    apduTimeout: 2000, //6000,
    interface: '0.0.0.0',
    port: 47808,
    // broadcastAddress: '192.168.68.255',
    // broadcastAddress: '10.2.110.255',
    broadcastAddress: '127.0.0.255:47809',
}
const client = new bacnet.Client({
    apduTimeout: config.apduTimeout,
    interface: config.interface,
    port: config.port,
    broadcastAddress: config.broadcastAddress
});

// ---------------------------------- main function ----------------------------------
async function main() {
    const start = performance.now();

    // exe
    const readPointJob = new ReadPointJob(
        client, eventEmitter, devices, points, readMethod, maxConcurrentDeviceRead, maxConcurrentSinglePointRead
    );
    await readPointJob.execute();

    const end = performance.now();
    const exeTime = calExeTime(start, end);
    print(`completed in ${exeTime}`);

    client.close();
}

// ---------------------------------- events ----------------------------------
eventEmitter.on(EVENT_OUTPUT, (data) => {
    const output = path.join(outputFolder, 'read_points.json');
    fs.writeFile(output, JSON.stringify(data, null, 2), (err) => {
        if (err) {
            console.error('Error writing file:', err);
        } else {
            console.log('JSON data successfully saved to file');
        }
    });
});

eventEmitter.on(EVENT_UPDATE_STATUS, (msg) => {
    print(`progress: ${msg} %`);
});

eventEmitter.on(EVENT_ERROR, (err) => {
    print(`error: ${JSON.stringify(err)}`)
});

// ---------------------------------- functions ----------------------------------
function calExeTime(startTime, endTime) {
    const totalSeconds = (endTime - startTime) / 1000;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = (totalSeconds % 60).toFixed(3);
    return `${minutes}m ${seconds}s`;
}

// ---------------------------------- main ----------------------------------
main();