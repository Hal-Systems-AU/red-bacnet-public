'use strict'
require('./_alias.js');

const bacnet = require('@root/ext/node-bacstack/dist/index.js')
const baEnum = bacnet.enum;

const { BaseJob } = require('@root/common/job/core.js');
const { bacnetDeviceSchema } = require('@root/common/schema.js');
const { EVENT_I_AM, EVENT_UPDATE_STATUS, EVENT_ERROR, EVENT_OUTPUT } = require('@root/common/core/constant.js');
const { errMsg, getErrMsg } = require('@root/common/func.js');
const { ERR_GENERIC, ERR_SCHEMA_VALIDATION } = require('@root/common/core/constant.js');

// ---------------------------------- type def ----------------------------------
/**
 * @typedef {import('events').EventEmitter} EventEmitter
 * @typedef {import('@root/ext/node-bacstack/dist/index.js').Client} BacnetClient
 */

// ---------------------------------- export ----------------------------------
module.exports = {
    DiscoverDeviceJob: class DiscoverDeviceJob extends BaseJob {
        knownDevices = new Set();
        discoverList = [];
        discoveredDevices = [];

        /**
         * Construct a DiscoverDeviceJob.
         * @param {BacnetClient} client - Bacnet client to use for the discovery.
         * @param {EventEmitter} eventEmitter - Status and error event emitter.
         * @param {number} network - Network to discover devices on, eg: 65535 / 1 / 1001
         * @param {number} lowLimit - Low limit of the network range.
         * @param {number} highLimit - High limit of the network range.
         * @param {number} whoIsTimeout - Who is request timeout in milliseconds.
         * @param {number} readDeviceNameTimeout - Read device name timeout in milliseconds.
         */
        constructor(
            client, eventEmitter, network, lowLimit, highLimit, whoIsTimeout, readDeviceNameTimeout,
            name = 'discover device'
        ) {
            super();
            this.client = client
            this.eventEmitter = eventEmitter
            this.network = network
            this.lowLimit = lowLimit
            this.highLimit = highLimit
            this.whoIsTimeout = whoIsTimeout
            this.readDeviceNameTimeout = readDeviceNameTimeout
            this.name = name
        }

        async onStart() {
            this.client.on(EVENT_I_AM, this.#iAmHandler.bind(this))
        }
        async onStop() {
            this.client.removeListener(EVENT_I_AM, this.#iAmHandler.bind(this))
        }

        async execute() {
            // discover device job will be reuse
            this.knownDevices.clear()
            this.discoverList = [];
            this.discoveredDevices = [];

            this.#updateProgress(0)

            return new Promise((resolve, reject) => {
                try {
                    this.client.whoIs({ net: this.network, lowLimit: this.lowLimit, highLimit: this.highLimit })

                    setTimeout(() => {
                        this.#updateProgress(10)

                        this.#readDevices().then(() => {
                            let validatedDevices = [];
                            for (let i = 0; i < this.discoveredDevices.length; i++) {
                                const device = this.discoveredDevices[i];
                                const { error, value: result } = bacnetDeviceSchema.validate(device);

                                if (error) {
                                    this.eventEmitter.emit(EVENT_ERROR, errMsg(
                                        this.name, `BACnet device schema validation error (${device.deviceId})`, error
                                    ))
                                    this.eventEmitter.emit(EVENT_ERROR, errMsg(
                                        this.name, `${ERR_SCHEMA_VALIDATION} (${device.deviceId})`, error
                                    ))
                                    continue;
                                }
                                validatedDevices.push(result);
                            }

                            this.eventEmitter.emit(EVENT_OUTPUT, validatedDevices);
                            this.#updateProgress(100)
                            resolve();
                        }).catch(error => {
                            this.#updateProgress(100)
                            reject(error);
                        });
                    }, this.whoIsTimeout);
                } catch (err) {
                    this.eventEmitter.emit(EVENT_ERROR, errMsg(this.name, ERR_GENERIC, getErrMsg(err)))
                    resolve();
                }
            });
        }

        /**
         * Reads device names from the list of discovered devices.
         * @returns {Promise<void>}
         */
        async #readDevices() {
            const chunkSize = 100;
            const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

            const readDeviceName = (d, addressSet) => {
                return new Promise((resolve) => {
                    this.client.readProperty(addressSet,
                        { type: baEnum.ObjectType.DEVICE, instance: d.deviceId },
                        baEnum.PropertyIdentifier.OBJECT_NAME,
                        { maxApdu: d.maxApdu },
                        (err, value) => {
                            const deviceInfo = {
                                deviceId: d.deviceId,
                                network: d.net,
                                ipAddress: d.address,
                                macAddress: d.adr,
                                segmentation: d.segmentation,
                                maxApdu: d.maxApdu,
                                vendorId: d.vendorId
                            };

                            if (!err) {
                                deviceInfo.deviceName = value?.values?.[0].value;
                            }

                            resolve(deviceInfo);
                        }
                    );
                });
            };

            for (let i = 0; i < this.discoverList.length; i += chunkSize) {
                const chunk = this.discoverList.slice(i, i + chunkSize);

                const promises = chunk.map(d => {
                    let addressSet = d.address;
                    if (d.adr !== undefined && d.net !== undefined) {
                        addressSet = { ip: d.address, adr: d.adr, net: d.net };
                    }

                    return readDeviceName(d, addressSet)
                        .then(deviceInfo => this.discoveredDevices.push(deviceInfo));
                });

                await Promise.allSettled(promises);
                await delay(this.readDeviceNameTimeout);

                // update progress
                this.#updateProgress(
                    Math.min(90, Math.round((80 / this.discoverList.length) * (i + chunkSize) + 10))
                )
            }

            this.#updateProgress(90)
        }

        #iAmHandler(device) {
            const deviceId = device.deviceId
            const address = device.address
            const segmentation = device.segmentation
            const maxApdu = device.maxApdu
            const vendorId = device.vendorId
            const adr = device.adr
            const net = device.net

            if (this.knownDevices.has(deviceId)) return;
            this.discoverList.push({
                deviceId: deviceId,
                address: address,
                segmentation: segmentation,
                maxApdu: maxApdu,
                vendorId: vendorId,
                adr: adr,
                net: net
            });

            this.knownDevices.add(deviceId);
        }

        #updateProgress(progress) {
            this.eventEmitter.emit(EVENT_UPDATE_STATUS, progress);
        }
    },
}