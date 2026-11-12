'use strict'
require('./_alias.js');

const fs = require('fs');
const path = require('path');

const { facetsStrToObj, getErrMsg } = require('@root/common/func.js')
const { serverConfig } = require('@root/tests/_test_lib/data.js')
const { bacnetUnitMap } = require('@root/common/bacnet_unit.js')

const bacnet = require('@root/ext/node-bacstack/dist/index.js')
const baEnum = bacnet.enum;
const id = baEnum.PropertyIdentifier
const type = baEnum.ObjectTypesSupported
const objType = baEnum.ObjectType
const appTag = baEnum.ApplicationTags

// ref
// https://github.com/fh1ch/node-bacstack-device/blob/master/index.js
// ---------------------------------- constants ----------------------------------
const debugMode = false

const testLibPath = path.join(path.dirname(__dirname), '_test_lib') // eslint-disable-line
const envPath = path.join(testLibPath, 'env.json')
const testSimple = JSON.parse(fs.readFileSync(envPath, 'utf8')).testSimple
const bacnetPointsPath = path.join(testLibPath, testSimple ? 'bacnet_points_simple.json' : 'bacnet_points_full.json')
const bacnetPoints = JSON.parse(fs.readFileSync(bacnetPointsPath, 'utf8'))

const settings = {
    deviceName: serverConfig.deviceName,
    deviceDescription: serverConfig.deviceDescription,
    deviceId: serverConfig.deviceId,
    vendorId: serverConfig.vendorId,
};

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

// ---------------------------------- schedule encoding ----------------------------------
// The vendored encoder can't write constructed / context tagged values (weekly schedule, exception
// schedule, date list), so those are pre-encoded as raw bytes and written as is.
const RAW_TYPE = 'RAW_BYTES'
const asn1 = require('@root/ext/node-bacstack/dist/lib/asn1.js')
const originalEncodeApplicationData = asn1.bacappEncodeApplicationData
asn1.bacappEncodeApplicationData = (buffer, value) => {
    if (value && value.type === RAW_TYPE) {
        value.value.copy(buffer.buffer, buffer.offset)
        buffer.offset += value.value.length
        return
    }
    return originalEncodeApplicationData(buffer, value)
}

const openTag = (n) => (n << 4) | 0x0E
const closeTag = (n) => (n << 4) | 0x0F
const ctxPrimitive = (n, bytes) => [(n << 4) | 0x08 | bytes.length, ...bytes]
// date bytes: year, month, day, day of week. null = any (0xFF)
const dateBytes = (y, m, d) => [y == null ? 0xFF : y - 1900, m ?? 0xFF, d ?? 0xFF, 0xFF]
const appDate = (y, m, d) => [0xA4, ...dateBytes(y, m, d)]
const appTime = (h, m, s = 0) => [0xB4, h, m, s, 0]
const objectIdBytes = (t, instance) => {
    const b = Buffer.alloc(4)
    b.writeUInt32BE(((t << 22) | instance) >>> 0)
    return [...b]
}

// application tagged values
const val = {
    null: () => [0x00],
    bool: (v) => [0x10 | (v ? 1 : 0)],
    real: (v) => {
        const b = Buffer.alloc(4)
        b.writeFloatBE(v)
        return [0x44, ...b]
    },
    string: (v) => {
        const b = Buffer.from(v, 'utf8')
        const len = b.length + 1
        return [...(len <= 4 ? [0x70 | len] : [0x75, len]), 0x00, ...b]
    },
}

const raw = (bytes) => ({ type: RAW_TYPE, value: Buffer.from(bytes) })
// list of [hour, minute, valueBytes]
const timeValueBytes = (list) => list.flatMap(([h, m, v]) => [...appTime(h, m), ...v])

// one weekday of the weekly schedule
const weekDay = (list) => raw([openTag(0), ...timeValueBytes(list), closeTag(0)])

