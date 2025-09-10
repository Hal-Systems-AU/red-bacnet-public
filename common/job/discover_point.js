'use strict';
require('./_alias.js');

const EventEmitter = require('events');

const bacnet = require('@root/ext/node-bacstack/dist/index.js')
const baEnum = bacnet.enum;

const { BaseJob } = require('@root/common/job/core.js')
const { bacnetDeviceSchema, bacnetObjectListSchema, bacnetPointSchema } = require('@root/common/schema.js')
const { EVENT_OUTPUT, EVENT_UPDATE_STATUS, EVENT_ERROR } = require('@root/common/core/constant.js')
const { readObjectList, smartReadProperty } = require('@root/common/bacnet.js')
const { bacnetUnitMap } = require('@root/common/bacnet_unit.js')
const { EG_BACNET_DEVICES } = require('@root/common/example')
const { errMsg, getErrMsg } = require('@root/common/func.js')
const { concurrentTasks } = require('@root/common/core/concurrent.js')
const {
    ERR_GENERIC, ERR_SCHEMA_VALIDATION, ERR_INVALID_DATA_TYPE, ERR_IGNORE_DUPLICATED_DEVICE_NAME,
    ERR_READING_POINTS,
} = require('@root/common/core/constant.js')

// ---------------------------------- constants ----------------------------------
const analogObjectTypes = [
    baEnum.ObjectType.ANALOG_INPUT,
    baEnum.ObjectType.ANALOG_OUTPUT,
    baEnum.ObjectType.ANALOG_VALUE,
]
const binaryObjectTypes = [
    baEnum.ObjectType.BINARY_INPUT,
    baEnum.ObjectType.BINARY_OUTPUT,
    baEnum.ObjectType.BINARY_VALUE,
]
const multiStateObjectTypes = [
    baEnum.ObjectType.MULTI_STATE_INPUT,
    baEnum.ObjectType.MULTI_STATE_OUTPUT,
    baEnum.ObjectType.MULTI_STATE_VALUE
]
// const scheduleObjectTypes = [
//     baEnum.ObjectType.SCHEDULE,
// ];
const supportedObjectTypes = [
    ...analogObjectTypes,
    ...binaryObjectTypes,
    ...multiStateObjectTypes,
    // ...scheduleObjectTypes
]

