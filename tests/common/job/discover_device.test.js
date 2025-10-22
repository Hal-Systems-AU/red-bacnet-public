'use strict';

const bacnet = require('@root/ext/node-bacstack/dist/index.js');
const EventEmitter = require('events');

// @ts-expect-error

const { assert, print } = require('@tests/_test_lib/util.js');
const { describe, beforeAll, afterAll, expect, test } = require('@jest/globals');

const { EVENT_UPDATE_STATUS, EVENT_ERROR, EVENT_OUTPUT } = require('@root/common/core/constant.js');
const { DiscoverDeviceJob } = require('@root/common/job/discover_device.js');
const { discoveredDevices } = require('@root/tests/_test_lib/data.js');

// ---------------------------------- expose ----------------------------------
const network = 65535;
const lowLimit = 0
const highLimit = 4194304
const whoIsTimeout = 500;

// ---------------------------------- constants ----------------------------------
const eventEmitter = new EventEmitter();
const config = {
    apduTimeout: 500,
    interface: '0.0.0.0',
    port: 47808,
    broadcastAddress: '127.0.0.255:47809',
}

// ---------------------------------- test ----------------------------------
describe(`${DiscoverDeviceJob.name} tests`, () => {
    let client = null
    let progress = 0
    let result = null

    beforeAll(() => {
        client = new bacnet.Client({
            apduTimeout: config.apduTimeout,
            interface: config.interface,
            port: config.port,
            broadcastAddress: config.broadcastAddress,
        });
    });

    afterAll(() => {
        eventEmitter.removeAllListeners();
        if (client)
            client.close()
    });

    test('discover devices', async () => {
        const discoverDeviceJob = new DiscoverDeviceJob(
            client, eventEmitter, network, lowLimit, highLimit, whoIsTimeout
        );

        await discoverDeviceJob.onStart();
        await discoverDeviceJob.execute();
        await discoverDeviceJob.onStop();

        expect(progress).toBe(100);
        expect(result).toStrictEqual(discoveredDevices);
    }, 10000);

    // ---------------------------------- events ----------------------------------
    eventEmitter.on(EVENT_OUTPUT, (data) => {
        result = data
    });

    eventEmitter.on(EVENT_UPDATE_STATUS, (msg) => {
        progress = msg
    });

    eventEmitter.on(EVENT_ERROR, (err) => {
        print(`error: ${JSON.stringify(err)}`);
    });
});

