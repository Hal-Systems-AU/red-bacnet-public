'use strict'
require('./_alias.js');

const EventEmitter = require('events');

const bacnet = require('@root/ext/node-bacstack/dist/index.js')
const baEnum = bacnet.enum;

const { EVENT_ERROR } = require('@root/common/core/constant.js')
const { concurrentTasks } = require('@root/common/core/concurrent.js')
const { getErrMsg } = require('@root/common/func.js')

// ---------------------------------- type def ----------------------------------
/**
 * @typedef {import('@root/ext/node-bacstack/dist/index.js').Client} BacnetClient
 */

// ---------------------------------- export ----------------------------------
module.exports = {
    /**
     * Reads the object list of a device using optimized batch reading.
     * First tries readPropertyMultiple for faster performance, falls back to sequential reading if failed.
     * @param {BacnetClient} client
     * @param {object} device
     *  eg:{
     *      deviceId: 123,
     *      network: null,
     *      ipAddress: "192.168.1.104",
     *      macAddress: null,
     *      segmentation: 0,
     *      maxApdu: 1476,
     *      vendorId: 36,
     *      deviceName: 'BMS'
     *  }
     * @returns array of objects
     *  eg: [{type: 12, value: {type: 8, instance: 123}, ...],
     * @async
     */
    readObjectList: async function (client, device) {
        const objectId = { type: baEnum.ObjectType.DEVICE, instance: device.deviceId };
        const propertyId = baEnum.PropertyIdentifier.OBJECT_LIST;

        let result = await module.exports.readPropertyMultipleReturnArr(client, device, objectId, propertyId);
        if (result.length == 0) {
            result = await module.exports.readPropertyReturnArr(client, device, objectId, propertyId);
        }

        return result;
    },

    /**
     * Reads a property that returns an array using readPropertyMultiple for better performance.
     * Attempts to read the property in batches to minimize round trips.
     * @param {BacnetClient} client
     * @param {object} device
     * @param {object} objectId
     * @param {number} propertyId
     * @returns array of objects
     * @async
     */
    readPropertyMultipleReturnArr: async function (client, device, objectId, propertyId) {
        let addressSet = device.ipAddress;
        if (device.macAddress != null && device.network != null) {
            addressSet = {
                ip: device.ipAddress,
                adr: device.macAddress,
                net: device.network
            };
        }

        const result = [];
        let healthy = true;

        // helper for single batch request
        async function readBatch(arrayIndex) {
            const reqArr = [{
                objectId: objectId,
                properties: [{
                    id: propertyId,
                    index: arrayIndex != null ? arrayIndex : baEnum.ASN1_ARRAY_ALL
                }]
            }];

            return new Promise((resolve, reject) => {
                client.readPropertyMultiple(
                    addressSet,
                    reqArr,
                    { maxApdu: device.maxApdu },
                    (err, value) => {
                        if (err) return reject(err);
                        resolve(value);
                    }
                );
            });
        }

        // try reading all at once first
        try {
            const value = await readBatch(baEnum.ASN1_ARRAY_ALL);
            if (value?.values?.[0]?.values?.[0]?.value) {
                return value.values[0].values[0].value;
            }
        } catch (err) {
            void err
            healthy = false;
        }

        // try using index read
        if (!healthy) {
            for (let i = 0; ; i++) {
                try {
                    const res = await readBatch(i);
                    const item = res?.values?.[0]?.values?.[0]?.value?.[0];

                    if (item?.type === 105) break

                    result.push(item);
                    console.log(item)
                } catch (err) {
                    void err
                    break;
                }
            }
        }

        return result;
    },

    /**
     * Smart read multiple properties from a BACnet device with concurrent read feature and various read methods
     * readMethod
     * 0: use readProperty only
     * 1: try readPropertyMultiple with consevative query size, fallback to readProperty if failed
     * 2: try readPropertyMultiple twice with high and conservative query size, fallback to readProperty if failed
     * @param {BacnetClient} client
     * @param {object} device
     *  eg:{
     *      deviceId: 123,
     *      network: null,
     *      ipAddress: "192.168.1.104",
     *      macAddress: null,
     *      segmentation: 0,
     *      maxApdu: 1476,
     *      vendorId: 36,
     *      deviceName: 'BMS'
     *  }
     * @param {array} reqArr
     *  eg:[{
     *      objectId: { type: 2, instance: 1 },
     *      properties: [ { id: 1 }, ... ]
     *  },
     *  ...]
     * @param {number} readMethod
     *  0:single read only; 1:multi read fallback single; 2:2 x multi read fallback
     * @param {number} maxConcurrentSinglePointRead
     *  maximum concurrent point to read in single read mode
     * @param {number} singleReadFailedRetry
     *  retry times for single read failed
     * @returns array of objects
     *  eg: [{type: 12, value: {type: 8, instance: 123}, ...],
     * @async
     */
    smartReadProperty: async function (
        client, device, reqArr, readMethod = 1, maxConcurrentSinglePointRead = 5,
        singleReadFailedRetry = 5
    ) {
        /* reqArr example
        [{
            objectId: { type: 2, instance: 1 },
            properties: [ { id: 1 }, ... ]
        },
        ...]
        */
        let batchSizes = new Set();
        let reqArrIndexNext = 0
        let reqArrIndex = 0
        let result = [];
        let success = false

        if (readMethod > 0) {
            // calculate batch sizes
            if (device.maxApdu == null) // default batch size if null or undefined
                batchSizes.add(20);
            else {
                const perValueBytes = [30] // typical numeric point is 17 byte
                for (let x = 0; x < perValueBytes.length; x++)
                    batchSizes.add(Math.trunc(device.maxApdu / perValueBytes[x]))
            }

            // if readMethod === 1
            if (readMethod === 1 && batchSizes.size > 1)
                batchSizes = new Set([...batchSizes].slice(-1));
        }

        for (const batchSize of batchSizes) {
            let healthy = true
            let first = true
            let reqArrBatch
            let batchCount
            let currBatchSize = batchSize

            do { // use current batch size until query failed
                // get ready for next batch
                reqArrBatch = []
                batchCount = 0

                // ensure reqArrBatch at least have one item to query
                if (first && reqArrIndexNext < reqArr.length) {
                    reqArrBatch.push(reqArr[reqArrIndexNext])
                    batchCount += reqArr[reqArrIndexNext].properties.length
                    reqArrIndexNext++
                    first = false
                }

                // add subsequent items until next properties count is > batch size
                const batchFull = false
                do {
                    if (reqArrIndexNext >= reqArr.length)
                        break

                    if (batchCount + reqArr[reqArrIndexNext].properties.length > currBatchSize)
                        break

                    reqArrBatch.push(reqArr[reqArrIndexNext])
                    batchCount += reqArr[reqArrIndexNext].properties.length
                    reqArrIndexNext++
                } while (!batchFull)

                // read batch block
                const value = await module.exports.readPropertyMultple(client, device, reqArrBatch)
                    .catch(() => {
                        // Reduce batch size by half (minimum 1)
                        currBatchSize = Math.max(1, Math.floor(currBatchSize / 2))

                        // If batch size is too small, mark as unhealthy
                        if (currBatchSize <= 1) {
                            healthy = false
                        }

                        reqArrIndexNext = reqArrIndex
                        healthy = false
                    })

                if (!healthy)
                    break

                if (value == null)
                    continue

                result.push(...value.values);
                reqArrIndex = reqArrIndexNext

                // read completed
                if (reqArrIndexNext >= reqArr.length) {
                    success = true
                    break
                }
            } while (healthy)

            // read completed, otherwise try other batch size
            if (success)
                break
        }

        // fallback to readProperty if read property multiple failed / readMethod === 0
        if (!success) {
            let failedCount = 0
            let result_single = []

            const dummyEventEmitter = new EventEmitter();
            const tasks = reqArr.slice(reqArrIndexNext).flatMap((req, x) =>
                req.properties.map((prop, y) => ({
                    id: `${x}-${y}`,
                    task: async () => {
                        try {
                            let value = await module.exports.readProperty(client, device, req.objectId, prop.id);

                            if (value == null) {
                                value = {
                                    objectId: req.objectId,
                                    property: { id: prop.id, index: 4294967295 },
                                    values: {
                                        errorClass: baEnum.ErrorClass.OBJECT,
                                        errorCode: baEnum.ErrorCode.UNKNOWN_OBJECT
                                    }
                                };
                            }

                            result_single.push(value);
                            return value;
                        } catch (err) {
                            failedCount++;
                            if (readMethod < 2 && failedCount >= singleReadFailedRetry)
                                throw err
                        }
                    }
                }))
            );

            try {
                await concurrentTasks(dummyEventEmitter, tasks, maxConcurrentSinglePointRead);
            } catch (err) {
                void err
            }

            // convert result single to result compatible format
            let transform = {}
            for (let x = 0; x < result_single.length; x++) {
                const key = `type${result_single[x].objectId.type}inst${result_single[x].objectId.instance}`

                if (key in transform) {
                    transform[key].values.push({
                        id: result_single[x].property.id,
                        index: result_single[x].property.index,
                        value: result_single[x].values
                    });
                } else {
                    transform[key] = {
                        objectId: {
                            type: result_single[x].objectId.type,
                            instance: result_single[x].objectId.instance
                        },
                        values: [{
                            id: result_single[x].property.id,
                            index: result_single[x].property.index,
                            value: result_single[x].values
                        }]
                    }
                }
            }
            result.push(...Object.values(transform))
        }

        return result
    },

    /**
     * Smart write multiple properties to a BACnet device with concurrent write feature
     * @param {BacnetClient} client
     * @param {object} device
     *  eg:{ deviceId: 123, network: null, ipAddress: "192.168.1.104", macAddress: null,
     *      segmentation: 0, maxApdu: 1476, vendorId: 36, deviceName: 'BMS'}
     * @param {array} writePoints
     *  eg:{'BacServer.VavMode': {
     *    id: 'BacServer.VavMode', deviceName: 'BacServer', bacType: 19, bacInstance: 1,
     *          bacProp: 85, priority: 10, value: 1, valueType: 2}...}
     * @param {EventEmitter} eventEmitter
     * @param {number} maxConcurrentWrite
     *  maximum concurrent point to write
     * @async
     */
    smartWriteProperty: async function (client, device, writePoints, eventEmitter, maxConcurrentWrite) {
        const entries = Object.entries(writePoints);

        // current writePropertyMultiple will throw ERR_TIMEOUT if any of the write fails
        // makes it hard to pinpoint which write failed
        // therefore writeProperty is used instead for better error handling
        // may need to extend to support writePropertyMultiple in future?
        const tasks = entries
            .map(([id, point]) => ({
                id: id,
                task: async () => {
                    try {
                        await module.exports.writeProperty(
                            client, device,
                            { type: point.bacType, instance: point.bacInstance },
                            point.bacProp,
                            [{ type: point.valueType, value: point.value }],
                            point.priority
                        );
                    } catch (err) {
                        eventEmitter.emit(EVENT_ERROR, { id: id, error: getErrMsg(err) });
                    }
                    return
                }
            }));

        await concurrentTasks(eventEmitter, tasks, maxConcurrentWrite);

        // write properties multiples example
        // const values = [
        //     {
        //         objectId: { type: 2, instance: 101 },
        //         values: [{
        //             property: { id: baEnum.PropertyIdentifier.PRESENT_VALUE, index: bacnet.enum.ASN1_ARRAY_ALL },
        //             value: [{ type: bacnet.enum.ApplicationTags.REAL, value: randomVal(12, 30) }],
        //             priority: 9
        //         }]
        //     },
        // ];
        // await client.writePropertyMultiple(address, values, (err) => {
        //     if (err) {
        //         console.log('error: ', err);
        //     } else {
        //         console.log('written');
        //     }
        //     // close client
        //     client.close();
        // });
    },

    /**
     * Reads a single property from a BACnet device.
     * @param {BacnetClient} client
     * @param {object} device
     *  eg:{ deviceId: 123, network: null, ipAddress: "192.168.1.104", macAddress: null,
     *      segmentation: 0, maxApdu: 1476, vendorId: 36, deviceName: 'BMS'}
     * @param {object} objectId
     *  eg:{ type: 2, instance: 1 }
     * @param {number} propertyId
     *  eg: 85
     * @returns object
     *  eg: { len: 11, objectId: { type: 19, instance: 1 },
     *      property: { id: 85, index: 4294967295 }, values: [ { type: 2, value: 3 }]}
     * @async
     */
    readProperty: async function (client, device, objectId, propertyId) {
        let addressSet = device.ipAddress
        if (device.macAddress != null && device.network != null) {
            addressSet = {
                ip: device.ipAddress,
                adr: device.macAddress,
                net: device.network
            };
        }

        return new Promise((resolve, reject) => {
            client.readProperty(
                addressSet,
                objectId,
                propertyId,
                { maxApdu: device.maxApdu },
                (err, value) => {
                    if (err)
                        reject(err);
                    else
                        resolve(value);
                });
        });
    },

    /**
     * Reads a single property from a BACnet device. BACnet device returns an array of objects.
     * @param {BacnetClient} client
     * @param {object} device
     *  eg:{ deviceId: 123, network: null, ipAddress: "192.168.1.104", macAddress: null,
     *      segmentation: 0, maxApdu: 1476, vendorId: 36, deviceName: 'BMS'}
     * @param {object} objectId
     *  eg:{ type: 2, instance: 1 }
     * @param {number} propertyId
     *  eg: 85
     * @returns array of objects
     *  eg: [{type: 12, value: {type: 8, instance: 123}, ...],
     * @async
     */
    readPropertyReturnArr: async function (client, device, objectId, propertyId) {
        const result = [];

        let addressSet = device.ipAddress
        if (device.macAddress != null && device.network != null) {
            addressSet = {
                ip: device.ipAddress,
                adr: device.macAddress,
                net: device.network
            };
        }

        async function readPropertyPart(index) {
            return new Promise((resolve, reject) => {
                client.readProperty(addressSet,
                    objectId,
                    propertyId,
                    { maxApdu: device.maxApdu, arrayIndex: index },
                    (err, value) => {
                        if (err) {
                            if (index === 1)
                                reject(err);
                            else // If it fails after reading some parts, resolve with what we have
                                resolve(result);
                        } else {
                            if (value.values[0].type === baEnum.ApplicationTags.NULL)
                                resolve(result);
                            else {
                                result.push(...value.values);
                                // Read the next part
                                readPropertyPart(index + 1).then(resolve).catch(reject);
                            }
                        }
                    });
            });
        }

        return await readPropertyPart(1);
    },

    /**
     * Reads multiple properties of an object in a device. BACnet device returns an array of objects.
     * @param {BacnetClient} client
     * @param {object} device
     *  eg:{ deviceId: 123, network: null, ipAddress: "192.168.1.104", macAddress: null,
     *      segmentation: 0, maxApdu: 1476, vendorId: 36, deviceName: 'BMS'}
     * @param {array} reqArr
     *  eg:[{
     *      objectId: { type: 2, instance: 1 },
     *      properties: [ { id: 85 }, ... ]
     *  },
     *  ...]
     * @returns object
     *  eg: {"len":1937,"values":[{
     *      "objectId":{"type":3,"instance":0},
     *      "values":[{"id":85,"index":4294967295,"value":[{"value":1,"type":9}]}, ...]
     * ...}]}
     * @async
     */
    readPropertyMultple: async function (client, device, reqArr) {
        let addressSet = device.ipAddress
        if (device.macAddress != null && device.network != null) {
            addressSet = {
                ip: device.ipAddress,
                adr: device.macAddress,
                net: device.network
            };
        }

        return new Promise((resolve, reject) => {
            client.readPropertyMultiple(
                addressSet,
                reqArr,
                { maxApdu: device.maxApdu },
                (err, value) => {
                    if (err)
                        reject(err);
                    else
                        resolve(value);
                });
        });
    },

    /**
     * Writes a single property to a BACnet device.
     * @param {BacnetClient} client
     * @param {object} device
     *  eg:{ deviceId: 123, network: null, ipAddress: "192.168.1.104", macAddress: null,
     *      segmentation: 0, maxApdu: 1476, vendorId: 36, deviceName: 'BMS'}
     * @param {object} objectId
     *  eg:{ type: 2, instance: 1 }
     * @param {number} propertyId
     *  eg: 85
     * @param {array} writeValue
     *  eg:[{type: 2, value: 3}]
     * @param {number} priority
     *  eg: 8
     * @returns true / undefined: true if success, else undefined
     * @async
     */
    writeProperty: async function (client, device, objectId, propertyId, writeValue, priority) {
        let addressSet = device.ipAddress
        if (device.macAddress != null && device.network != null) {
            addressSet = {
                ip: device.ipAddress,
                adr: device.macAddress,
                net: device.network
            };
        }

        return new Promise((resolve, reject) => {
            client.writeProperty(
                addressSet,
                objectId,
                propertyId,
                writeValue,
                { priority: priority },
                (err) => {
                    if (err) {
                        reject(err);
                    }
                    else
                        resolve(true);
                });
        });
    },
}
