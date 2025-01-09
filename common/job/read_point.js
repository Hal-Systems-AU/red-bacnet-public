'use strict';
require('./_alias.js');

const EventEmitter = require('events');

const { BaseJob } = require('@root/common/job/core.js')
const { bacnetDeviceSchema, bacnetPointSchema, readPointSchema } = require('@root/common/schema.js')
const { EVENT_OUTPUT, EVENT_UPDATE_STATUS, EVENT_ERROR } = require('@root/common/core/constant.js')
const { smartReadProperty } = require('@root/common/bacnet.js')
const { EG_BACNET_DEVICES, EG_BACNET_POINTS } = require('@root/common/example')
const { facetsStrToObj, errMsg, getErrMsg } = require('@root/common/func.js')
const { concurrentTasks } = require('@root/common/core/concurrent.js')
const {
    ERR_GENERIC, ERR_SCHEMA_VALIDATION, ERR_INVALID_DATA_TYPE, ERR_DUPLICATED_DEVICE_NAME,
    ERR_DUPLICATED_POINT_ID, ERR_POINT_NOT_ATTACHED_TO_DEVICE, ERR_READING_POINT
} = require('@root/common/core/constant.js')

// ---------------------------------- export ----------------------------------
module.exports = {
    ReadPointJob: class ReadPointJob extends BaseJob {
        pointsList = {};
        devicePointSeparator = '.';

        constructor(
            client, eventEmitter, devices, points, readMethod, maxConcurrentDeviceRead = 2,
            maxConcurrentSinglePointRead = 5, name = 'read point'
        ) {
            super();
            this.client = client
            this.eventEmitter = eventEmitter
            this.devices = devices
            this.points = points
            this.readMethod = readMethod
            this.maxConcurrentDeviceRead = maxConcurrentDeviceRead
            this.maxConcurrentSinglePointRead = maxConcurrentSinglePointRead
            this.name = name
        }

        async execute() {
            this.#updateProgress(0)

            return new Promise((resolve) => {
                try {
                    if (!this.#validateData()) {
                        this.#updateProgress(100)
                        resolve()
                        return
                    }

                    this.#updateProgress(10)

                    this.#readPoints().then(() => {
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

        #validateData() {
            // validate devices data type
            if (!Array.isArray(this.devices)) {
                this.eventEmitter.emit(EVENT_ERROR, errMsg(
                    this.name, ERR_INVALID_DATA_TYPE,
                    {
                        devices: this?.devices,
                        expected: 'array',
                        example: EG_BACNET_DEVICES
                    })
                )
                return false
            }

            // validate points data type
            if (!Array.isArray(this.points)) {
                this.eventEmitter.emit(EVENT_ERROR, errMsg(
                    this.name, ERR_INVALID_DATA_TYPE,
                    {
                        points: this?.points,
                        expected: 'array',
                        example: EG_BACNET_POINTS
                    })
                )
                return false
            }

            // validate devices details
            const deviceSchemaErrList = [];
            const deviceNameCount = {};
            const dupDeviceNames = [];

            this.devices.forEach(d => {
                // validate device schema
                const { error } = bacnetDeviceSchema.validate(d);
                if (error) {
                    deviceSchemaErrList.push(error);
                    return
                }

                // ensure no duplicate device name
                if (deviceNameCount[d.deviceName]) {
                    deviceNameCount[d.deviceName]++;
                    if (deviceNameCount[d.deviceName] === 2)
                        dupDeviceNames.push(d.deviceName);
                } else {
                    deviceNameCount[d.deviceName] = 1;
                }
            });

            if (deviceSchemaErrList.length > 0) {
                this.eventEmitter.emit(EVENT_ERROR, errMsg(
                    this.name, `${ERR_SCHEMA_VALIDATION} (devices)`, deviceSchemaErrList
                ))
                return false
            }

            if (dupDeviceNames.length > 0) {
                this.eventEmitter.emit(EVENT_ERROR, errMsg(
                    this.name, ERR_DUPLICATED_DEVICE_NAME, dupDeviceNames
                ))
                return false
            }

            // validate points details
            const pointSchemaErrList = [];
            const pointNameCount = {};
            const dupPointNames = [];
            this.points.forEach(p => {
                // validate point schema
                const { error } = bacnetPointSchema.validate(p);
                if (error) {
                    pointSchemaErrList.push(error);
                    return
                }

                // ensure no duplicate point id
                const id = `${p.deviceName}${this.devicePointSeparator}${p.pointName}`

                if (pointNameCount[id]) {
                    pointNameCount[id]++;
                    if (pointNameCount[id] === 2)
                        dupPointNames.push(id);
                } else {
                    pointNameCount[id] = 1;
                }
            });

            if (pointSchemaErrList.length > 0) {
                this.eventEmitter.emit(EVENT_ERROR, errMsg(
                    this.name, `${ERR_SCHEMA_VALIDATION} (points)`, pointSchemaErrList
                ))
                return false
            }

            if (dupPointNames.length > 0) {
                this.eventEmitter.emit(EVENT_ERROR, errMsg(
                    this.name, ERR_DUPLICATED_POINT_ID, dupPointNames
                ))
                return false
            }

            // ensure point is attached to device
            const orphanPoints = this.points.filter(p => !this.devices.find(d => d.deviceName === p.deviceName));
            if (orphanPoints.length > 0) {
                this.eventEmitter.emit(EVENT_ERROR, errMsg(
                    this.name, ERR_POINT_NOT_ATTACHED_TO_DEVICE, orphanPoints
                ))
                return false
            }

            return true
        }

        async #readPoints() {
            // restructure devices to object with deviceName as key
            const devicePointConfig = {};
            this.devices.forEach(d => {
                devicePointConfig[d.deviceName] = { device: d }
                devicePointConfig[d.deviceName].points = []
            })

            // attach points to devices
            this.points.forEach(p => {
                if (p.deviceName in devicePointConfig) {
                    devicePointConfig[p.deviceName].points.push({
                        objectId: { type: p.bacType, instance: p.bacInstance },
                        properties: [{ id: p.bacProp }]
                    })
                }
            })

            // read points
            const points = {};
            const smartReadEvent = new EventEmitter();
            const entries = Object.entries(devicePointConfig);
            const size = entries.length;
            let count = 0;

            smartReadEvent.on(EVENT_OUTPUT, (data) => {
                this.#updateProgress(
                    Math.round((85 / size) * (count + 1) + 10)
                )

                if (Array.isArray(data.result))
                    data.result.forEach(i => {
                        points[`${data.id}_${i.objectId.type}_${i.objectId.instance}_${i.values[0].id}`] = i.values?.[0]?.value?.[0]?.value;
                    });

                count++;
            });

            const tasks = entries.map(([k, v]) => ({
                id: k,
                task: async () => {
                    return await smartReadProperty(
                        this.client, v.device, v.points, this.readMethod, this.maxConcurrentSinglePointRead
                    );
                }
            }));

            await concurrentTasks(smartReadEvent, tasks, this.maxConcurrentDeviceRead);

            // format final result
            this.points.forEach(p => {
                const key = `${p.deviceName}_${p.bacType}_${p.bacInstance}_${p.bacProp}`;

                // var
                let value = points[key];
                let err = null

                if (value == null || value?.errorClass != null || value?.errorCode != null) {
                    value = 0
                    err = ERR_READING_POINT
                }

                let fvalue = value

                // format point
                const facetObj = facetsStrToObj(p.facets);

                if (facetObj.trueText != null || facetObj.falseText != null) { // boolean
                    fvalue = fvalue ? facetObj.trueText : facetObj.falseText
                } else if (facetObj.range != null) { // enum
                    if (fvalue in facetObj.range)
                        fvalue = facetObj.range[fvalue]
                    else
                        fvalue = String(fvalue)
                } else { // general
                    if (typeof value === 'number') {
                        value = (facetObj.precision != null) ? +value.toFixed(facetObj.precision) : +value.toFixed(1)
                        fvalue = value
                    }
                    if (facetObj.unit != null)
                        fvalue = `${fvalue} ${facetObj.unit}`
                    if (typeof fvalue === 'number')
                        fvalue = String(fvalue)
                }

                // add to result
                this.pointsList[`${p.deviceName}${this.devicePointSeparator}${p.pointName}`] = {
                    value: facetObj.precision != null ? +value.toFixed(facetObj.precision) : value,
                    fvalue: fvalue,
                }
                if (err)
                    this.pointsList[`${p.deviceName}${this.devicePointSeparator}${p.pointName}`].err = err
            })
        }

        #updateProgress(progress) {
            this.eventEmitter.emit(EVENT_UPDATE_STATUS, progress);
        }

        #exportPoints() {
            let exportPoints = {};
            for (let [k, v] of Object.entries(this.pointsList)) {
                const { error, value: result } = readPointSchema.validate(
                    v, { stripUnknown: true }
                );
                if (error) {
                    this.eventEmitter.emit(EVENT_ERROR, errMsg(
                        this.name, `${ERR_SCHEMA_VALIDATION}, please contact support`, error
                    ))
                    continue
                }
                exportPoints[k] = result;
            }

            this.eventEmitter.emit(EVENT_OUTPUT, exportPoints);
        }
    }
}