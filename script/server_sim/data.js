'use strict';

const { randNum, randBool, randInt } = require('@root/common/core/util.js');

// simple helper for random string
const randStr = (len = 8) => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
};

const serverConfig = {
    deviceName: 'BacServer',
    deviceDescription: 'HAL test BACnet server',
    deviceId: 888,
    vendorId: 7,
    port: 47809,
    broadcastAddress: '127.0.0.255:47808',
    maxApdu: 1482,
    segmentation: 0,
};

const discoveredDevices = [
    {
        deviceId: serverConfig.deviceId,
        network: null,
        ipAddress: `127.0.0.1:${serverConfig.port}`,
        macAddress: null,
        segmentation: serverConfig.segmentation,
        maxApdu: serverConfig.maxApdu,
        vendorId: serverConfig.vendorId,
        deviceName: serverConfig.deviceName
    }
];

const pointsGenerator = (
    // analog
    AI = 100,
    AO = 50,
    AO_write = 50,
    AV = 50,
    AV_write = 50,
    // binary
    BI = 100,
    BO = 50,
    BO_write = 50,
    BV = 50,
    BV_write = 50,
    // multistate
    MSI = 20,
    MSO = 10,
    MSO_write = 10,
    MSV = 10,
    MSV_write = 10,
    // proprietary
    proprietary = 50,
    proprietary_write = 50,
) => {
    const points = [];
    let bacType;

    // ------------------------- analog -------------------------
    // AI
    bacType = 0;
    for (let i = 0; i < AI; i++) {
        points.push({
            deviceName: serverConfig.deviceName,
            pointName: `Analog Input ${i}`,
            bacType,
            bacInstance: i,
            bacProp: 85,
            value: randNum(-100, 100, 1),
            valueType: 4,
            facets: 'unit:°C;precision:1',
            priority: 0
        });
    }

    // AO
    bacType = 1;
    for (let i = 0; i < AO; i++) {
        points.push({
            deviceName: serverConfig.deviceName,
            pointName: `Analog Output ${i}`,
            bacType,
            bacInstance: i,
            bacProp: 85,
            value: randNum(-100, 100, 1),
            valueType: 4,
            facets: 'unit:L/s;precision:1',
            priority: 0
        });
    }
    for (let i = AO; i < AO + AO_write; i++) {
        points.push({
            deviceName: serverConfig.deviceName,
            pointName: `Analog Output ${i}`,
            bacType,
            bacInstance: i,
            bacProp: 85,
            value: randNum(-100, 100, 1),
            valueType: 4,
            facets: 'unit:L/s;precision:1',
            priority: 10
        });
    }

    // AV
    bacType = 2;
    for (let i = 0; i < AV; i++) {
        points.push({
            deviceName: serverConfig.deviceName,
            pointName: `Analog Value ${i}`,
            bacType,
            bacInstance: i,
            bacProp: 85,
            value: randNum(-100, 100, 1),
            valueType: 4,
            facets: 'precision:1',
            priority: 0
        });
    }
    for (let i = AV; i < AV + AV_write; i++) {
        points.push({
            deviceName: serverConfig.deviceName,
            pointName: `Analog Value ${i}`,
            bacType,
            bacInstance: i,
            bacProp: 85,
            value: randNum(-100, 100, 1),
            valueType: 4,
            facets: 'precision:1',
            priority: 10
        });
    }

    // ------------------------- binary -------------------------
    // BI
    bacType = 3;
    for (let i = 0; i < BI; i++) {
        points.push({
            deviceName: serverConfig.deviceName,
            pointName: `Binary Input ${i}`,
            bacType,
            bacInstance: i,
            bacProp: 85,
            value: randBool(),
            valueType: 9,
            facets: 'falseText:Off;trueText:On',
            priority: 0
        });
    }

    // BO
    bacType = 4;
    for (let i = 0; i < BO; i++) {
        points.push({
            deviceName: serverConfig.deviceName,
            pointName: `Binary Output ${i}`,
            bacType,
            bacInstance: i,
            bacProp: 85,
            value: randBool(),
            valueType: 9,
            facets: 'falseText:Disabled;trueText:Enabled',
            priority: 0
        });
    }
    for (let i = BO; i < BO + BO_write; i++) {
        points.push({
            deviceName: serverConfig.deviceName,
            pointName: `Binary Output ${i}`,
            bacType,
            bacInstance: i,
            bacProp: 85,
            value: randBool(),
            valueType: 9,
            facets: 'falseText:Disabled;trueText:Enabled',
            priority: 10
        });
    }

    // BV
    bacType = 5;
    for (let i = 0; i < BV; i++) {
        points.push({
            deviceName: serverConfig.deviceName,
            pointName: `Binary Value ${i}`,
            bacType,
            bacInstance: i,
            bacProp: 85,
            value: randBool(),
            valueType: 9,
            facets: '',
            priority: 0
        });
    }
    for (let i = BV; i < BV + BV_write; i++) {
        points.push({
            deviceName: serverConfig.deviceName,
            pointName: `Binary Value ${i}`,
            bacType,
            bacInstance: i,
            bacProp: 85,
            value: randBool(),
            valueType: 9,
            facets: '',
            priority: 10
        });
    }

    // ------------------------- multistate -------------------------
    // MSI
    bacType = 13;
    for (let i = 0; i < MSI; i++) {
        points.push({
            deviceName: serverConfig.deviceName,
            pointName: `Multi State Input ${i}`,
            bacType,
            bacInstance: i,
            bacProp: 85,
            value: randInt(1, 3),
            valueType: 2,
            facets: 'range:{1:Auto;2:Off;3:On}',
            priority: 0
        });
    }

    // MSO
    bacType = 14;
    for (let i = 0; i < MSO; i++) {
        points.push({
            deviceName: serverConfig.deviceName,
            pointName: `Multi State Output ${i}`,
            bacType,
            bacInstance: i,
            bacProp: 85,
            value: randInt(1, 3),
            valueType: 2,
            facets: 'range:{1:Auto;2:Off;3:On}',
            priority: 0
        });
    }
    for (let i = MSO; i < MSO + MSO_write; i++) {
        points.push({
            deviceName: serverConfig.deviceName,
            pointName: `Multi State Output ${i}`,
            bacType,
            bacInstance: i,
            bacProp: 85,
            value: randInt(1, 3),
            valueType: 2,
            facets: 'range:{1:Auto;2:Off;3:On}',
            priority: 10
        });
    }

    // MSV
    bacType = 19;
    for (let i = 0; i < MSV; i++) {
        points.push({
            deviceName: serverConfig.deviceName,
            pointName: `Multi State Value ${i}`,
            bacType,
            bacInstance: i,
            bacProp: 85,
            value: randInt(1, 3),
            valueType: 2,
            facets: 'range:{1:Auto;2:Off;3:On}',
            priority: 0
        });
    }
    for (let i = MSV; i < MSV + MSV_write; i++) {
        points.push({
            deviceName: serverConfig.deviceName,
            pointName: `Multi State Value ${i}`,
            bacType,
            bacInstance: i,
            bacProp: 85,
            value: randInt(1, 3),
            valueType: 2,
            facets: 'range:{1:Auto;2:Off;3:On}',
            priority: 10
        });
    }

    // ------------------------- proprietary -------------------------
    // proprietary
    bacType = 130;
    for (let i = 0; i < proprietary; i++) {
        points.push({
            deviceName: serverConfig.deviceName,
            pointName: `Proprietary Input ${i}`,
            bacType,
            bacInstance: i,
            bacProp: 85,
            value: randStr(randInt(5, 12)),
            valueType: 7,
            priority: 0
        });
    }

    // proprietary write
    bacType = 138;
    for (let i = 0; i < proprietary_write; i++) {
        points.push({
            deviceName: serverConfig.deviceName,
            pointName: `Proprietary Output ${i}`,
            bacType,
            bacInstance: i,
            bacProp: 85,
            value: randNum(-100, 100, 1),
            valueType: 4,
            priority: 10
        });
    }

    return points;
};

module.exports = {
    serverConfig,
    discoveredDevices,
    pointsGenerator
};
