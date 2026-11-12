'use strict';
require('./_alias.js');

const EventEmitter = require('events');
const { Buffer } = require('buffer');

const bacnet = require('@root/ext/node-bacstack/dist/index.js')
const baEnum = bacnet.enum;

const { BaseJob } = require('@root/common/job/core.js')
const { bacnetDeviceSchema, bacnetPointSchema } = require('@root/common/schema.js')
const { EVENT_OUTPUT, EVENT_UPDATE_STATUS, EVENT_ERROR } = require('@root/common/core/constant.js')
const { readPropertyReturnArr } = require('@root/common/bacnet.js')
const { EG_BACNET_DEVICES, EG_BACNET_POINTS } = require('@root/common/example')
const { errMsg, getErrMsg } = require('@root/common/func.js')
const { concurrentTasksWithNetworkAwareness } = require('@root/common/core/concurrent.js')
const {
    ERR_GENERIC, ERR_SCHEMA_VALIDATION, ERR_INVALID_DATA_TYPE, ERR_DUPLICATED_DEVICE_NAME,
    ERR_POINT_NOT_ATTACHED_TO_DEVICE
} = require('@root/common/core/constant.js')

// ---------------------------------- constants ----------------------------------
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
// hard upper bound on EXCEPTION_SCHEDULE array indexes read per schedule
const MAX_EXCEPTION_ENTRIES = 1000;

// ---------------------------------- decode helpers ----------------------------------
/**
 * Decodes a raw 4-byte BACnet Date (hex string) into YYYY-MM-DD. 0xFF means "any" and is shown as '*'.
 * @param {string} hex
 * @returns {string}
 */
const decodeDateHex = (hex) => {
    const b = Buffer.from(hex, 'hex');
    if (b[0] === 0xFF && b[1] === 0xFF && b[2] === 0xFF) return '*';
    const part = (v, fmt) => (v === 0xFF ? '*' : fmt(v));
    const year = b[0] === 0xFF ? '*' : String(b[0] + 1900);
    const month = part(b[1], v => String(v).padStart(2, '0'));
    const day = part(b[2], v => String(v).padStart(2, '0'));
    return `${year}-${month}-${day}`;
};

/**
 * Formats a date node as YYYY-MM-DD. Accepts a context-tagged raw date (hex) or an
 * application-tagged Date value. The vendored decodeDate passes the raw month straight to
 * new Date(), so the month is read back with getMonth() without adding 1.
 * @param {object} node
 * @returns {string|null}
 */