// one SpecialEvent: period bytes + time values + priority
const specialEvent = (periodBytes, list, priority) => raw([
    ...periodBytes,
    openTag(2), ...timeValueBytes(list), closeTag(2),
    ...ctxPrimitive(3, [priority]),
])
const periodCalendarRef = (t, instance) => ctxPrimitive(1, objectIdBytes(t, instance))
const periodDate = (y, m, d) => [openTag(0), ...ctxPrimitive(0, dateBytes(y, m, d)), closeTag(0)]
const periodDateRange = (s, e) => [
    openTag(0), openTag(1), ...appDate(...s), ...appDate(...e), closeTag(1), closeTag(0)
]
const periodWeekNDay = (month, week, dow) => [openTag(0), ...ctxPrimitive(2, [month, week, dow]), closeTag(0)]

// array property, index 0 is the array size (the client reads from index 1)
const arrayProp = (items) => [{ value: items.length, type: appTag.UNSIGNED_INTEGER }, ...items]

// Monday to Friday 08:00 -> value, 17:00 -> null (relinquish), weekend empty
const weeklyMonToFri = (v) => [
    ...Array(5).fill(0).map(() => weekDay([[8, 0, v], [17, 0, val.null()]])),
    weekDay([]), weekDay([]),
]

const anyDate = () => raw([...appDate(null, null, null), ...appDate(null, null, null)])

// ---------------------------------- var ----------------------------------
const dataStore = {};

// ---------------------------------- main function ----------------------------------
async function main() {
    send('Starting BACnet server...')
    initDataStore(bacnetPoints)
    initScheduleStore()

    const server = new bacnet.Client({
        deviceId: serverConfig.deviceId,
        vendorId: serverConfig.vendorId,
        port: serverConfig.port,
        broadcastAddress: serverConfig.broadcastAddress,
    });

    server.on('whoIs', (data) => {
        debug('whoIs')
        debug(data);

        if (data.lowLimit && data.lowLimit > serverConfig.deviceId) return;
        if (data.highLimit && data.highLimit < serverConfig.deviceId) return;
        server.iAmResponse(serverConfig.deviceId, baEnum.Segmentation.SEGMENTATION_BOTH, serverConfig.vendorId);
    });

    server.on('readProperty', (data) => {
        // append port 47808 if not defined
        const address = !data.address.includes(':') ? `${data.address}:47808` : data.address;

        debug('');
        debug(`readProperty ${data.request.objectId.type}:${data.request.objectId.instance}:${data.request.property.id}`);

        const object = dataStore[data.request.objectId.type + ':' + data.request.objectId.instance];

        debug(`object ${JSON.stringify(object)}`);
        if (!object) return server.errorResponse(address, baEnum.ConfirmedServiceChoice.READ_PROPERTY, data.invokeId, baEnum.ErrorClass.OBJECT, baEnum.ErrorCode.UNKNOWN_OBJECT);
        const property = object[data.request.property.id];

        debug(`property ${JSON.stringify(property)}`);
        if (!property) return server.errorResponse(address, baEnum.ConfirmedServiceChoice.READ_PROPERTY, data.invokeId, baEnum.ErrorClass.PROPERTY, baEnum.ErrorCode.UNKNOWN_PROPERTY);
        if (data.request.property.index === 0xFFFFFFFF) {
            server.readPropertyResponse(address, data.invokeId, data.request.objectId, data.request.property, property);
        } else {
            const slot = property[data.request.property.index];
            if (!slot) return server.errorResponse(address, baEnum.ConfirmedServiceChoice.READ_PROPERTY, data.invokeId, baEnum.ErrorClass.PROPERTY, baEnum.ErrorCode.INVALID_ARRAY_INDEX);
            server.readPropertyResponse(address, data.invokeId, data.request.objectId, data.request.property, [slot]);
        }
    });

    server.on('readPropertyMultiple', (data) => {
        const address = !data.address.includes(':') ? `${data.address}:47808` : data.address;

        // Debugging
        debug('');
        debug(`readPropertyMultiple: ${JSON.stringify(data.request)}`);

        const responseList = [];
        const properties = data.request.properties;
        properties.forEach((property) => {
            if (property.objectId.type === objType.DEVICE && property.objectId.instance === serverConfig.deviceId) {
                property.objectId.instance = settings.deviceId;
            }

            const object = dataStore[property.objectId.type + ':' + property.objectId.instance];
            if (!object) return; // Add error?
            const propList = [];
            property.properties.forEach((item) => {
                if (item.id === id.ALL) {
                    for (let key in object) {
                        propList.push({ property: { id: key, index: 0xFFFFFFFF }, value: object[key] });
                    }
                    return;
                }
                const prop = object[item.id];
                let content;
                if (!prop) return; // Add error?
                if (item.index === 0xFFFFFFFF) {
                    content = prop;
                } else {
                    const slot = prop[item.index];
                    if (!prop) return; // Add error?
                    content = [slot];
                }
                propList.push({ property: { id: item.id, index: item.index }, value: content });
            });
            responseList.push({ objectId: { type: property.objectId.type, instance: property.objectId.instance }, values: propList });
        });
        // console.log(responseList)
        try {
            server.readPropertyMultipleResponse(address, data.invokeId, responseList);
        } catch (error) {
            debug(`Error sending readPropertyMultipleResponse: ${getErrMsg(error)}`);
            server.errorResponse(
                address,
                baEnum.ConfirmedServiceChoice.READ_PROPERTY_MULTIPLE,
                data.invokeId,
                baEnum.ErrorClass.SERVICES,
                baEnum.ErrorCode.OTHER
            );
        }
    });

    server.on('writeProperty', (data) => {
        // NOTE did not implement priority, just pure write to memory
        const address = !data.address.includes(':') ? `${data.address}:47808` : data.address;

        debug('');
        debug(`writeProperty ${data.request.objectId.type}:${data.request.objectId.instance}:${data.request.value.property.id}`);

        const object = dataStore[data.request.objectId.type + ':' + data.request.objectId.instance];
        if (!object) return server.errorResponse(address, data.service, data.invokeId, bacnet.enum.ErrorClass.ERROR_CLASS_OBJECT, bacnet.enum.ErrorCode.ERROR_CODE_UNKNOWN_OBJECT);

        let property = object[data.request.value.property.id];
        if (!property) return server.errorResponse(address, data.service, data.invokeId, bacnet.enum.ErrorClass.ERROR_CLASS_PROPERTY, bacnet.enum.ErrorCode.ERROR_CODE_UNKNOWN_PROPERTY);
        if (data.request.value.property.index === 0xFFFFFFFF) {
            property = data.request.value.value;
            object[data.request.value.property.id] = property;
            server.simpleAckResponse(address, data.service, data.invokeId);
        }
    });

    // get length of object
    console.log(`Server started with ${Object.keys(dataStore).length} objects`);
}

