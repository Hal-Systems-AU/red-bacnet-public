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
const { ReadPointJob } = require('@root/common/job/read_point.js');
const { serverConfig } = require('@root/tests/_test_lib/data.js');
const { EG_BACNET_DEVICES, EG_BACNET_POINTS } = require('@root/common/example');
const {
    ERR_SCHEMA_VALIDATION, ERR_INVALID_DATA_TYPE, ERR_DUPLICATED_DEVICE_NAME, ERR_DUPLICATED_POINT_ID,
    ERR_POINT_NOT_ATTACHED_TO_DEVICE, ERR_READING_POINT
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
const deviceSingle = [{
    "deviceName": serverConfig.deviceName,
    "deviceId": serverConfig.deviceId,
    "network": null,
    "ipAddress": "127.0.0.1:47809",
    "macAddress": null,
    "segmentation": serverConfig.segmentation,
    "maxApdu": serverConfig.maxApdu,
    "vendorId": serverConfig.vendorId,
}]

// ---------------------------------- test ----------------------------------
describe(`${ReadPointJob.name} tests`, () => {
    let client = null
    let progress = 0
    let result = null
    let error = null
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
            [`[read point] ${ERR_INVALID_DATA_TYPE}`]: {
                devices: devices,
                expected: 'array',
                example: EG_BACNET_DEVICES
            }
        }

        const readPointJob = new ReadPointJob(client, eventEmitter, devices, bacnetPoints, 1, 1);
        await readPointJob.execute();

        // console.log(error)
        expect(progress).toBe(100);
        expect(error).toStrictEqual(expected);
    });

    it.each([
        [true],
        [123],
        ['hello'],
        [null],
        [undefined],
        [{ 'hello': 'world' }],
    ])('invalid point format', async (points) => {
        error = null;
        const expected = {
            [`[read point] ${ERR_INVALID_DATA_TYPE}`]: {
                points: points,
                expected: 'array',
                example: EG_BACNET_POINTS
            }
        }

        const readPointJob = new ReadPointJob(client, eventEmitter, deviceSingle, points, 1, 1);
        await readPointJob.execute();

        // console.log(error)
        expect(progress).toBe(100);
        expect(error).toStrictEqual(expected);
    });


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
    ])('device schema validation error', async (devices) => {
        error = null;

        const readPointJob = new ReadPointJob(client, eventEmitter, devices, bacnetPoints, 1, 1);
        await readPointJob.execute();

        // console.log(error)
        expect(progress).toBe(100);
        expect(error).not.toBeNull();
        // @ts-expect-error
        expect(error[`[read point] ${ERR_SCHEMA_VALIDATION} (devices)`]).not.toBeUndefined();
    });

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

        const readPointJob = new ReadPointJob(client, eventEmitter, devices, bacnetPoints, 1, 1);
        await readPointJob.execute();

        // console.log(errorAll)
        expect(progress).toBe(100);
        expect(errorAll).not.toBeNull();
        expect(errorAll.find(obj => obj[`[read point] ${ERR_DUPLICATED_DEVICE_NAME}`])).not.toBeUndefined();
    });

    it.each([
        [[{
            "deviceName": "BacServer",
            "pointName": "Analog Input 0",
            // "bacType": 0,
            "bacInstance": 0,
            "bacProp": 85,
            "value": 18.6,
            "valueType": 4,
            "facets": "unit:°C;precision:1",
            "priority": 0
        }]],
        [[{
            "deviceName": "BacServer",
            "pointName": "Analog Input 0",
            "bacType": 0,
            "bacInstance": 0,
            "bacProp": 'happy', // invalid bacProp
            "value": 18.6,
            "valueType": 4,
            "facets": "unit:°C;precision:1",
            "priority": 0
        }]]
    ])('point schema validation error', async (points) => {
        error = null;

        const readPointJob = new ReadPointJob(client, eventEmitter, deviceSingle, points, 1, 1);
        await readPointJob.execute();

        // console.log(error)
        expect(progress).toBe(100);
        expect(error).not.toBeNull();
        // @ts-expect-error
        expect(error[`[read point] ${ERR_SCHEMA_VALIDATION} (points)`]).not.toBeUndefined();
    });

    it.each([
        [[{
            "deviceName": "BacServer",
            "pointName": "Analog Input 0",
            "bacType": 0,
            "bacInstance": 0,
            "bacProp": 85,
            "value": 18.6,
            "valueType": 4,
            "facets": "unit:°C;precision:1",
            "priority": 0
        }, {
            "deviceName": "BacServer",
            "pointName": "Analog Input 0",
            "bacType": 0,
            "bacInstance": 1,
            "bacProp": 85, // invalid bacProp
            "value": 18.1,
            "valueType": 4,
            "facets": "unit:°C;precision:1",
            "priority": 0
        }]]
    ])('point duplicated id', async (points) => {
        error = null;

        const readPointJob = new ReadPointJob(client, eventEmitter, deviceSingle, points, 1, 1);
        await readPointJob.execute();

        // console.log(error)
        expect(progress).toBe(100);
        expect(error).not.toBeNull();
        // @ts-expect-error
        expect(error[`[read point] ${ERR_DUPLICATED_POINT_ID}`]).not.toBeUndefined();
    });

    test('point not attached to device', async () => {
        error = null
        const points = [{
            'deviceName': 'Orphan Device',
            'pointName': 'Analog Input 0',
            'bacType': 0,
            'bacInstance': 0,
            'bacProp': 85,
            'value': 18.6,
            'valueType': 4,
            'facets': 'unit:°C;precision:1',
            'priority': 0
        }]

        const readPointJob = new ReadPointJob(client, eventEmitter, deviceSingle, points, 1, 1);
        await readPointJob.execute();

        // console.log(error)
        expect(progress).toBe(100);
        expect(error).not.toBeNull();
        // @ts-expect-error
        expect(error[`[read point] ${ERR_POINT_NOT_ATTACHED_TO_DEVICE}`]).not.toBeUndefined();
    }, 10000);

    test('read not existant device', async () => {
        progress = null
        result = null
        errorAll = []

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

        const readPointJob = new ReadPointJob(client, eventEmitter, devices, bacnetPoints, 0, 1);
        await readPointJob.execute();

        // console.log(result)
        const errorCount = Object.values(result).reduce((count, item) => {
            return item.err === ERR_READING_POINT ? count + 1 : count;
        }, 0);

        expect(progress).toBe(100);
        expect(errorAll.length).toBe(0);
        expect(errorCount).toBe(bacnetPoints.length);
    }, 5000);

    it.each([
        [0], [1], [2],
    ])('read single device', async (readMethod) => {
        progress = null
        result = null
        errorAll = []

        const readPointJob = new ReadPointJob(client, eventEmitter, deviceSingle, bacnetPoints, readMethod, 1);
        await readPointJob.execute();

        // console.log(result)
        const errorCount = Object.values(result).reduce((count, item) => {
            return item.err === ERR_READING_POINT ? count + 1 : count;
        }, 0);

        const pointAndValue = Object.entries(result).reduce((acc, [key, { value }]) => {
            acc[key] = value;
            return acc;
        }, {});

        const expected = bacnetPoints.reduce((acc, item) => {
            const key = `${item.deviceName}.${item.pointName}`;
            acc[key] = item.value;
            return acc;
        }, {});

        // console.log(pointAndValue)
        // console.log(expected)
        expect(progress).toBe(100);
        expect(errorAll.length).toBe(0);
        expect(errorCount).toBe(0);
        expect(compareObj(pointAndValue, expected, [])).toBe(true);
    }, 10000);

    test('read single device details compare', async () => {
        progress = null
        result = null
        errorAll = []
        const points = [
            {
                deviceName: 'BacServer',
                pointName: 'Analog Input 0',
                bacType: 0,
                bacInstance: 0,
                bacProp: 85,
                value: 18.6,
                valueType: 4,
                facets: 'unit:°C;precision:0',
                priority: 0
            },
            {
                deviceName: 'BacServer',
                pointName: 'Analog Value 1',
                bacType: 2,
                bacInstance: 0,
                bacProp: 85,
                value: -2185.3,
                valueType: 4,
                facets: '',
                priority: 10
            },
            {
                deviceName: 'BacServer',
                pointName: 'Binary Input 0',
                bacType: 3,
                bacInstance: 0,
                bacProp: 85,
                value: 1,
                valueType: 9,
                facets: 'falseText:Off;trueText:On',
                priority: 0
            },
            {
                deviceName: 'BacServer',
                pointName: 'Binary Output 1',
                bacType: 4,
                bacInstance: 1,
                bacProp: 85,
                value: 1,
                valueType: 9,
                facets: '',
                priority: 10
            },
            {
                deviceName: 'BacServer',
                pointName: 'Multi State Input 0',
                bacType: 13,
                bacInstance: 0,
                bacProp: 85,
                value: 2,
                valueType: 2,
                facets: 'range:{1:Auto;2:Off;3:On}',
                priority: 0
            },
            {
                deviceName: 'BacServer',
                pointName: 'Proprietary Output 0',
                bacType: 138,
                bacInstance: 0,
                bacProp: 85,
                value: 29.8,
                valueType: 4,
                facets: '',
                priority: 10
            }
        ]

        const expected = {
            'BacServer.Analog Input 0': { value: 19, fvalue: '19 °C', err: '' },
            'BacServer.Analog Value 1': { value: -2266.1, fvalue: '-2266.1', err: '' },
            'BacServer.Binary Input 0': { value: 1, fvalue: 'On', err: '' },
            'BacServer.Binary Output 1': { value: 1, fvalue: '1', err: '' },
            'BacServer.Multi State Input 0': { value: 2, fvalue: 'Off', err: '' },
            'BacServer.Proprietary Output 0': { value: 29.8, fvalue: '29.8', err: '' }
        }

        const readPointJob = new ReadPointJob(client, eventEmitter, deviceSingle, points, 1, 1);
        await readPointJob.execute();

        // console.log(result)

        const errorCount = Object.values(result).reduce((count, item) => {
            return item.err === ERR_READING_POINT ? count + 1 : count;
        }, 0);

        // console.log(pointAndValue)
        // console.log(expected)
        expect(progress).toBe(100);
        expect(errorAll.length).toBe(0);
        expect(errorCount).toBe(0);
        expect(compareObj(result, expected, [])).toBe(true);
    }, 10000);

    test('read multiple devices', async () => {
        progress = null
        error = null
        result = null

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

        const deviceNames = devices.map(device => device.deviceName);
        const points = bacnetPoints.map((item, index) => ({
            ...item,
            deviceName: deviceNames[index % deviceNames.length]
        }));

        const readPointJob = new ReadPointJob(client, eventEmitter, devices, points, 1, 2);
        await readPointJob.execute();

        const errorCount = Object.values(result).reduce((count, item) => {
            return item.err === ERR_READING_POINT ? count + 1 : count;
        }, 0);

        // console.log(error)
        // console.log(result)
        expect(progress).toBe(100);
        expect(errorAll.length).toBe(0);
        expect(errorCount).toBe(0);
        expect(Object.keys(result).length).toBe(points.length);
    }, 10000);

    // ---------------------------------- events ----------------------------------
    eventEmitter.on(EVENT_OUTPUT, (data) => {
        // console.log(`data: ${JSON.stringify(data)}`)
        result = data
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