const dateFromNode = (node) => {
    if (!node) return null;
    if (typeof node.raw === 'string') return decodeDateHex(node.raw);
    // the vendored decodeDate maps an all-0xFF (unspecified) date to new Date(1, 1, 1) (local time); show it as '*'
    if (node.value instanceof Date && node.value.getTime() === new Date(1, 1, 1).getTime()) {
        return '*';
    }
    if (node.value instanceof Date && !isNaN(node.value)) {
        const d = node.value;
        return `${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    return null;
};

/**
 * Returns the enum name for an object type number, eg 6 -> 'CALENDAR'.
 * @param {number} type
 * @returns {string|null}
 */
const objectTypeName = (type) => {
    return Object.keys(baEnum.ObjectType).find(k => baEnum.ObjectType[k] === type) ?? null;
};

/**
 * Decodes a raw 4-byte BACnet object identifier (hex string) into { type, instance }.
 * @param {string} hex
 * @returns {{type: number, instance: number}}
 */
const decodeObjectIdHex = (hex) => {
    const v = Buffer.from(hex, 'hex').readUInt32BE(0);
    return { type: (v >> 22) & 0x3FF, instance: v & 0x3FFFFF };
};


/**
 * Decodes a raw BACnetWeekNDay (hex). 255 (any) is returned as null.
 * @param {string} hex
 * @returns {{month: number|null, weekOfMonth: number|null, dayOfWeek: number|null, dayName: string|null}}
 */
const decodeWeekNDay = (hex) => {
    const [month, weekOfMonth, dayOfWeek] = Buffer.from(hex, 'hex');
    const any = v => (v === 0xFF ? null : v);
    return {
        month: any(month),
        weekOfMonth: any(weekOfMonth),
        dayOfWeek: any(dayOfWeek),
        dayName: DAYS[dayOfWeek - 1] ?? null,
    };
};

/**
 * Formats a Time node as HH:MM:SS. 0xFF = any.
 * @param {object} node
 * @returns {string|null}
 */
const timeFromNode = (node) => {
    if (!node) return null;
    const part = v => (v === 0xFF ? '**' : String(v).padStart(2, '0'));
    if (typeof node.raw === 'string') {
        const [h, m, s] = Buffer.from(node.raw, 'hex');
        return `${part(h)}:${part(m)}:${part(s)}`;
    }
    if (node.value instanceof Date && !isNaN(node.value)) {
        const d = node.value;
        return [d.getHours(), d.getMinutes(), d.getSeconds()].map(v => String(v).padStart(2, '0')).join(':');
    }
    return null;
};

/**
 * Decodes a list of BACnetTimeValue pairs, which arrive flattened as [time, value, time, value, ...].
 * A null value is a BACnet NULL, ie relinquish the schedule's output at that time.
 * @param {object[]} [children]
 * @returns {{time: string, value: *}[]|null}
 */
const decodeTimeValues = (children) => {
    if (!children) return null;
    const result = [];
    for (let i = 0; i + 1 < children.length; i += 2) {
        result.push({ time: timeFromNode(children[i]), value: children[i + 1].value ?? null });
    }
    return result;
};


/**
 * Decodes the period of a SpecialEvent: date / dateRange / weekNDay / calendarReference.
 * @param {object} period
 * @returns {object}
 */
const decodeSpecialEventPeriod = (period) => {
    const entry = period.children?.[0];
    if (period.tagNumber === 1 && period.raw) {
        const ref = decodeObjectIdHex(period.raw);
        return {
            calendarReference: {
                type: ref.type,
                typeName: objectTypeName(ref.type),
                instance: ref.instance,
            }
        };
    }
    if (entry?.tagNumber === 0 && (entry.raw || entry.value instanceof Date)) {
        return { date: dateFromNode(entry) };
    }
    if (entry?.tagNumber === 1 && entry.children) {
        const [start, end] = entry.children;
        return { dateRange: { start: dateFromNode(start), end: dateFromNode(end) } };
    }
    if (entry?.tagNumber === 2 && entry.raw) {
        return { weekNDay: decodeWeekNDay(entry.raw) };
    }
    return { raw: period };
};

/**
 * Decodes one exception schedule entry (SpecialEvent) from the values of a single array index.
 * @param {object[]} items
 * @returns {object}
 */
const decodeSpecialEvent = (items) => {
    const period = items.find(c => c.tagNumber === 0 || c.tagNumber === 1);
    const timeValues = items.find(c => c.tagNumber === 2);
    const priority = items.find(c => c.tagNumber === 3);
    return {
        period: period ? decodeSpecialEventPeriod(period) : null,
        timeValues: decodeTimeValues(timeValues?.children),
        eventPriority: priority?.raw ? parseInt(priority.raw, 16) : null,
    };
};

/**
 * Decodes WEEKLY_SCHEDULE: one array item per weekday (Monday..Sunday).
 * @param {object[]} items
 * @returns {{day: string, timeValues: object[]}[]}
 */
const decodeWeeklySchedule = (items) => {
    return items.map((item, i) => ({
        day: DAYS[i] ?? `day ${i + 1}`,
        timeValues: decodeTimeValues(item.children) ?? [],
    }));
};

/**
 * Decodes one DATE_LIST item (date / dateRange / weekNDay).
 * @param {object} item
 * @returns {object}
 */
const decodeCalendarEntry = (item) => {
    // a context primitive is { tagNumber, raw: '<hex>' }, a nested item is wrapped as { raw: { tagNumber, ... } }
    const entry = item.raw && typeof item.raw === 'object' ? item.raw : item;
    if (entry.tagNumber === 0) {
        return { date: dateFromNode(entry) ?? dateFromNode(item) };
    }
    if (entry.tagNumber === 1 && entry.children) {
        const [start, end] = entry.children;
        return { dateRange: { start: dateFromNode(start), end: dateFromNode(end) } };
    }
    if (entry.tagNumber === 2 && entry.raw) {
        return { weekNDay: decodeWeekNDay(entry.raw) };
    }
    return { raw: item };
};


// ---------------------------------- read helpers ----------------------------------
const getAddressSet = (device) => {
    return device.macAddress != null && device.network != null
        ? { ip: device.ipAddress, adr: device.macAddress, net: device.network }
        : device.ipAddress;
};

/**
 * Reads a non-array property in a single request and returns the decoded values.
 * @returns {Promise<object[]>}
 */
const readSingleProperty = async (
    client, device, objectId, propertyId, getNextInvokeId = undefined, extraOptions = {}
) => {
    const res = await new Promise((resolve, reject) => {
        /** @type {{maxApdu: any, invokeId?: number, arrayIndex?: number}} */
        const options = { maxApdu: device.maxApdu, ...extraOptions };
        // use the shared invoke id generator so concurrent device reads don't collide
        if (typeof getNextInvokeId === 'function') options.invokeId = getNextInvokeId();

        client.readProperty(
            getAddressSet(device),
            objectId,
            propertyId,
            options,
            (err, value) => err ? reject(err) : resolve(value)
        );
    });
    return res?.values ?? [];
};

const readCalendarDates = async (client, device, ref, getNextInvokeId) => {
    const values = await readSingleProperty(
        client, device, { type: ref.type, instance: ref.instance }, baEnum.PropertyIdentifier.DATE_LIST,
        getNextInvokeId
    );
    return values.map(decodeCalendarEntry);
};

const resolveCalendarReferences = async (client, device, entries, getNextInvokeId) => {
    for (const entry of entries) {
        const ref = entry.period?.calendarReference;
        if (!ref) continue;
        entry.period.calendarReference.dates = await readCalendarDates(client, device, ref, getNextInvokeId);
    }
    return entries;
};

/**
 * Reads EXCEPTION_SCHEDULE one array index at a time, so each SpecialEvent stays grouped.
 * Stops when the device returns INVALID_ARRAY_INDEX (class 2, code 42).
 * @returns {Promise<object[]>}
 */
const readExceptionSchedule = async (client, device, objectId, getNextInvokeId) => {
    const entries = [];
    for (let index = 1; index <= MAX_EXCEPTION_ENTRIES; index++) {
        let items;
        try {
            items = await readSingleProperty(
                client, device, objectId, baEnum.PropertyIdentifier.EXCEPTION_SCHEDULE,
                getNextInvokeId, { arrayIndex: index }
            );
        } catch (err) {
            // INVALID_ARRAY_INDEX marks the end of the list
            if (/** @type {Error} */ (err)?.message?.includes('Code:42')) break;
            throw err;
        }

        // an empty or NULL reply also marks the end, guards against devices that never return INVALID_ARRAY_INDEX
        if (items.length === 0 || items[0]?.type === baEnum.ApplicationTags.NULL) break;

        // keep the undecoded structure if an entry can't be decoded, so the rest of the list still returns
        try {
            entries.push(decodeSpecialEvent(items));
        } catch (err) {
            entries.push({ error: getErrMsg(err), items: items });
        }
    }
    return entries;
};

// ---------------------------------- export ----------------------------------
module.exports = {
    ReadScheduleJob: class ReadScheduleJob extends BaseJob {
        results = [];

        constructor(
            client, eventEmitter, msg, maxConcurrentDeviceRead = 1, concurrentTaskDelay = 50,
            name = 'read schedule'
        ) {
            super();
            this.client = client
            this.eventEmitter = eventEmitter
            this.msg = msg
            this.devices = msg?.devices
            this.points = msg?.points
            this.maxConcurrentDeviceRead = maxConcurrentDeviceRead
            this.concurrentTaskDelay = concurrentTaskDelay
            this.name = name
        }

        async execute() {
            this.#updateProgress(0);
            try {
                if (!this.#validateData()) return;

                this.#updateProgress(10);
                await this.#readSchedules();
                this.#exportSchedules();
            } catch (err) {
                this.eventEmitter.emit(EVENT_ERROR, errMsg(this.name, ERR_GENERIC, getErrMsg(err)));
            } finally {
                this.#updateProgress(100);
            }
        }


        #validateData() {
            if (!Array.isArray(this.devices)) {
                this.eventEmitter.emit(EVENT_ERROR, errMsg(
                    this.name, ERR_INVALID_DATA_TYPE,
                    { devices: this?.devices, expected: 'array', example: EG_BACNET_DEVICES })
                )
                return false
            }

            if (!Array.isArray(this.points)) {
                this.eventEmitter.emit(EVENT_ERROR, errMsg(
                    this.name, ERR_INVALID_DATA_TYPE,
                    { points: this?.points, expected: 'array', example: EG_BACNET_POINTS })
                )
                return false
            }

            // validate devices
            const deviceSchemaErrList = [];
            const deviceNames = new Set();
            const dupDeviceNames = [];
            this.devices.forEach(d => {
                const { error } = bacnetDeviceSchema.validate(d, { stripUnknown: true });
                if (error) {
                    deviceSchemaErrList.push(error);
                    return
                }
                if (deviceNames.has(d.deviceName)) dupDeviceNames.push(d.deviceName);
                deviceNames.add(d.deviceName);
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

            // validate points
            const pointSchemaErrList = [];
            this.points.forEach(p => {
                const { error } = bacnetPointSchema.validate(p, { stripUnknown: true });
                if (error) pointSchemaErrList.push(error);
            });

            if (pointSchemaErrList.length > 0) {
                this.eventEmitter.emit(EVENT_ERROR, errMsg(
                    this.name, `${ERR_SCHEMA_VALIDATION} (points)`, pointSchemaErrList
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


        async #readSchedules() {
            // only schedule points are read, other object types are ignored
            const scheduleDevices = this.devices
                .map(d => ({
                    device: d,
                    points: this.points.filter(
                        p => p.deviceName === d.deviceName && p.bacType === baEnum.ObjectType.SCHEDULE
                    )
                }))
                .filter(i => i.points.length > 0);

            const readEvent = new EventEmitter();
            const size = scheduleDevices.length;
            let count = 0;
            const resultsByDevice = {};

            readEvent.on(EVENT_OUTPUT, (data) => {
                resultsByDevice[data.id] = data.result;
                count++;
                this.#updateProgress(Math.round((85 / size) * count + 10));
            });

            readEvent.on(EVENT_ERROR, (data) => {
                this.eventEmitter.emit(EVENT_ERROR, data)
            });

            const tasks = scheduleDevices.map(({ device, points }) => ({
                id: device.deviceName,
                device: device,
                task: async (getNextInvokeId) => {
                    const out = [];
                    for (const point of points) {
                        try {
                            out.push(await this.#readSchedule(device, point, getNextInvokeId));
                        } catch (err) {
                            // keep going so one failing schedule doesn't lose the rest
                            this.eventEmitter.emit(EVENT_ERROR, errMsg(
                                this.name, ERR_GENERIC, `${device.deviceName}.${point.pointName}: ${getErrMsg(err)}`
                            ));
                            out.push({
                                deviceName: device.deviceName,
                                pointName: point.pointName,
                                objectId: { type: point.bacType, instance: point.bacInstance },
                                error: getErrMsg(err),
                            });
                        }
                    }
                    return out;
                }
            }));

            await concurrentTasksWithNetworkAwareness(
                readEvent, tasks, this.maxConcurrentDeviceRead, this.concurrentTaskDelay
            );

            // keep the input device order
            scheduleDevices.forEach(({ device }) => {
                const r = resultsByDevice[device.deviceName];
                if (Array.isArray(r)) this.results.push(...r);
            });
        }

        async #readSchedule(device, point, getNextInvokeId) {
            const client = this.client;
            const objectId = { type: baEnum.ObjectType.SCHEDULE, instance: point.bacInstance };
            const PI = baEnum.PropertyIdentifier;

            // run a read, capturing the error instead of throwing
            const attempt = async (fn) => {
                try {
                    return { value: await fn(), error: null };
                } catch (err) {
                    return { value: null, error: getErrMsg(err) };
                }
            };

            // WEEKLY_SCHEDULE is an array, read item by item
            const weekly = await attempt(async () => decodeWeeklySchedule(
                await readPropertyReturnArr(client, device, objectId, PI.WEEKLY_SCHEDULE, getNextInvokeId)
            ));
            const present = await attempt(async () => {
                const [first] = await readSingleProperty(
                    client, device, objectId, PI.PRESENT_VALUE, getNextInvokeId
                );
                return first?.value ?? null;
            });
            const effective = await attempt(async () => {
                const [start, end] = await readSingleProperty(
                    client, device, objectId, PI.EFFECTIVE_PERIOD, getNextInvokeId
                );
                return { start: dateFromNode(start), end: dateFromNode(end) };
            });
            const scheduleDefault = await attempt(async () => {
                const [first] = await readSingleProperty(
                    client, device, objectId, PI.SCHEDULE_DEFAULT, getNextInvokeId
                );
                return first?.value ?? null;
            });
            const exception = await attempt(async () => resolveCalendarReferences(
                client, device, await readExceptionSchedule(client, device, objectId, getNextInvokeId),
                getNextInvokeId
            ));

            return {
                deviceId: device.deviceId,
                deviceName: device.deviceName,
                pointName: point.pointName,
                objectId: objectId,
                presentValue: present.value,
                presentValueError: present.error,
                effectivePeriod: effective.value,
                effectivePeriodError: effective.error,
                scheduleDefault: scheduleDefault.value,
                scheduleDefaultError: scheduleDefault.error,
                weeklySchedule: weekly.value ?? [],
                weeklyScheduleError: weekly.error,
                exceptionSchedule: exception.value ?? [],
                exceptionScheduleError: exception.error,
            };
        }

        #updateProgress(progress) {
            this.eventEmitter.emit(EVENT_UPDATE_STATUS, progress);
        }

        #exportSchedules() {
            this.msg.payload = this.results;
            this.eventEmitter.emit(EVENT_OUTPUT, this.msg);
        }
    }
}