const scheduleObject = (instance, name, props) => Object.assign({
    [id.OBJECT_IDENTIFIER]: [{ value: { type: objType.SCHEDULE, instance }, type: type.LOOP }],
    [id.OBJECT_NAME]: [{ value: name, type: type.COMMAND }],
    [id.OBJECT_TYPE]: [{ value: objType.SCHEDULE, type: type.EVENT_ENROLLMENT }],
}, props)

/**
 * Adds schedule and calendar objects (good and bad data) to the data store.
 *  17:0 good - boolean schedule, weekly + every exception form (calendar ref, weekNDay, date, date range)
 *  17:1 good - numeric schedule, unbounded effective period, no exceptions
 *  17:2 good - string schedule, no exceptions
 *  17:3 bad  - only present value exists, every other property is unknown
 *  17:4 bad  - exception schedule refers to a calendar that doesn't exist
 *  17:5 bad  - exception period uses an unknown tag, can't be decoded
 *  6:0       - calendar referenced by 17:0
 *  17:99     - not defined, device returns unknown object
 */
function initScheduleStore() {
    const boolProp = (v) => [{ value: v, type: appTag.BOOLEAN }]

    dataStore[`${objType.CALENDAR}:0`] = {
        [id.OBJECT_IDENTIFIER]: [{ value: { type: objType.CALENDAR, instance: 0 }, type: type.LOOP }],
        [id.OBJECT_NAME]: [{ value: 'Holidays', type: type.COMMAND }],
        [id.OBJECT_TYPE]: [{ value: objType.CALENDAR, type: type.EVENT_ENROLLMENT }],
        [id.PRESENT_VALUE]: boolProp(false),
        [id.DATE_LIST]: [
            raw(ctxPrimitive(0, dateBytes(2027, 10, 18))),
            raw([openTag(1), ...appDate(2027, 12, 24), ...appDate(2027, 12, 26), closeTag(1)]),
            raw(ctxPrimitive(2, [0xFF, 0xFF, 7])),
        ],
    }

    dataStore[`${objType.SCHEDULE}:0`] = scheduleObject(0, 'Good Boolean Schedule', {
        [id.PRESENT_VALUE]: boolProp(false),
        [id.EFFECTIVE_PERIOD]: [raw([...appDate(2026, 1, 1), ...appDate(2026, 12, 31)])],
        [id.SCHEDULE_DEFAULT]: boolProp(false),
        [id.WEEKLY_SCHEDULE]: arrayProp(weeklyMonToFri(val.bool(true))),
        [id.EXCEPTION_SCHEDULE]: arrayProp([
            specialEvent(periodCalendarRef(objType.CALENDAR, 0), [[12, 30, val.bool(false)]], 16),
            specialEvent(periodWeekNDay(0xFF, 0xFF, 7), [[12, 0, val.bool(false)]], 16),
            specialEvent(periodDate(2027, 7, 1), [[5, 30, val.bool(false)]], 8),
            specialEvent(
                periodDateRange([2027, 3, 1], [2027, 3, 5]),
                [[9, 0, val.bool(true)], [10, 15, val.null()]], 1
            ),
        ]),
    })

    dataStore[`${objType.SCHEDULE}:1`] = scheduleObject(1, 'Good Numeric Schedule', {
        [id.PRESENT_VALUE]: [{ value: 21.5, type: appTag.REAL }],
        [id.EFFECTIVE_PERIOD]: [anyDate()],
        [id.SCHEDULE_DEFAULT]: [{ value: 16, type: appTag.REAL }],
        [id.WEEKLY_SCHEDULE]: arrayProp(weeklyMonToFri(val.real(21.5))),
        [id.EXCEPTION_SCHEDULE]: arrayProp([]),
    })

    dataStore[`${objType.SCHEDULE}:2`] = scheduleObject(2, 'Good String Schedule', {
        [id.PRESENT_VALUE]: [{ value: 'world', type: appTag.CHARACTER_STRING }],
        [id.EFFECTIVE_PERIOD]: [anyDate()],
        [id.SCHEDULE_DEFAULT]: [{ value: 'idle', type: appTag.CHARACTER_STRING }],
        [id.WEEKLY_SCHEDULE]: arrayProp([
            weekDay([[8, 0, val.string('hello')], [15, 30, val.null()]]),
            ...Array(6).fill(0).map(() => weekDay([])),
        ]),
        [id.EXCEPTION_SCHEDULE]: arrayProp([]),
    })

    dataStore[`${objType.SCHEDULE}:3`] = scheduleObject(3, 'Bad Missing Properties Schedule', {
        [id.PRESENT_VALUE]: boolProp(true),
    })

    dataStore[`${objType.SCHEDULE}:4`] = scheduleObject(4, 'Bad Calendar Reference Schedule', {
        [id.PRESENT_VALUE]: boolProp(false),
        [id.EFFECTIVE_PERIOD]: [anyDate()],
        [id.SCHEDULE_DEFAULT]: boolProp(false),
        [id.WEEKLY_SCHEDULE]: arrayProp(weeklyMonToFri(val.bool(true))),
        [id.EXCEPTION_SCHEDULE]: arrayProp([
            specialEvent(periodCalendarRef(objType.CALENDAR, 99), [[12, 0, val.bool(false)]], 16),
        ]),
    })

    dataStore[`${objType.SCHEDULE}:5`] = scheduleObject(5, 'Bad Period Schedule', {
        [id.PRESENT_VALUE]: boolProp(false),
        [id.EFFECTIVE_PERIOD]: [anyDate()],
        [id.SCHEDULE_DEFAULT]: boolProp(false),
        [id.WEEKLY_SCHEDULE]: arrayProp(weeklyMonToFri(val.bool(true))),
        [id.EXCEPTION_SCHEDULE]: arrayProp([
            specialEvent([openTag(0), ...ctxPrimitive(5, [1, 2, 3]), closeTag(0)], [[12, 0, val.bool(false)]], 16),
        ]),
    })
}

