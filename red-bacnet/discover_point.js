'use strict';
require('./_alias.js');

const EventEmitter = require('events');

const { print } = require('@root/common/core/util.js')
const { nowFormatted } = require('@root/common/core/util.js')
const { DiscoverPointJob } = require('@root/common/job/discover_point.js')
const { getQueue } = require('@root/common/job/global_queue_manager.js')
const {
    EVENT_UPDATE_STATUS, EVENT_ERROR, EVENT_INPUT, EVENT_OUTPUT
} = require('@root/common/core/constant.js')

// -------------------------------- functions --------------------------------
module.exports = function (RED) {
    class DiscoverPoint {
        #eventEmitter = new EventEmitter();

        constructor(config) {
            RED.nodes.createNode(this, config);

            // get config
            this.client = RED.nodes.getNode(config.client).instance;
            this.discoverMode = +config.discoverMode
            this.readMethod = +config.readMethod
            this.groupExportDeviceCount = +config.groupExportDeviceCount
            this.maxConcurrentDeviceRead = +config.maxConcurrentDeviceRead
            this.maxConcurrentSinglePointRead = +config.maxConcurrentSinglePointRead
            this.concurrentTaskDelay = +config.concurrentTaskDelay

            // events
            this.#subscribeListeners();

            // configure job queue - use global queue
            this.job = getQueue();
        }

        #subscribeListeners() {
            /**
             * @param {Object} msg - The message object.
            */
            // @ts-ignore
            this.on(EVENT_INPUT, async function (msg) {
                const jobId = (typeof msg.id === 'string' || typeof msg.id === 'number') ? msg.id : 'discoverPoints';

                if (this.job.queue.map(item => item.id).includes(jobId)) {
                    // @ts-ignore
                    print(`Coalesced job: ${jobId}`, true)
                    return;
                }

                const task = new DiscoverPointJob(
                    this.client, this.#eventEmitter, msg?.devices, this.discoverMode, this.readMethod,
                    this.groupExportDeviceCount, this.maxConcurrentDeviceRead,
                    this.maxConcurrentSinglePointRead, this.concurrentTaskDelay
                );

                this.job.addJob({
                    id: jobId,
                    task: task,
                    priority: Number.isFinite(msg.priority) ? msg.priority : 5,
                });
                // @ts-ignore
                this.status({ fill: 'yellow', shape: 'dot', text: `in queue` });
            });

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
    RED.nodes.registerType('discover point', DiscoverPoint);
}
