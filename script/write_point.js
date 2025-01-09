'use strict';
require('./_alias.js');

const fs = require('fs');
const EventEmitter = require('events');
const path = require('path');

const bacnet = require('@root/ext/node-bacstack/dist/index.js')

const { print } = require('@root/common/core/util.js')
const { EVENT_UPDATE_STATUS, EVENT_ERROR, EVENT_OUTPUT } = require('@root/common/core/constant.js')
const { WritePointJob } = require('@root/common/job/write_point.js')
const { randNum, randBool } = require('@root/common/core/util.js')
const outputFolder = 'output'

// ---------------------------------- expose ----------------------------------
const devices = JSON.parse(fs.readFileSync(path.join(outputFolder, 'devices.json'), 'utf8'));
const points = JSON.parse(fs.readFileSync(path.join(outputFolder, 'points.json'), 'utf8'));
const maxConcurrentDeviceWrite = 2
const maxConcurrentPointWrite = 1


const writePoints = {
    'MockBmsDevLite_1122.Simulator.Play.Num1': randNum(12, 30),
    'MockBmsDevLite_1122.Simulator.Play.Enum1': randNum(1, 4) | 0,
    'MockBmsDevLite_1122.Simulator.Play.Bool1': randBool(),
    'MockBmsDevLite_1122.Simulator.Play.Bool2': randBool(),
    // 'MockBmsDevLite.Simulator.Play.Num2': randNum(12, 30),
    // 'MockBmsDevLite.Simulator.Play.Enum2': randNum(1, 4) | 0,
}

// const writePoints = {
//     'BacServer.Analog Input 0': 12.3,
// }

// ---------------------------------- constants ----------------------------------
const eventEmitter = new EventEmitter();
const config = {
    apduTimeout: 6000,
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
    const writePointJob = new WritePointJob(
        client, eventEmitter, devices, points, writePoints,
        maxConcurrentDeviceWrite, maxConcurrentPointWrite
    );
    await writePointJob.execute();

    const end = performance.now();
    const exeTime = calExeTime(start, end);
    print(`completed in ${exeTime}`);

    client.close();
}

// ---------------------------------- events ----------------------------------
eventEmitter.on(EVENT_OUTPUT, (data) => {
    void data
    // no event
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