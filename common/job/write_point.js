'use strict';
require('./_alias.js');

const EventEmitter = require('events');

const { BaseJob } = require('@root/common/job/core.js')
const { bacnetDeviceSchema, bacnetPointSchema, writePointSchema } = require('@root/common/schema.js')
const { EVENT_UPDATE_STATUS, EVENT_ERROR, EVENT_OUTPUT } = require('@root/common/core/constant.js')
const { smartWriteProperty } = require('@root/common/bacnet.js')
const { EG_BACNET_DEVICES, EG_BACNET_POINTS, EG_BACNET_WRITE_POINTS } = require('@root/common/example')
const { errMsg, getErrMsg } = require('@root/common/func.js')
const { concurrentTasks } = require('@root/common/core/concurrent.js')
const {
    ERR_GENERIC, ERR_SCHEMA_VALIDATION, ERR_INVALID_DATA_TYPE, ERR_DUPLICATED_DEVICE_NAME,
    ERR_DUPLICATED_POINT_ID, ERR_POINT_NOT_ATTACHED_TO_DEVICE, ERR_WRITE_POINT_NOT_FOUND,
    ERR_WRITE_POINT_INVALID_PRIORITY, ERR_WRITING_POINT
} = require('@root/common/core/constant.js')

// ---------------------------------- export ----------------------------------
module.exports = {
    WritePointJob: class WritePointJob extends BaseJob {
        writePointDetails = {}
        devicePointSeparator = '.';

        constructor(
            client, eventEmitter, devices, points, writePoints,
            maxConcurrentDeviceWrite = 2, maxConcurrentPointWrite = 1,
            name = 'write point'
        ) {
            super();
            this.client = client
            this.eventEmitter = eventEmitter
            this.devices = devices
            this.points = points
            this.writePoints = writePoints
            this.maxConcurrentDeviceWrite = maxConcurrentDeviceWrite
            this.maxConcurrentPointWrite = maxConcurrentPointWrite
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

                    this.#writePoints().then(() => {
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
            // var
            const pointDetails = {}

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

            // validate write points
            if (
                !(typeof this.writePoints === 'object' && !Array.isArray(this.writePoints) && this.writePoints != null)
                || Object.keys(this.writePoints).length === 0
            ) {
                this.eventEmitter.emit(EVENT_ERROR, errMsg(
                    this.name, ERR_INVALID_DATA_TYPE,
                    {
                        writePoints: this.writePoints,
                        expected: 'object',
                        example: EG_BACNET_WRITE_POINTS
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

                // ensure no duplicate point name
                const id = `${p.deviceName}${this.devicePointSeparator}${p.pointName}`
                if (pointNameCount[id]) {
                    pointNameCount[id]++;
                    if (pointNameCount[id] === 2)
                        dupPointNames.push(id);
                } else {
                    pointNameCount[id] = 1;
                }

                // add point details
                pointDetails[id] = {
                    deviceName: p.deviceName,
                    bacType: p.bacType,
                    bacInstance: p.bacInstance,
                    bacProp: p.bacProp,
                    valueType: p.valueType,
                    priority: p.priority
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

            // validate write points schema
            const { error } = writePointSchema.validate(this.writePoints);
            if (error) {
                this.eventEmitter.emit(EVENT_ERROR, errMsg(
                    this.name, `${ERR_SCHEMA_VALIDATION} (write points)`, error
                ))
                return false
            }

            // ensure writepoints are in point config and write priority is valid
            const missingPoints = [];
            const priorityErrList = [];

            Object.entries(this.writePoints).forEach(([key, value]) => {
                if (pointDetails[key] == null) {
                    missingPoints.push(key);
                    return
                }

                // check if priority is between 1 and 16
                if (pointDetails[key].priority < 1 || pointDetails[key].priority > 16) {
                    priorityErrList.push(key)
                    return
                }

                this.writePointDetails[key] = { ...pointDetails[key] }
                this.writePointDetails[key].id = key
                this.writePointDetails[key].value = value
            });

            if (missingPoints.length > 0) {
                this.eventEmitter.emit(EVENT_ERROR, errMsg(
                    this.name, ERR_WRITE_POINT_NOT_FOUND, missingPoints
                ))
                return false
            }

            if (priorityErrList.length > 0) {
                this.eventEmitter.emit(EVENT_ERROR, errMsg(
                    this.name, ERR_WRITE_POINT_INVALID_PRIORITY, priorityErrList
                ))
                return false
            }

            return true
        }

        #updateProgress(progress) {
            this.eventEmitter.emit(EVENT_UPDATE_STATUS, progress);
        }

        async #writePoints() {
            // restructure devices to object with deviceName as key
            const devicePointDetails = {};
            this.devices.forEach(d => {
                devicePointDetails[d.deviceName] = { device: d }
                devicePointDetails[d.deviceName].writePoints = {}
            })

            // attach write points to devices
            Object.entries(this.writePointDetails).forEach(([key, value]) => {
                void key
                devicePointDetails[value.deviceName].writePoints[value.id] = value
            })

            // concurrent write
            const smartWriteEvent = new EventEmitter();
            const entries = Object.entries(devicePointDetails);
            let count = 0;

            const tasks = entries
                .filter(([_, v]) => (void _, Object.keys(v.writePoints).length > 0))
                .map(([k, v]) => ({
                    id: k,
                    task: async () => {
                        return await smartWriteProperty(
                            this.client, v.device, v.writePoints, smartWriteEvent,
                            this.maxConcurrentPointWrite
                        );
                    }
                }));

            smartWriteEvent.on(EVENT_OUTPUT, (data) => {
                if (devicePointDetails[data.id] == null)
                    return

                this.#updateProgress(
                    Math.round((85 / tasks.length) * (count + 1) + 10)
                )
                count++;
            });

            smartWriteEvent.on(EVENT_ERROR, (data) => {
                this.eventEmitter.emit(EVENT_ERROR, errMsg(
                    this.name, ERR_WRITING_POINT, data
                ));
            });

            await concurrentTasks(smartWriteEvent, tasks, this.maxConcurrentDeviceWrite);
        }

    }
}