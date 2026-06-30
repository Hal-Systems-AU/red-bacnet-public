'use strict';
require('./_alias.js');

const EventEmitter = require('events');

const { print } = require('@root/common/core/util.js')
const { nowFormatted } = require('@root/common/core/util.js')
const { DiscoverDeviceJob } = require('@root/common/job/discover_device.js')
const { getQueue } = require('@root/common/job/global_queue_manager.js')
const { generateUniqueJobId } = require('@root/common/func.js')
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

            // @ts-ignore
            this.jobId = generateUniqueJobId(this.id, 'discoverDevices');
            this.network = +config.network
            this.lowLimit = +config.lowLimit
            this.highLimit = +config.highLimit
            this.whoIsTimeout = +config.whoIsTimeout

            // events
            this.#subscribeListeners();

            // configure job queue - use global queue
            this.job = getQueue();

            // init task
            this.task = new DiscoverDeviceJob(
                this.client,
                this.#eventEmitter,
                this.network,
                this.lowLimit,
                this.highLimit,
                this.whoIsTimeout,
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
                const jobId = (typeof msg.id === 'string' || typeof msg.id === 'number') ? msg.id : this.jobId;

                if (this.job.queue.map(item => item.id).includes(jobId)) {
                    // @ts-ignore
                    print(`Coalesced job: ${jobId}`, true)
                    return;
                }

                this.task.network = (msg.network === undefined) ? this.network : msg.network;
                this.task.lowLimit = (msg.lowLimit === undefined) ? this.lowLimit : msg.lowLimit;
                this.task.highLimit = (msg.highLimit === undefined) ? this.highLimit : msg.highLimit;

                this.job.addJob({
                    id: jobId,
                    task: this.task,
                    priority: Number.isFinite(msg.priority) ? msg.priority : 5,
                });
                // @ts-ignore
                this.status({ fill: 'yellow', shape: 'dot', text: `in queue` });
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

