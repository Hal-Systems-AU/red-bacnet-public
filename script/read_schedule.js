'use strict';
require('./_alias.js');

const fs = require('fs');
const EventEmitter = require('events');
const path = require('path');

const bacnet = require('@root/ext/node-bacstack/dist/index.js')
const baEnum = bacnet.enum;

const { print } = require('@root/common/core/util.js')
const { readPropertyReturnArr } = require('@root/common/bacnet.js')
const { DiscoverPointJob } = require('@root/common/job/discover_point.js')
const { errMsg, getErrMsg } = require('@root/common/func.js')
const {
    EVENT_UPDATE_STATUS, EVENT_ERROR, EVENT_OUTPUT, ERR_GENERIC
} = require('@root/common/core/constant.js')

const outputFolder = 'output'
const name = 'read schedule'

// ---------------------------------- expose ----------------------------------
const maxConcurrentDeviceRead = 1
const discoverMode = 1 // 0:supported;1:all;2:analog&binary only
const readMethod = 2 // 0:single read only;1:multi read fallback single;2:2 x multi read fallback single
const maxConcurrentSinglePointRead = 50
const concurrentTaskDelay = 50

// devices.json is the discover_device output (array of devices)
const devices = JSON.parse(fs.readFileSync(path.join(outputFolder, 'devices.json'), 'utf8'));

// ---------------------------------- constants ----------------------------------
const eventEmitter = new EventEmitter();
const config = {
    apduTimeout: 3000,
    interface: '0.0.0.0',
    port: 47809,
    broadcastAddress: '192.168.1.46:47808',
}
const client = new bacnet.Client({
    apduTimeout: config.apduTimeout,
    interface: config.interface,
    port: config.port,
    broadcastAddress: config.broadcastAddress
});

// ---------------------------------- decode helpers ----------------------------------
/**
 * Decodes a raw 4-byte BACnet Date (hex string) into YYYY-MM-DD.
 * Bytes: year-1900, month (1-12), day (1-31), weekday (1-7). 0xFF means "any" and is shown as '*'.
 * @param {string} hex
 * @returns {string}
 */
function decodeDateHex(hex) {
    const b = Buffer.from(hex, 'hex');
    if (b[0] === 0xFF && b[1] === 0xFF && b[2] === 0xFF) return '*';
    const part = (v, fmt) => (v === 0xFF ? '*' : fmt(v));
    const year = b[0] === 0xFF ? '*' : String(b[0] + 1900);
    const month = part(b[1], v => String(v).padStart(2, '0'));
    const day = part(b[2], v => String(v).padStart(2, '0'));
    return `${year}-${month}-${day}`;
}

/**
 * Formats a date node as YYYY-MM-DD. Accepts a context-tagged raw date (hex) or an
 * application-tagged Date value. The vendored decodeDate passes the raw month straight to
 * new Date(), so the month is read back with getMonth() without adding 1.
 * @param {object} node
 * @returns {string|null}
 */
