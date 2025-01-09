'use strict';

const bacnet = require('@root/ext/node-bacstack/dist/index.js');
const EventEmitter = require('events');

const fs = require('fs');
const path = require('path');

// @ts-expect-error
// eslint-disable-next-line
const { assert, print } = require('@tests/_test_lib/util.js');
const { describe, beforeAll, afterAll, expect, it, test } = require('@jest/globals');
const { compareObj } = require('@tests/_test_lib/util.js');

const { EVENT_UPDATE_STATUS, EVENT_ERROR, EVENT_OUTPUT } = require('@root/common/core/constant.js');
const { DiscoverPointJob } = require('@root/common/job/discover_point.js');
const { serverConfig } = require('@root/tests/_test_lib/data.js');
const { EG_BACNET_DEVICES } = require('@root/common/example');
const {
    ERR_SCHEMA_VALIDATION, ERR_INVALID_DATA_TYPE, ERR_IGNORE_DUPLICATED_DEVICE_NAME
} = require('@root/common/core/constant.js');

// ---------------------------------- constants ----------------------------------
const testLibPath = path.join(path.dirname(path.dirname(__dirname)), '_test_lib') // eslint-disable-line
const envPath = path.join(testLibPath, 'env.json')
const testSimple = JSON.parse(fs.readFileSync(envPath, 'utf8')).testSimple
const eventEmitter = new EventEmitter();
const config = {
    apduTimeout: 500,
    interface: '0.0.0.0',
    port: 47808,
    broadcastAddress: '127.0.0.255:47809',
}
const bacnetPointsPath = path.join(testLibPath, testSimple ? 'bacnet_points_simple.json' : 'bacnet_points_full.json')
const bacnetPoints = JSON.parse(fs.readFileSync(bacnetPointsPath, 'utf8'))