// ---------------------------------- export ----------------------------------
module.exports = {
    DiscoverPointJob: class DiscoverPointJob extends BaseJob {
        devices = [];
        pointsList = [];

        constructor(
            client, eventEmitter, inputDevices, discoverMode, readMethod, groupExportDeviceCount,
            maxConcurrentDeviceRead, maxConcurrentSinglePointRead, name = 'discover point'
        ) {
            super();
            this.client = client
            this.eventEmitter = eventEmitter
            this.inputDevices = inputDevices
            this.discoverMode = discoverMode
            this.readMethod = readMethod
            this.groupExportDeviceCount = groupExportDeviceCount
            this.maxConcurrentDeviceRead = maxConcurrentDeviceRead
            this.maxConcurrentSinglePointRead = maxConcurrentSinglePointRead
            this.name = name
        }

        async execute() {
            this.#updateProgress(0)

            return new Promise((resolve) => {
                try {
                    // validate devices
                    if (!Array.isArray(this.inputDevices)) {
                        this.eventEmitter.emit(EVENT_ERROR, errMsg(
                            this.name, ERR_INVALID_DATA_TYPE,
                            {
                                devices: this?.inputDevices,
                                expected: 'array',
                                example: EG_BACNET_DEVICES
                            })
                        )
                        this.#updateProgress(100)
                        resolve();
                        return
                    }

                    let deviceNameSet = new Set();
                    for (let i = 0; i < this.inputDevices.length; i++) {
                        const device = this.inputDevices[i];
                        const { error, value: result } = bacnetDeviceSchema.validate(
                            device,
                            { stripUnknown: true }
                        );
                        if (error) {
                            this.eventEmitter.emit(EVENT_ERROR, errMsg(
                                this.name, ERR_SCHEMA_VALIDATION, error
                            ))
                            continue
                        }

                        // ensure no duplicate device name
                        if (deviceNameSet.has(result.deviceName)) {
                            this.eventEmitter.emit(EVENT_ERROR, errMsg(
                                this.name, ERR_IGNORE_DUPLICATED_DEVICE_NAME, result
                            ))
                            continue
                        }
                        deviceNameSet.add(result.deviceName);

                        // add device to list
                        this.devices.push(result);
                    }

                    this.#updateProgress(10)

                    // read all device points
                    this.#readAllDevicePoints().then(() => {
                        if (this.pointsList.length > 0)
                            this.#exportPoints();

                        this.#updateProgress(100)
                        resolve();
                    });
                } catch (err) {
                    this.eventEmitter.emit(EVENT_ERROR, errMsg(this.name, ERR_GENERIC, getErrMsg(err)))
                    resolve();
                }
            })
        }

        async #readAllDevicePoints() {
            const discoverPointEvent = new EventEmitter();
            const size = this.devices.length;
            let count = 0;
            let discoveredDevices = 0

            discoverPointEvent.on(EVENT_OUTPUT, (data) => {
                this.#updateProgress(
                    Math.round((85 / size) * (count + 1) + 10)
                )

                if (Array.isArray(data.result))
                    this.pointsList.push(...data.result);

                count++;
                discoveredDevices++;

                if (discoveredDevices >= this.groupExportDeviceCount) {
                    this.#exportPoints();
                    discoveredDevices = 0
                }
            });

            discoverPointEvent.on(EVENT_ERROR, (data) => {
                this.eventEmitter.emit(EVENT_ERROR, data)
            });

            const tasks = this.devices.map((d, i) => ({
                id: d.deviceName,
                task: async () => {
                    void i
                    try {
                        const objectList = await readObjectList(this.client, d);

                        // istanbul ignore next
                        if (objectList == null) return;

                        let objectListFinal = objectList
                            .map(obj => {
                                const { error, value } = bacnetObjectListSchema.validate(obj);
                                if (error) {
                                    /* istanbul ignore next */
                                    {
                                        discoverPointEvent.emit(EVENT_ERROR, errMsg(
                                            this.name, ERR_SCHEMA_VALIDATION, {
                                            bacnetObject: obj,
                                            error: error,
                                        }));
                                        return null;
                                    }
                                }
                                return value;
                            })
                            .filter(obj => {
                                if (this.discoverMode == 0) // basic
                                    return obj && supportedObjectTypes.includes(obj.value.type);

                                // all
                                return obj !== null;
                            });

                        return await readPoints(
                            d, objectListFinal, discoverPointEvent, this.name, this.client, this.readMethod,
                            this.maxConcurrentSinglePointRead
                        );
                    } catch (error) {
                        this.eventEmitter.emit(EVENT_ERROR, errMsg(this.name, `Error reading ${d.deviceName} points`, error));
                    }
                }
            }));

            await concurrentTasks(discoverPointEvent, tasks, this.maxConcurrentDeviceRead);
        }

        #updateProgress(progress) {
            this.eventEmitter.emit(EVENT_UPDATE_STATUS, progress);
        }

        #exportPoints() {
            let exportPointsList = [];
            for (let i = 0; i < this.pointsList.length; i++) {
                const { error, value: result } = bacnetPointSchema.validate(
                    this.pointsList[i], { stripUnknown: true }
                );
                // istanbul ignore next
                {
                    if (error) {
                        this.eventEmitter.emit(EVENT_ERROR, errMsg(
                            this.name, ERR_SCHEMA_VALIDATION, {
                            bacnetPoint: this.pointsList[i],
                            error: error,
                        }));
                        continue
                    }
                }
                exportPointsList.push(result);
            }

            this.eventEmitter.emit(EVENT_OUTPUT, exportPointsList);
            this.pointsList = [];
        }
    }
}