function initDataStore(data) {
    const objectList = []

    // add data
    data.forEach(i => {
        const unit = +getKeyByValue(bacnetUnitMap, facetsStrToObj(i.facets).unit);
        dataStore[`${i.bacType}:${i.bacInstance}`] = {
            [id.OBJECT_IDENTIFIER]: [{ value: { type: i.bacType, instance: i.bacInstance }, type: type.LOOP }],
            [id.OBJECT_NAME]: [{
                value: i.pointName, type: type.COMMAND,
                // enconding: baEnum.CharacterStringEncoding.UTF_8
            }],
            [id.OBJECT_TYPE]: [{ value: i.bacType, type: type.EVENT_ENROLLMENT }],
            [id.PRESENT_VALUE]: [{ value: i.value, type: i.valueType }],
        };

        // add facets
        if (analogObjectTypes.includes(i.bacType)) {
            if (!isNaN(unit))
                dataStore[`${i.bacType}:${i.bacInstance}`][id.UNITS] = [{
                    value: unit, type: appTag.ENUMERATED,
                    // enconding: baEnum.CharacterStringEncoding.UTF_8
                }];
        } else if (binaryObjectTypes.includes(i.bacType)) {
            dataStore[`${i.bacType}:${i.bacInstance}`][id.INACTIVE_TEXT] = [{
                value: facetsStrToObj(i.facets).falseText, type: appTag.CHARACTER_STRING,
                // enconding: baEnum.CharacterStringEncoding.UTF_8
            }];
            dataStore[`${i.bacType}:${i.bacInstance}`][id.ACTIVE_TEXT] = [{
                value: facetsStrToObj(i.facets).trueText, type: appTag.CHARACTER_STRING,
                // enconding: baEnum.CharacterStringEncoding.UTF_8
            }];
        } else if (multiStateObjectTypes.includes(i.bacType)) {
            const facets = facetsStrToObj(i.facets);
            const stateCount = Object.keys(facets).length;
            dataStore[`${i.bacType}:${i.bacInstance}`][id.NUMBER_OF_STATES] = [{ value: stateCount, type: appTag.UNSIGNED_INTEGER }];
            dataStore[`${i.bacType}:${i.bacInstance}`][id.STATE_TEXT] = Object.entries(facets.range)
                .sort(([keyA], [keyB]) => parseInt(keyA, 10) - parseInt(keyB, 10))
                .map(([, value]) => ({
                    value: value,
                    type: appTag.CHARACTER_STRING,
                    // enconding: baEnum.CharacterStringEncoding.UTF_8
                }));
        }

        objectList.push({ value: { type: i.bacType, instance: i.bacInstance }, type: type.LOOP });
    })

    // add an invalid object
    objectList.push({ value: { type: 0, instance: 5000 }, type: type.LOOP });

    // add device
    dataStore[`${objType.DEVICE}:${settings.deviceId}`] = {
        [id.OBJECT_IDENTIFIER]: [{ value: { type: objType.DEVICE, instance: settings.deviceId }, type: type.LOOP }],
        [id.OBJECT_LIST]: [{ value: { type: objType.DEVICE, instance: settings.deviceId }, type: type.LOOP }].concat(objectList),
        [id.OBJECT_NAME]: [{ value: settings.deviceName, type: type.COMMAND }],
        [id.OBJECT_TYPE]: [{ value: objType.DEVICE, type: type.EVENT_ENROLLMENT }],
        [id.DESCRIPTION]: [{ value: settings.deviceDescription, type: type.COMMAND }]
    }
}

// ---------------------------------- functions ----------------------------------
function debug(msg) {
    if (!debugMode)
        return

    console.log(msg);
    process.send(msg) // eslint-disable-line
}

function send(msg) {
    process.send(msg) // eslint-disable-line
}

// eslint-disable-next-line
process.on('message', (msg) => {
    debug(`Fork message: ${msg}`);
});

const getKeyByValue = (obj, value) => {
    return Object.keys(obj).find(key => obj[key] === value);
};
// ---------------------------------- main ----------------------------------
main();