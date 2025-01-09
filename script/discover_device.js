'use strict';
require('./_alias.js');


const fs = require('fs');
const EventEmitter = require('events');
const path = require('path');

const bacnet = require('@root/ext/node-bacstack/dist/index.js')

const { print } = require('@root/common/core/util.js')
const { DiscoverDeviceJob } = require('@root/common/job/discover_device.js')
const {
    EVENT_UPDATE_STATUS, EVENT_ERROR, EVENT_OUTPUT
} = require('@root/common/core/constant.js')

// ---------------------------------- expose ----------------------------------
const network = 65535;
const lowLimit = 0
const highLimit = 4194304
const whoIsTimeout = 2000; // 30000
const readDeviceNameTimeout = 1000 // 10000
const config = {
    apduTimeout: 2000,
    interface: '0.0.0.0',
    port: 47808,
    broadcastAddress: '192.168.68.255',
    // broadcastAddress: '127.0.0.255:47809',
    // broadcastAddress: '10.10.0.255',
    // broadcastAddress: '10.2.110.255',
}

// ---------------------------------- constants ----------------------------------
const eventEmitter = new EventEmitter();
const client = new bacnet.Client({
    apduTimeout: config.apduTimeout,
    interface: config.interface,
    port: config.port,
    broadcastAddress: config.broadcastAddress,
});
const outputFolder = 'output'
const output = path.join(outputFolder, 'devices.json');

// ---------------------------------- main function ----------------------------------
async function main() {
    const discoverDeviceJob = new DiscoverDeviceJob(
        client, eventEmitter, network, lowLimit, highLimit, whoIsTimeout, readDeviceNameTimeout
    );
    await discoverDeviceJob.onStart();
    await discoverDeviceJob.execute();
    await discoverDeviceJob.onStop();

    client.close();
}

// ---------------------------------- events ----------------------------------
eventEmitter.on(EVENT_OUTPUT, (data) => {
    if (!fs.existsSync(outputFolder))
        fs.mkdirSync(outputFolder);

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
    print(`error: ${JSON.stringify(err)}`);
});

// ---------------------------------- main ----------------------------------
main();