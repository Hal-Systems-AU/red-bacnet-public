'use strict';

const bacnet = require('@root/ext/node-bacstack/dist/index.js');
const EventEmitter = require('events');

const fs = require('fs');
const path = require('path');

// @ts-expect-error
// eslint-disable-next-line
const { assert, print } = require('@tests/_test_lib/util.js');
const { describe, beforeAll, afterAll, expect, it, test } = require('@jest/globals');

const { EVENT_UPDATE_STATUS, EVENT_ERROR, EVENT_OUTPUT } = require('@root/common/core/constant.js');
const { ReadPointJob } = require('@root/common/job/read_point.js');
const { WritePointJob } = require('@root/common/job/write_point.js');
const { serverConfig } = require('@root/tests/_test_lib/data.js');
const { EG_BACNET_DEVICES, EG_BACNET_POINTS, EG_BACNET_WRITE_POINTS } = require('@root/common/example');
const {
    ERR_SCHEMA_VALIDATION, ERR_INVALID_DATA_TYPE, ERR_DUPLICATED_DEVICE_NAME, ERR_DUPLICATED_POINT_ID,
    ERR_POINT_NOT_ATTACHED_TO_DEVICE, ERR_WRITE_POINT_INVALID_PRIORITY, ERR_WRITING_POINT
} = require('@root/common/core/constant.js');
const { ERR_WRITE_POINT_NOT_FOUND } = require('../../../common/core/constant');
const { randNum } = require('@root/common/core/util.js');

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
const writeValue = 500
const writePointsSimple = {
    [`BacServer.Analog Output ${testSimple ? '1' : '50'}`]: writeValue,
}

