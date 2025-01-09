'use strict'
require('../_alias.js');

const { facetsStrToObj } = require('@root/common/func.js')
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
const settings = {
    deviceName: 'BacServer',
    deviceDescription: 'BacServer',
    deviceId: 888,
    vendorId: 7
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

// ---------------------------------- var ----------------------------------
const dataStore = {};

// ---------------------------------- main function ----------------------------------
async function main() {
    const server = new bacnet.Client({
        deviceId: serverConfig.deviceId,
        vendorId: serverConfig.vendorId,
        port: serverConfig.port,
        broadcastAddress: serverConfig.broadcastAddress,
    });

    server.on('whoIs', (data) => {
        debug(`whoIs: ${JSON.stringify(data)}`);

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

function initDataStore(data) {
    const objectList = []

    // add data
    data.forEach(i => {
        const unit = +getKeyByValue(bacnetUnitMap, facetsStrToObj(i.facets).unit);
        dataStore[`${i.bacType}:${i.bacInstance}`] = {
            [id.OBJECT_IDENTIFIER]: [{ value: { type: i.bacType, instance: i.bacInstance }, type: type.LOOP }],
            [id.OBJECT_NAME]: [{ value: i.pointName, type: type.COMMAND }],
            [id.OBJECT_TYPE]: [{ value: i.bacType, type: type.EVENT_ENROLLMENT }],
            [id.PRESENT_VALUE]: [{ value: i.value, type: i.valueType }],
        };

        // add facets
        if (analogObjectTypes.includes(i.bacType)) {
            if (!isNaN(unit))
                dataStore[`${i.bacType}:${i.bacInstance}`][id.UNITS] = [{ value: unit, type: appTag.ENUMERATED }];
        } else if (binaryObjectTypes.includes(i.bacType)) {
            dataStore[`${i.bacType}:${i.bacInstance}`][id.INACTIVE_TEXT] = [{ value: facetsStrToObj(i.facets).falseText, type: appTag.CHARACTER_STRING }];
            dataStore[`${i.bacType}:${i.bacInstance}`][id.ACTIVE_TEXT] = [{ value: facetsStrToObj(i.facets).trueText, type: appTag.CHARACTER_STRING }];
        } else if (multiStateObjectTypes.includes(i.bacType)) {
            const facets = facetsStrToObj(i.facets);
            const stateCount = Object.keys(facets).length;
            dataStore[`${i.bacType}:${i.bacInstance}`][id.NUMBER_OF_STATES] = [{ value: stateCount, type: appTag.UNSIGNED_INTEGER }];
            dataStore[`${i.bacType}:${i.bacInstance}`][id.STATE_TEXT] = Object.entries(facets.range)
                .sort(([keyA], [keyB]) => parseInt(keyA, 10) - parseInt(keyB, 10))
                .map(([, value]) => ({
                    value: value,
                    type: appTag.CHARACTER_STRING
                }));
        }

        objectList.push({ value: { type: i.bacType, instance: i.bacInstance }, type: type.LOOP });
    })

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
    if (debugMode)
        console.log(msg);
}

// eslint-disable-next-line
process.on('message', (msg) => {
    // debug(`BACnet server message: ${msg}`);
    initDataStore(msg)
    main()
});

const getKeyByValue = (obj, value) => {
    return Object.keys(obj).find(key => obj[key] === value);
};
// ---------------------------------- main ----------------------------------
// main();