function dateFromNode(node) {
    if (!node) return null;
    if (typeof node.raw === 'string') return decodeDateHex(node.raw);
    // the vendored decodeDate maps an all-0xFF (unspecified) date to 1901-01-31T14:00Z; show it as '*'
    if (node.value instanceof Date && node.value.getTime() === Date.UTC(1901, 0, 31, 14, 0, 0)) {
        return '*';
    }
    if (node.value instanceof Date && !isNaN(node.value)) {
        const d = node.value;
        return `${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    return null;
}

/**
 * Returns the enum name for an object type number, eg 6 -> 'CALENDAR'.
 * @param {number} type
 * @returns {string|null}
 */
function objectTypeName(type) {
    return Object.keys(baEnum.ObjectType).find(k => baEnum.ObjectType[k] === type) ?? null;
}

/**
 * Decodes a raw 4-byte BACnet object identifier (hex string) into { type, instance }.
 * @param {string} hex
 * @returns {{type: number, instance: number}}
 */
function decodeObjectIdHex(hex) {
    const v = Buffer.from(hex, 'hex').readUInt32BE(0);
    return { type: (v >> 22) & 0x3FF, instance: v & 0x3FFFFF };
}

/**
 * Decodes a raw BACnetWeekNDay (hex): month 1-12 (13 odd, 14 even, 255 any), weekOfMonth 1-5 = days 1-7 .. 29-35,
 * 6 = last 7 days, (255 any), dayOfWeek 1-7 = Monday..Sunday (255 any). 255 is returned as null.
 * @param {string} hex
 * @returns {{month: number|null, weekOfMonth: number|null, dayOfWeek: number|null, dayName: string|null}}
 */
function decodeWeekNDay(hex) {
    const [month, weekOfMonth, dayOfWeek] = Buffer.from(hex, 'hex');
    const any = v => (v === 0xFF ? null : v);
    return {
        month: any(month),
        weekOfMonth: any(weekOfMonth),
        dayOfWeek: any(dayOfWeek),
        dayName: DAYS[dayOfWeek - 1] ?? null,
    };
}

/**
 * Decodes the period of a SpecialEvent.
 * calendarEntry [0] holds a CHOICE: date [0] / dateRange [1] / weekNDay [2];
 * calendarReference [1] holds a Calendar object identifier.
 * @param {object} period - child of the SpecialEvent with tagNumber 0 (nested value)
 * @returns {object}
 */
function decodeSpecialEventPeriod(period) {
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
}

/**
 * Decodes one exception schedule entry (SpecialEvent) from the values of a single array index:
 * period, time values and event priority are the top-level items of that index.
 * @param {object[]} items - top-level nested values for one array index
 * @returns {object}
 */
function decodeSpecialEvent(items) {
    const period = items.find(c => c.tagNumber === 0 || c.tagNumber === 1);
    const timeValues = items.find(c => c.tagNumber === 2);
    const priority = items.find(c => c.tagNumber === 3);
    return {
        period: period ? decodeSpecialEventPeriod(period) : null,
        timeValues: decodeTimeValues(timeValues?.children),
        eventPriority: priority?.raw ? parseInt(priority.raw, 16) : null,
    };
}

/**
 * Formats a Time node as HH:MM:SS. Uses the raw 4 bytes (hour, minute, second, hundredths), 0xFF = any.
 * Falls back to the local-time fields of the decoded Date (the decoder builds it with local time).
 * @param {object} node
 * @returns {string|null}
 */
function timeFromNode(node) {
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
}

/**
 * Decodes a list of BACnetTimeValue (time, value) pairs, which arrive flattened as [time, value, time, value, ...].
 * A null value is a BACnet NULL, ie relinquish the schedule's output at that time.
 * @param {object[]} [children]
 * @returns {{time: string, value: *}[]|null}
 */
function decodeTimeValues(children) {
    if (!children) return null;
    const result = [];
    for (let i = 0; i + 1 < children.length; i += 2) {
        result.push({ time: timeFromNode(children[i]), value: children[i + 1].value ?? null });
    }
    return result;
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/**
 * Decodes WEEKLY_SCHEDULE: one array item per weekday (Monday..Sunday), each a list of time values.
 * @param {object[]} items
 * @returns {{day: string, timeValues: object[]}[]}
 */
function decodeWeeklySchedule(items) {
    return items.map((item, i) => ({
        day: DAYS[i] ?? `day ${i + 1}`,
        timeValues: decodeTimeValues(item.children) ?? [],
    }));
}

/**
 * Decodes one DATE_LIST item. The item is a calendar entry itself (not a SpecialEvent period):
 * date [0], dateRange [1] with two dates, or weekNDay [2]. The decoder wraps nested items as { raw: {...} }.
 * @param {object} item
 * @returns {object}
 */
function decodeCalendarEntry(item) {
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
}

/**
 * Reads a Calendar object's DATE_LIST (property 23) and decodes each calendar entry.
 * The list uses the same calendar entry forms as a SpecialEvent period: date, date range, weekNDay.
 * @param {object} client
 * @param {object} device
 * @param {{type: number, instance: number}} ref - calendar object identifier
 * @returns {Promise<object[]>}
 */
async function readCalendarDates(client, device, ref) {
    const objectId = { type: ref.type, instance: ref.instance };
    const addressSet = device.macAddress != null && device.network != null
        ? { ip: device.ipAddress, adr: device.macAddress, net: device.network }
        : device.ipAddress;

    // DATE_LIST is a plain list, read it in one request (no array index)
    const value = await new Promise((resolve, reject) => {
        client.readProperty(
            addressSet,
            objectId,
            baEnum.PropertyIdentifier.DATE_LIST,
            { maxApdu: device.maxApdu },
            (err, res) => err ? reject(err) : resolve(res)
        );
    });

    return value.values.map(decodeCalendarEntry);
}

/**
 * Adds the decoded DATE_LIST to every calendarReference in the exception schedule.
 * @param {object} client
 * @param {object} device
 * @param {object[]} entries - decoded SpecialEvent entries
 * @returns {Promise<object[]>}
 */
async function resolveCalendarReferences(client, device, entries) {
    for (const entry of entries) {
        const ref = entry.period?.calendarReference;
        if (!ref) continue;
        entry.period.calendarReference.dates = await readCalendarDates(client, device, ref);
    }
    return entries;
}

/**
 * Reads the schedule's PRESENT_VALUE (property 85), a single application-tagged value (eg boolean).
 * @returns {Promise<*>} the plain value (eg false), null if the device returns no value
 */
async function readPresentValue(client, device, objectId) {
    const addressSet = device.macAddress != null && device.network != null
        ? { ip: device.ipAddress, adr: device.macAddress, net: device.network }
        : device.ipAddress;

    const res = await new Promise((resolve, reject) => {
        client.readProperty(
            addressSet,
            objectId,
            baEnum.PropertyIdentifier.PRESENT_VALUE,
            { maxApdu: device.maxApdu },
            (err, value) => err ? reject(err) : resolve(value)
        );
    });

    return res?.values?.[0]?.value ?? null;
}

/**
 * Reads a non-array schedule property in a single request and returns the decoded values.
 * @returns {Promise<object[]>}
 */
async function readScheduleProperty(client, device, objectId, propertyId) {
    const addressSet = device.macAddress != null && device.network != null
        ? { ip: device.ipAddress, adr: device.macAddress, net: device.network }
        : device.ipAddress;

    const res = await new Promise((resolve, reject) => {
        client.readProperty(
            addressSet,
            objectId,
            propertyId,
            { maxApdu: device.maxApdu },
            (err, value) => err ? reject(err) : resolve(value)
        );
    });
    return res?.values ?? [];
}

/**
 * Reads EFFECTIVE_PERIOD (property 32), a DateRange of two application dates. '*' means unbounded.
 * @returns {Promise<{start: string|null, end: string|null}>}
 */
async function readEffectivePeriod(client, device, objectId) {
    const [start, end] = await readScheduleProperty(client, device, objectId, baEnum.PropertyIdentifier.EFFECTIVE_PERIOD);
    return { start: dateFromNode(start), end: dateFromNode(end) };
}

/**
 * Reads SCHEDULE_DEFAULT (property 174), the value used when no time value applies.
 * @returns {Promise<*>} the plain value (eg false), null if the device returns no value
 */
async function readScheduleDefault(client, device, objectId) {
    const [first] = await readScheduleProperty(client, device, objectId, baEnum.PropertyIdentifier.SCHEDULE_DEFAULT);
    return first?.value ?? null;
}

/**
 * Reads EXCEPTION_SCHEDULE one array index at a time, so each SpecialEvent stays grouped.
 * Stops when the device returns INVALID_ARRAY_INDEX (class 2, code 42), which marks the end of the list.
 * @returns {Promise<object[]>}
 */
async function readExceptionSchedule(client, device, objectId) {
    const addressSet = device.macAddress != null && device.network != null
        ? { ip: device.ipAddress, adr: device.macAddress, net: device.network }
        : device.ipAddress;

    const entries = [];
    for (let index = 1; ; index++) {
        const items = await new Promise((resolve, reject) => {
            client.readProperty(
                addressSet,
                objectId,
                baEnum.PropertyIdentifier.EXCEPTION_SCHEDULE,
                { maxApdu: device.maxApdu, arrayIndex: index },
                (err, value) => err ? reject(err) : resolve(value.values)
            );
        }).catch(err => {
            if (err.message.includes('Code:42')) return null;
            throw err;
        });

        if (items === null) break;
        // keep the undecoded structure if an entry can't be decoded, so the rest of the list still returns
        try {
            entries.push(decodeSpecialEvent(items));
        } catch (err) {
            entries.push({ error: getErrMsg(err), items: items });
        }
    }
    return entries;
}

// ---------------------------------- discover schedules ----------------------------------
/**
 * Discovers all points of every device with DiscoverPointJob and keeps only SCHEDULE objects.
 * @returns {Promise<{device: object, point: object}[]>}
 */
async function discoverSchedules() {
    const found = [];
    const jobEmitter = new EventEmitter();

    // the job reuses one msg object per device, so copy what is needed synchronously
    jobEmitter.on(EVENT_OUTPUT, (msg) => {
        const device = msg.device;
        for (const point of msg.payload ?? []) {
            if (point.bacType === baEnum.ObjectType.SCHEDULE)
                found.push({ device, point: { ...point } });
        }
    });
    jobEmitter.on(EVENT_UPDATE_STATUS, (msg) => eventEmitter.emit(EVENT_UPDATE_STATUS, msg));
    jobEmitter.on(EVENT_ERROR, (err) => eventEmitter.emit(EVENT_ERROR, err));

    const job = new DiscoverPointJob(
        client, jobEmitter, { devices: devices }, discoverMode, readMethod,
        maxConcurrentDeviceRead, maxConcurrentSinglePointRead, concurrentTaskDelay
    );
    await job.execute();
    return found;
}

// ---------------------------------- read schedule ----------------------------------
/**
 * Reads present value, effective period, default, weekly and exception schedules of one schedule object.
 * @param {object} device
 * @param {object} point - discovered schedule point
 * @returns {Promise<object>}
 */
async function readSchedule(device, point) {
    {
        const objectId = { type: baEnum.ObjectType.SCHEDULE, instance: point.bacInstance };
        // WEEKLY_SCHEDULE and EXCEPTION_SCHEDULE are arrays, read item by item
        let weeklySchedule = [];
        let weeklyScheduleError = null;
        try {
            weeklySchedule = decodeWeeklySchedule(
                await readPropertyReturnArr(client, device, objectId, baEnum.PropertyIdentifier.WEEKLY_SCHEDULE)
            );
        } catch (err) {
            weeklyScheduleError = getErrMsg(err);
        }

        let presentValue = null;
        let presentValueError = null;
        try {
            presentValue = await readPresentValue(client, device, objectId);
        } catch (err) {
            presentValueError = getErrMsg(err);
        }

        let effectivePeriod = null;
        let effectivePeriodError = null;
        try {
            effectivePeriod = await readEffectivePeriod(client, device, objectId);
        } catch (err) {
            effectivePeriodError = getErrMsg(err);
        }

        let scheduleDefault = null;
        let scheduleDefaultError = null;
        try {
            scheduleDefault = await readScheduleDefault(client, device, objectId);
        } catch (err) {
            scheduleDefaultError = getErrMsg(err);
        }

        // an empty exception schedule has no index 1, the device returns INVALID_ARRAY_INDEX (class 2, code 42)
        let exceptionSchedule = [];
        let exceptionScheduleError = null;
        try {
            exceptionSchedule = await readExceptionSchedule(client, device, objectId);
            exceptionSchedule = await resolveCalendarReferences(client, device, exceptionSchedule);
        } catch (err) {
            exceptionScheduleError = getErrMsg(err);
        }

        return {
            deviceId: device.deviceId,
            deviceName: device.deviceName,
            pointName: point.pointName,
            objectId: objectId,
            presentValue: presentValue,
            presentValueError: presentValueError,
            effectivePeriod: effectivePeriod,
            effectivePeriodError: effectivePeriodError,
            scheduleDefault: scheduleDefault,
            scheduleDefaultError: scheduleDefaultError,
            weeklySchedule: weeklySchedule,
            weeklyScheduleError: weeklyScheduleError,
            exceptionSchedule: exceptionSchedule,
            exceptionScheduleError: exceptionScheduleError,
        };
    }
}

// ---------------------------------- main function ----------------------------------
async function main() {
    const start = performance.now();

    try {
        const schedules = await discoverSchedules();
        print(`found ${schedules.length} schedule(s)`);

        const results = [];
        for (const { device, point } of schedules) {
            try {
                results.push(await readSchedule(device, point));
            } catch (err) {
                // keep going so one failing schedule doesn't lose the rest
                eventEmitter.emit(EVENT_ERROR, errMsg(
                    name, ERR_GENERIC, `${device.deviceName} ${point.pointName}: ${getErrMsg(err)}`
                ));
                results.push({
                    deviceId: device.deviceId,
                    deviceName: device.deviceName,
                    pointName: point.pointName,
                    objectId: { type: point.bacType, instance: point.bacInstance },
                    error: getErrMsg(err),
                });
            }
        }

        eventEmitter.emit(EVENT_OUTPUT, results);
    } catch (err) {
        eventEmitter.emit(EVENT_ERROR, errMsg(name, ERR_GENERIC, getErrMsg(err)));
    } finally {
        const end = performance.now();
        const exeTime = calExeTime(start, end);
        print(`completed in ${exeTime}`);

        client.close();
    }
}

// ---------------------------------- events ----------------------------------
eventEmitter.on(EVENT_OUTPUT, (data) => {
    if (!fs.existsSync(outputFolder))
        fs.mkdirSync(outputFolder);

    const output = path.resolve(outputFolder, 'read_schedule.json');
    fs.writeFile(output, JSON.stringify(data, null, 2), (err) => {
        if (err) {
            console.error('Error writing file:', err);
        } else {
            console.log(`JSON data successfully saved to file: ${output}`);
        }
    });
});

eventEmitter.on(EVENT_UPDATE_STATUS, (msg) => {
    print(`progress: ${msg} %`);
});

eventEmitter.on(EVENT_ERROR, (err) => {
    print(`error: ${JSON.stringify(err)}`)
});

// ---------------------------------- functions ----------------------------------
function calExeTime(startTime, endTime) {
    const totalSeconds = (endTime - startTime) / 1000;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = (totalSeconds % 60).toFixed(3);
    return `${minutes}m ${seconds}s`;
}

// ---------------------------------- main ----------------------------------
main();

