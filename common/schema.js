'use strict'

const Joi = require('joi');

// ---------------------------------- export ----------------------------------
module.exports = {
    bacnetDeviceSchema: Joi.object({
        deviceName: Joi.string().allow('').default(''),
        deviceId: Joi.number().min(0).max(4194302).required(),
        network: Joi.number().min(0).max(65534).allow(null).default(null),
        ipAddress: Joi.string().required().custom((value, helpers) => {
            const [ip, port] = value.split(':');
            const ipSchema = Joi.string().ip();
            const portSchema = Joi.number().port();

            const { error: ipError } = ipSchema.validate(ip);
            const { error: portError } = portSchema.validate(port);

            if (ipError || portError) {
                return helpers.error('any.invalid');
            }
            return value;
        }),
        macAddress: Joi.array().items(Joi.number()).allow(null).default(null),
        segmentation: Joi.number().allow(null).default(null),
        maxApdu: Joi.number().allow(null).default(null),
        vendorId: Joi.number().required(),
    }),

    bacnetObjectListSchema: Joi.object({
        type: Joi.number().required(),
        value: Joi.object({
            type: Joi.number().required(),
            instance: Joi.number().required()
        }).required()
    }),

    bacnetPointSchema: Joi.object({
        deviceName: Joi.string().allow('').default(''),
        pointName: Joi.string().allow('').default(''),
        bacType: Joi.number().required(),
        bacInstance: Joi.number().required(),
        bacProp: Joi.number().required(),
        valueType: Joi.number().required(),
        value: Joi.any().default(''),
        facets: Joi.string().allow('').default(''),
        priority: Joi.number().min(0).max(16) // use by write property
    }),

    readPointSchema: Joi.object({
        value: Joi.alternatives().try(
            Joi.number(),
            Joi.string()
        ).required(),
        fvalue: Joi.string().allow('').required(),
        err: Joi.string().allow(''),
    }),

    writePointSchema: Joi.object().pattern(
        Joi.string().required(),
        Joi.alternatives().try(
            Joi.number().allow(null),
            Joi.boolean()
        ).required()
    ),
}