// ---------------------------------- test ----------------------------------
describe(`${WritePointJob.name} tests`, () => {
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
            [`[write point] ${ERR_INVALID_DATA_TYPE}`]: {
                devices: devices,
                expected: 'array',
                example: EG_BACNET_DEVICES
            }
        }

        const writePointJob = new WritePointJob(
            client, eventEmitter, devices, bacnetPoints, writePointsSimple, 1, 1
        );
        await writePointJob.execute();

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
            [`[write point] ${ERR_INVALID_DATA_TYPE}`]: {
                points: points,
                expected: 'array',
                example: EG_BACNET_POINTS
            }
        }

        const writePointJob = new WritePointJob(
            client, eventEmitter, deviceSingle, points, writePointsSimple, 1, 1
        );
        await writePointJob.execute();

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
        [[1, 2, 3]],
        [{}],
    ])('invalid write point format', async (writePoints) => {
        error = null;
        const expected = {
            [`[write point] ${ERR_INVALID_DATA_TYPE}`]: {
                writePoints: writePoints,
                expected: 'object',
                example: EG_BACNET_WRITE_POINTS
            }
        }

        const writePointJob = new WritePointJob(
            client, eventEmitter, deviceSingle, bacnetPoints, writePoints, 1, 1
        );
        await writePointJob.execute();

        // console.log(error)
        // console.log(expected)
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

        const writePointJob = new WritePointJob(
            client, eventEmitter, devices, bacnetPoints, writePointsSimple, 1, 1
        );
        await writePointJob.execute();

        // console.log(error)
        expect(progress).toBe(100);
        expect(error).not.toBeNull();
        // @ts-expect-error
        expect(error[`[write point] ${ERR_SCHEMA_VALIDATION} (devices)`]).not.toBeUndefined();
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

        const writePointJob = new WritePointJob(
            client, eventEmitter, devices, bacnetPoints, writePointsSimple, 1, 1
        );
        await writePointJob.execute();

        // console.log(errorAll)
        expect(progress).toBe(100);
        expect(errorAll).not.toBeNull();
        expect(errorAll.find(obj => obj[`[write point] ${ERR_DUPLICATED_DEVICE_NAME}`])).not.toBeUndefined();
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

        const writePointJob = new WritePointJob(
            client, eventEmitter, deviceSingle, points, writePointsSimple, 1, 1
        );
        await writePointJob.execute();

        // console.log(error)
        expect(progress).toBe(100);
        expect(error).not.toBeNull();
        // @ts-expect-error
        expect(error[`[write point] ${ERR_SCHEMA_VALIDATION} (points)`]).not.toBeUndefined();
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

        const writePointJob = new WritePointJob(
            client, eventEmitter, deviceSingle, points, writePointsSimple, 1, 1
        );
        await writePointJob.execute();

        // console.log(error)
        expect(progress).toBe(100);
        expect(error).not.toBeNull();
        // @ts-expect-error
        expect(error[`[write point] ${ERR_DUPLICATED_POINT_ID}`]).not.toBeUndefined();
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

        const writePointJob = new WritePointJob(
            client, eventEmitter, deviceSingle, points, writePointsSimple, 1, 1
        );
        await writePointJob.execute();

        // console.log(error)
        expect(progress).toBe(100);
        expect(error).not.toBeNull();
        // @ts-expect-error
        expect(error[`[write point] ${ERR_POINT_NOT_ATTACHED_TO_DEVICE}`]).not.toBeUndefined();
    }, 10000);

    it.each([
        [{ key: undefined }],
        [{ key: [123, 456] }],
        [{ key: 'hello' }],
        [{ key: { 'hello': 'world' } }],
    ])('write points schema validation error', async (writePoints) => {
        error = null;

        const writePointJob = new WritePointJob(
            client, eventEmitter, deviceSingle, bacnetPoints, writePoints, 1, 1
        );
        await writePointJob.execute();

        expect(progress).toBe(100);
        expect(error).not.toBeNull();
        // @ts-expect-error
        expect(error[`[write point] ${ERR_SCHEMA_VALIDATION} (write points)`]).not.toBeUndefined();
    });

    it.each([
        [{ key: 123 }],
    ])('write points not found in points config', async (writePoints) => {
        error = null;

        const writePointJob = new WritePointJob(
            client, eventEmitter, deviceSingle, bacnetPoints, writePoints, 1, 1
        );
        await writePointJob.execute();

        // console.log(error)
        expect(progress).toBe(100);
        expect(error).not.toBeNull();
        // @ts-expect-error
        expect(error[`[write point] ${ERR_WRITE_POINT_NOT_FOUND}`]).not.toBeUndefined();
    });

    it.each([
        [{ 'BacServer.Analog Input 0': 12 }],
    ])('write points invalid priority', async (writePoints) => {
        error = null;

        const writePointJob = new WritePointJob(
            client, eventEmitter, deviceSingle, bacnetPoints, writePoints, 1, 1
        );
        await writePointJob.execute();

        // console.log(error)
        expect(progress).toBe(100);
        expect(error).not.toBeNull();
        // @ts-expect-error
        expect(error[`[write point] ${ERR_WRITE_POINT_INVALID_PRIORITY}`]).not.toBeUndefined();
    });

    test('write not existant device', async () => {
        progress = null

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

        const writePointJob = new WritePointJob(
            client, eventEmitter, devices, bacnetPoints, writePointsSimple, 1, 1
        );
        await writePointJob.execute();

        // console.log(error)

        expect(progress).toBe(100);
        expect(error[`[write point] ${ERR_WRITING_POINT}`]).not.toBeUndefined();

    }, 5000);

    test('write single device', async () => {
        progress = null
        errorAll = []

        // prepare write points
        const count = (testSimple ? 1 : 50)
        const writePoints = {}
        const writeNameList = [
            'Analog Output', 'Binary Output', 'Multi State Output',
            'Analog Value', 'Binary Value', 'Multi State Value',
        ]
        writeNameList.forEach((name) => {
            for (let i = 0; i < count; i++) {
                writePoints[`BacServer.${name} ${count + i}`] = writeValue
            }
        })
        for (let i = 0; i < count; i++) {
            writePoints[`BacServer.${'Proprietary Output'} ${i}`] = writeValue
        }

        // check before write
        result = null
        const readPointJob = new ReadPointJob(client, eventEmitter, deviceSingle, bacnetPoints, 1, 1);
        await readPointJob.execute();

        const writeCountBefore = Object.values(result).reduce((count, item) => {
            return item.value === writeValue ? count + 1 : count;
        }, 0);
        expect(writeCountBefore).toBe(0);

        // write
        const writePointJob = new WritePointJob(
            client, eventEmitter, deviceSingle, bacnetPoints, writePoints, 1, 50
        );
        await writePointJob.execute();
        // console.log(errorAll)
        expect(progress).toBe(100);
        expect(errorAll.length).toBe(0);

        // check after write
        result = null
        await readPointJob.execute();

        const writeCountAfter = Object.values(result).reduce((count, item) => {
            return item.value === writeValue ? count + 1 : count;
        }, 0);
        expect(writeCountAfter).toBe(Object.keys(writePoints).length);

        // write again to some random value for next test
        Object.entries(writePoints).forEach(([key]) => {
            writePoints[key] = randNum(0, 100, 1)
        })

        writePointJob.writePoints = writePoints
        await writePointJob.execute();

        expect(progress).toBe(100);
        expect(errorAll.length).toBe(0);
    }, 10000);

    test('write multiple devices', async () => {
        progress = null
        errorAll = []

        const deviceNames = ['Device1', 'Device2', 'Device3']
        const deviceTmpl = {
            "deviceName": '',
            "deviceId": serverConfig.deviceId,
            "network": null,
            "ipAddress": "127.0.0.1:47809",
            "macAddress": null,
            "segmentation": serverConfig.segmentation,
            "maxApdu": serverConfig.maxApdu,
            "vendorId": serverConfig.vendorId,
        }
        const devicesMulti = deviceNames.map(name => ({
            ...deviceTmpl,
            deviceName: name
        }));

        let bacnetPointsMulti = []
        deviceNames.forEach((name) => {
            const devicePoints = bacnetPoints.map(item => ({
                ...item,
                deviceName: name
            }));
            bacnetPointsMulti.push(...devicePoints);
        });

        // prepare write points
        const count = (testSimple ? 1 : 50)
        const writePoints = {}
        const writeMap = [
            {
                deviceName: 'Device1',
                writeNameList: [
                    'Analog Output', 'Binary Output', 'Multi State Output',
                ],
                offset: count
            }, {
                deviceName: 'Device2',
                writeNameList: [
                    'Analog Value', 'Binary Value', 'Multi State Value',
                ],
                offset: count
            }, {
                deviceName: 'Device3',
                writeNameList: [
                    'Proprietary Output'
                ],
                offset: 0
            },
        ]

        writeMap.forEach(({ deviceName, writeNameList, offset }) => {
            writeNameList.forEach((name) => {
                for (let i = 0; i < count; i++) {
                    writePoints[`${deviceName}.${name} ${offset + i}`] = writeValue
                }
            })
        })

        // check before write
        result = null
        const readPointJob = new ReadPointJob(client, eventEmitter, devicesMulti, bacnetPointsMulti, 1, 1);
        await readPointJob.execute();

        const writeCountBefore = Object.values(result).reduce((count, item) => {
            return item.value === writeValue ? count + 1 : count;
        }, 0);
        // console.log(result)
        expect(writeCountBefore).toBe(0);

        // write
        const writePointJob = new WritePointJob(
            client, eventEmitter, devicesMulti, bacnetPointsMulti, writePoints, 3, 50
        );
        await writePointJob.execute();
        // console.log(errorAll)
        expect(progress).toBe(100);
        expect(errorAll.length).toBe(0);

        // check after write
        result = null
        await readPointJob.execute();

        const writeCountAfter = Object.values(result).reduce((count, item) => {
            return item.value === writeValue ? count + 1 : count;
        }, 0);
        expect(writeCountAfter).toBe(Object.keys(writePoints).length * 3);

        // write again to some random value for next test
        Object.entries(writePoints).forEach(([key]) => {
            writePoints[key] = randNum(0, 100, 1)
        })

        writePointJob.writePoints = writePoints
        await writePointJob.execute();

        expect(progress).toBe(100);
        expect(errorAll.length).toBe(0);
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

