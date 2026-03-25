'use strict';
require('./_alias.js');

const fs = require('fs');
const EventEmitter = require('events');
const path = require('path');

const bacnet = require('@root/ext/node-bacstack/dist/index.js')
const { print } = require('@root/common/core/util.js')
const { DiscoverPointJob } = require('@root/common/job/discover_point.js')
const {
    EVENT_UPDATE_STATUS, EVENT_ERROR, EVENT_OUTPUT
} = require('@root/common/core/constant.js')

// ---------------------------------- expose ----------------------------------
const groupExportDeviceCount = 50
const maxConcurrentDeviceRead = 1
const discoverMode = 0 // 0:basic;1:all
const readMethod = 2 // 0:single read only;1:multi read fallback single;2:2 x multi read fallback single
const maxConcurrentSinglePointRead = 50

// ---------------------------------- constants ----------------------------------
const eventEmitter = new EventEmitter();
const config = {
    apduTimeout: 2000, //2000,
    interface: '0.0.0.0',
    port: 47808,
    broadcastAddress: '192.168.68.255',
    // broadcastAddress: '10.2.110.255',
    // broadcastAddress: '10.10.0.255',
    // broadcastAddress: '127.0.0.255:47809',
}
const client = new bacnet.Client({
    apduTimeout: config.apduTimeout,
    interface: config.interface,
    port: config.port,
    broadcastAddress: config.broadcastAddress
});
const outputFolder = 'output'
const devicesFilePath = path.join(outputFolder, 'devices.json');

// ---------------------------------- var ----------------------------------
let batchCount = 1

// ---------------------------------- main function ----------------------------------
async function main() {
    const start = performance.now();

    // read inputDevices
    const rawData = fs.readFileSync(devicesFilePath, 'utf8');
    const inputDevices = JSON.parse(rawData);

    const discoverPointJob = new DiscoverPointJob(
        client, eventEmitter, inputDevices, discoverMode, readMethod, groupExportDeviceCount,
        maxConcurrentDeviceRead, maxConcurrentSinglePointRead
    );
    await discoverPointJob.execute();

    const end = performance.now();
    const exeTime = calExeTime(start, end);
    print(`completed in ${exeTime}`);

    client.close();
}

// ---------------------------------- events ----------------------------------
eventEmitter.on(EVENT_OUTPUT, (data) => {
    if (!fs.existsSync(outputFolder))
        fs.mkdirSync(outputFolder);

    const output = path.join(outputFolder, `points_${batchCount}.json`);
    fs.writeFile(output, JSON.stringify(data, null, 2), (err) => {
        if (err) {
            console.error('Error writing file:', err);
        } else {
            console.log('JSON data successfully saved to file');
        }
    });
    batchCount++
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