// ---------------------------------- functions ----------------------------------
const readPoints = async (
    device, objects, eventEmitter, name, client, readMethod, maxConcurrentSinglePointRead
) => {
    const points = [];

    // First query - get basic properties (excluding STATE_TEXT)
    const reqArr = objects.map(obj => ({
        objectId: { type: obj.value.type, instance: obj.value.instance },
        properties: [
            { id: baEnum.PropertyIdentifier.PRESENT_VALUE },
            { id: baEnum.PropertyIdentifier.OBJECT_NAME },
            ...(analogObjectTypes.includes(obj.value.type) ? [{ id: baEnum.PropertyIdentifier.UNITS }] : []),
            ...(binaryObjectTypes.includes(obj.value.type) ? [
                { id: baEnum.PropertyIdentifier.INACTIVE_TEXT },
                { id: baEnum.PropertyIdentifier.ACTIVE_TEXT }
            ] : []),
        ]
    }));

    try {
        // First request - get basic properties
        const result = await smartReadProperty(
            client, device, reqArr, readMethod, maxConcurrentSinglePointRead, 50
        );

        // Process basic properties first
        result.forEach(i => {
            const point = processPoint(i, device.deviceName);
            points.push(point);
        });

        // Second query - get STATE_TEXT for multistate objects only
        const multistateObjects = objects.filter(obj => multiStateObjectTypes.includes(obj.value.type));

        if (multistateObjects.length > 0) {
            const stateTextReqArr = multistateObjects.map(obj => ({
                objectId: { type: obj.value.type, instance: obj.value.instance },
                properties: [{ id: baEnum.PropertyIdentifier.STATE_TEXT }]
            }));

            try {
                // Force use single read on state text to reduce loss especially long text
                const stateTextResult = await smartReadProperty(
                    client, device, stateTextReqArr, 0, 1, 50
                );

                // Update points with STATE_TEXT
                stateTextResult.forEach(stateTextData => {
                    const matchingPoint = points.find(point =>
                        point.bacType === stateTextData.objectId.type &&
                        point.bacInstance === stateTextData.objectId.instance
                    );

                    if (matchingPoint) {
                        updatePointWithStateText(matchingPoint, stateTextData);
                    }
                });
            } catch (stateTextError) {
                // Log the error but don't fail the entire operation
                eventEmitter.emit(EVENT_ERROR, errMsg(
                    name,
                    'Warning: Failed to read STATE_TEXT properties',
                    stateTextError
                ));
            }
        }

        return points;
    } catch (error) {
        eventEmitter.emit(EVENT_ERROR, errMsg(name, ERR_READING_POINTS, error));
    }
};

const updatePointWithStateText = (point, stateTextData) => {
    const stateTextProp = stateTextData.values.find(prop => prop.id === baEnum.PropertyIdentifier.STATE_TEXT);
    const states = stateTextProp?.value;

    if (Array.isArray(states)) {
        // Update the facets with state text information
        const stateTextFacet = `range:{${states.map((item, index) => `${index + 1}:${item.value}`).join(';')}}`;

        // If point already has facets, append; otherwise, set new facets
        if (point.facets) {
            point.facets += `;${stateTextFacet}`;
        } else {
            point.facets = stateTextFacet;
        }
    }
};

const processPoint = (i, deviceName) => {
    const point = {
        deviceName,
        pointName: `UnknownObjectName:[${i.objectId.type}:${i.objectId.instance}]`,
        bacType: i.objectId.type,
        bacInstance: i.objectId.instance,
        bacProp: null,
        value: null,
        valueType: null,
        facets: '',
        priority: 0
    };

    setPointFacets(point, i);
    setPointValues(point, i);

    return point;
};

const setPointFacets = (point, i) => {
    if (analogObjectTypes.includes(point.bacType)) {
        const unitRaw = i.values.find(prop => prop.id === baEnum.PropertyIdentifier.UNITS)?.value?.[0]?.value;
        const unit = bacnetUnitMap[unitRaw]
        point.facets = unit ? `unit:${unit};precision:1` : 'precision:1';
    } else if (binaryObjectTypes.includes(point.bacType)) {
        const inactive = i.values.find(prop => prop.id === baEnum.PropertyIdentifier.INACTIVE_TEXT)?.value?.[0]?.value;
        const active = i.values.find(prop => prop.id === baEnum.PropertyIdentifier.ACTIVE_TEXT)?.value?.[0]?.value;
        point.facets = `falseText:${inactive ? inactive : 'false'};trueText:${active ? active : 'true'}`;
    }
    // STATE_TEXT handling removed from here - now handled separately
};

const setPointValues = (point, i) => {
    i.values.forEach(prop => {
        const value = prop?.value?.[0]?.value;
        const valueType = prop?.value?.[0]?.type;
        if (prop.id === baEnum.PropertyIdentifier.PRESENT_VALUE) {
            point.bacProp = prop.id;
            point.value = processValue(value, point.facets);
            point.valueType = valueType
        } else if (prop.id === baEnum.PropertyIdentifier.OBJECT_NAME && value?.errorClass == null && value?.errorCode == null) {
            point.pointName = value;
        }
    });
};

const processValue = (value, facets) => {
    if (value?.errorClass != null && value?.errorCode != null) return null;
    const match = facets.match(/precision:(\d+)/);
    const precision = match ? +match[1] : null;

    if (typeof value === 'number')
        return precision != null ? +value.toFixed(precision) : +value.toFixed(1);
    else
        return value

};