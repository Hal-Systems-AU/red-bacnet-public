'use strict';
require('./_alias.js');

const EventEmitter = require('events');

const { print } = require('@root/common/core/util.js')
const { nowFormatted } = require('@root/common/core/util.js')
const { DiscoverDeviceJob } = require('@root/common/job/discover_device.js')
const { CoalescedJobQueue } = require('@root/common/job/core.js')
const {
    EVENT_UPDATE_STATUS, EVENT_ERROR, EVENT_INPUT, EVENT_OUTPUT, EVENT_CLOSE
} = require('@root/common/core/constant.js')


// -------------------------------- functions --------------------------------
// coalesced job remove on start and on stop, move it to here
module.exports = function (RED) {
    class DiscoverDevice {
        #eventEmitter = new EventEmitter();

        constructor(config) {
            RED.nodes.createNode(this, config);

            // get config
            this.client = RED.nodes.getNode(config.client).instance;

            this.network = +config.network
            this.lowLimit = +config.lowLimit
            this.highLimit = +config.highLimit
            this.whoIsTimeout = +config.whoIsTimeout
            this.readDeviceTimeout = +config.readDeviceTimeout

            // events
            this.#subscribeListeners();

            // configure job queue
            this.job = new CoalescedJobQueue();
            this.job.run();

            // init task
            this.task = new DiscoverDeviceJob(
                this.client,
                this.#eventEmitter,
                this.network,
                this.lowLimit,
                this.highLimit,
                this.whoIsTimeout,
                this.readDeviceTimeout
            );
            this.task.onStart();
        }

        #subscribeListeners() {
            /**
             * @param {Object} msg - The message object.
            */
            // @ts-ignore
            this.on(EVENT_INPUT, async function (msg) {
                /*
                BACnet iAm handler is causing memory leak due to unable to detach after use
                as a result, workaround is introduce before strategy to reuse discoverDeviceJob instead
                of creating new one every time onInput is triggered
                */
                if (this.job.queue.length > 0) {
                    print('Coalesced job: discoverDevices', true)
                    return
                }

                this.task.network = (msg.network === undefined) ? this.network : msg.network;
                this.task.lowLimit = (msg.lowLimit === undefined) ? this.lowLimit : msg.lowLimit;
                this.task.highLimit = (msg.highLimit === undefined) ? this.highLimit : msg.highLimit;

                this.job.addJob({
                    id: (typeof msg.id === 'string' || typeof msg.id === 'number') ? msg.id : 'task',
                    task: this.task
                });
            });

            // @ts-ignore
            this.on(EVENT_CLOSE, () => {
                this.task.onStop();
            })

            this.#eventEmitter.on(EVENT_OUTPUT, (data) => {
                const msg = {
                    payload: data
                };
                // @ts-ignore
                this.send(msg);
            });

            this.#eventEmitter.on(EVENT_UPDATE_STATUS, (msg) => {
                if (msg === 100)
                    // @ts-ignore
                    this.status({ fill: 'green', shape: 'dot', text: `completed: ${nowFormatted()}` });
                else
                    // @ts-ignore
                    this.status({ fill: 'yellow', shape: 'dot', text: `progress: ${msg} %` });
            });

            this.#eventEmitter.on(EVENT_ERROR, (err) => {
                // @ts-ignore
                this.error(err);
            });
        }
    }

    // ----- register node -----
    RED.nodes.registerType('discover device', DiscoverDevice);
}

