'use strict'

module.exports = {
    // bacnet event
    EVENT_I_AM: 'iAm',

    // nodered event
    EVENT_INPUT: 'input',
    EVENT_CLOSE: 'close',

    // event
    EVENT_UPDATE_STATUS: 'updateStatus',
    EVENT_ERROR: 'error',
    EVENT_OUTPUT: 'output',

    // error
    ERR_GENERIC: 'An error occurred, please contact support',
    ERR_INVALID_DATA_TYPE: 'Invalid data type',
    ERR_SCHEMA_VALIDATION: 'Schema validation error',
    ERR_IGNORE_DUPLICATED_DEVICE_NAME: 'Ignore duplicated device name',
    ERR_READING_POINTS: 'Error reading points',
    ERR_DUPLICATED_DEVICE_NAME: 'Duplicated device name',
    ERR_DUPLICATED_POINT_ID: 'Duplicated point id',
    ERR_POINT_NOT_ATTACHED_TO_DEVICE: 'Point is not attached to any devices',
    ERR_READING_POINT: 'Error reading point',
    ERR_WRITE_POINT_NOT_FOUND: 'Write point not found in points config',
    ERR_WRITE_POINT_INVALID_PRIORITY: 'Write point invalid priority',
    ERR_EMPTY_DATA: 'Empty data',
    ERR_WRITING_POINT: 'Error writing point',

    // job error
    ERR_CONSTRUCT_ABSTRACT_JOB: 'Cannot construct abstract Job class',
    ERR_ONSTART_NOT_IMPLEMENTED: 'OnStart method is not implemented.',
    ERR_ONSTOP_NOT_IMPLEMENTED: 'OnStop method is not implemented.',
    ERR_EXECUTE_NOT_IMPLEMENTED: 'Execute method is not implemented.',
}