// ---------------------------------- test ----------------------------------
describe(`${DiscoverPointJob.name} tests`, () => {
    let client = null
    let progress = 0
    let result = null
    let error = null
    let resultAll = []
    let errorAll = []

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

    it.each([
        [true],
        [123],
        ['hello'],
        [null],
        [undefined],
        [{ 'hello': 'world' }],
    ])('invalid device format', async (devices) => {
        error = null;

        const expected = {
            [`[discover point] ${ERR_INVALID_DATA_TYPE}`]: {
                devices: devices,
                expected: 'array',
                example: EG_BACNET_DEVICES
            }
        }

        const discoverPointJob = new DiscoverPointJob(client, eventEmitter, devices, 0, 1, 50, 1, 1);

        await discoverPointJob.execute();
        // console.log(error)
        expect(progress).toBe(100);
        expect(error).toStrictEqual(expected);


    }, 10000);

    it.each([
        [[{
            "deviceName": serverConfig.deviceName,
            "deviceId": serverConfig.deviceId,
            "network": -1, // invalid network
            "ipAddress": "127.0.0.1",
            "macAddress": null,
            "segmentation": serverConfig.segmentation,
            "maxApdu": serverConfig.maxApdu,
            "vendorId": serverConfig.vendorId,
        }]],
        [[{
            "deviceName": serverConfig.deviceName,
            "deviceId": serverConfig.deviceId,
            "network": 1,
            "ipAddress": "127.0.0.1889", // invalid ip address
            "macAddress": null,
            "segmentation": serverConfig.segmentation,
            "maxApdu": serverConfig.maxApdu,
            "vendorId": serverConfig.vendorId,
        }]]
    ])('schema validation error', async (devices) => {
        error = null;

        const discoverPointJob = new DiscoverPointJob(client, eventEmitter, devices, 0, 1, 50, 1, 1);

        await discoverPointJob.execute();
        // console.log(error)
        expect(progress).toBe(100);
        expect(error).not.toBeNull();
        // @ts-expect-error
        expect(error[`[discover point] ${ERR_SCHEMA_VALIDATION}`]).not.toBeUndefined();
    }, 10000);

    test('duplicate device name', async () => {
        error = null
        errorAll = []

        const devices = [{
            "deviceName": serverConfig.deviceName,
            "deviceId": serverConfig.deviceId,
            "network": 1,
            "ipAddress": "127.0.0.1:47809",
            "macAddress": null,
            "segmentation": serverConfig.segmentation,
            "maxApdu": serverConfig.maxApdu,
            "vendorId": serverConfig.vendorId,
        }, {
            "deviceName": serverConfig.deviceName,
            "deviceId": serverConfig.deviceId,
            "network": 1,
            "ipAddress": "127.0.0.1:47809",
            "macAddress": null,
            "segmentation": serverConfig.segmentation,
            "maxApdu": serverConfig.maxApdu,
            "vendorId": serverConfig.vendorId,
        }]

        const discoverPointJob = new DiscoverPointJob(client, eventEmitter, devices, 0, 1, 50, 1, 1);

        await discoverPointJob.execute();
        // console.log(errorAll)
        expect(progress).toBe(100);
        expect(errorAll.length).toBeGreaterThan(0)
        expect(errorAll.find(obj => obj[`[discover point] ${ERR_IGNORE_DUPLICATED_DEVICE_NAME}`])).not.toBeUndefined();
    }, 10000);

    test('discover not existant device', async () => {
        progress = null
        error = null

        const devices = [{
            "deviceName": serverConfig.deviceName,
            "deviceId": serverConfig.deviceId,
            "network": 1,
            "ipAddress": "192.168.1.133",
            "macAddress": null,
            "segmentation": serverConfig.segmentation,
            "maxApdu": serverConfig.maxApdu,
            "vendorId": serverConfig.vendorId,
        }]

        const discoverPointJob = new DiscoverPointJob(client, eventEmitter, devices, 0, 1, 50, 1, 1);

        await discoverPointJob.execute();

        // console.log(error)
        expect(progress).toBe(100);
        expect(error).not.toBeNull();
        // @ts-expect-error
        expect(error[`[discover point] Error reading ${devices[0].deviceName} points`]).not.toBeUndefined();
    }, 10000);

    test('discover single device basic mode', async () => {
        progress = null
        error = null
        result = null

        const devices = [{
            "deviceName": serverConfig.deviceName,
            "deviceId": serverConfig.deviceId,
            "network": null,
            "ipAddress": "127.0.0.1:47809",
            "macAddress": null,
            "segmentation": serverConfig.segmentation,
            "maxApdu": serverConfig.maxApdu,
            "vendorId": serverConfig.vendorId,
        }]

        const discoverPointJob = new DiscoverPointJob(client, eventEmitter, devices, 0, 1, 50, 1, 1);
        await discoverPointJob.execute();

        // filter out proprietary points
        const filterbacnetPoints = bacnetPoints.filter(item => item.bacType <= 128);
        // console.log(error)
        // console.log(result)
        // console.log(bacnetPoints)
        expect(progress).toBe(100);
        // expect(error).toBeNull();
        expect(compareObj(result, filterbacnetPoints, ['priority'])).toBe(true);
    }, 10000);

    test('discover single device full mode', async () => {
        progress = null
        error = null
        result = null

        const devices = [{
            "deviceName": serverConfig.deviceName,
            "deviceId": serverConfig.deviceId,
            "network": null,
            "ipAddress": "127.0.0.1:47809",
            "macAddress": null,
            "segmentation": serverConfig.segmentation,
            "maxApdu": serverConfig.maxApdu,
            "vendorId": serverConfig.vendorId,
        }]

        const discoverPointJob = new DiscoverPointJob(client, eventEmitter, devices, 1, 1, 50, 1, 1);
        await discoverPointJob.execute();

        // console.log(error)
        // console.log(result)
        // console.log(bacnetPoints)
        expect(progress).toBe(100);
        expect(compareObj(result, bacnetPoints, ['priority'])).toBe(true);
    }, 10000);

    test('discover single device full mode read single', async () => {
        progress = null
        error = null
        result = null

        const devices = [{
            "deviceName": serverConfig.deviceName,
            "deviceId": serverConfig.deviceId,
            "network": null,
            "ipAddress": "127.0.0.1:47809",
            "macAddress": null,
            "segmentation": serverConfig.segmentation,
            "maxApdu": serverConfig.maxApdu,
            "vendorId": serverConfig.vendorId,
        }]

        const discoverPointJob = new DiscoverPointJob(client, eventEmitter, devices, 1, 0, 50, 50);
        await discoverPointJob.execute();

        // console.log(error)
        // console.log(result)
        // console.log(bacnetPoints)
        expect(progress).toBe(100);

        // mode read single will fail if readProperty failure count > threshold
        // some of the properties such as unit intentionally not setup in server to fail this
        // if threshold is raise in future, this test may need to be updated or deleted
        // may fail on full mode but pass on simple mode
        // @ts-expect-error
        expect(result.length).toBeLessThanOrEqual(bacnetPoints.length);
    }, 10000);

    // test with multiple devices (x3)
    test('discover multiple devices', async () => {
        progress = null
        error = null
        result = null
        resultAll = []

        const groupExportDeviceCount = 1
        const maxConcurrentDeviceRead = 2
        const devices = [{
            "deviceName": 'Device1',
            "deviceId": serverConfig.deviceId,
            "network": null,
            "ipAddress": "127.0.0.1:47809",
            "macAddress": null,
            "segmentation": serverConfig.segmentation,
            "maxApdu": serverConfig.maxApdu,
            "vendorId": serverConfig.vendorId,
        }, {
            "deviceName": 'Device2',
            "deviceId": serverConfig.deviceId,
            "network": null,
            "ipAddress": "127.0.0.1:47809",
            "macAddress": null,
            "segmentation": serverConfig.segmentation,
            "maxApdu": serverConfig.maxApdu,
            "vendorId": serverConfig.vendorId,
        }, {
            "deviceName": 'Device3',
            "deviceId": serverConfig.deviceId,
            "network": null,
            "ipAddress": "127.0.0.1:47809",
            "macAddress": null,
            "segmentation": serverConfig.segmentation,
            "maxApdu": serverConfig.maxApdu,
            "vendorId": serverConfig.vendorId,
        }]

        const discoverPointJob = new DiscoverPointJob(
            client, eventEmitter, devices, 1, 1, groupExportDeviceCount, maxConcurrentDeviceRead
        );
        await discoverPointJob.execute();

        const expected = [...bacnetPoints, ...bacnetPoints, ...bacnetPoints]
        // console.log(error)
        // console.log(result)
        // console.log(resultAll)
        // console.log(expected)
        expect(progress).toBe(100);
        expect(compareObj(result, expected, ['priority', 'deviceName'])).toBe(true);
    }, 10000);

    // ---------------------------------- events ----------------------------------
    eventEmitter.on(EVENT_OUTPUT, (data) => {
        // console.log(`data: ${JSON.stringify(data)}`)
        result = data
        resultAll = [...resultAll, ...data]
    });

    eventEmitter.on(EVENT_UPDATE_STATUS, (msg) => {
        // console.log(`msg: ${msg}`)
        progress = msg
    });

    eventEmitter.on(EVENT_ERROR, (err) => {
        // console.log(`err: ${JSON.stringify(err)}`)
        error = err
        errorAll = [...errorAll, err]
    });
});

