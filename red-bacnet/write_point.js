'use strict';
require('./_alias.js');

const EventEmitter = require('events');

const { nowFormatted } = require('@root/common/core/util.js')
const { WritePointJob } = require('@root/common/job/write_point.js')
const { CoalescedJobQueue } = require('@root/common/job/core.js')
const {
    EVENT_UPDATE_STATUS, EVENT_ERROR, EVENT_INPUT, EVENT_OUTPUT
} = require('@root/common/core/constant.js')


// -------------------------------- functions --------------------------------
module.exports = function (RED) {
    class WritePoint {
        #eventEmitter = new EventEmitter();

        constructor(config) {
            RED.nodes.createNode(this, config);

            // get config
            this.client = RED.nodes.getNode(config.client).instance;
            this.maxConcurrentDeviceWrite = +config.maxConcurrentDeviceWrite
            this.maxConcurrentPointWrite = +config.maxConcurrentPointWrite
            this.concurrentTaskDelay = +config.concurrentTaskDelay

            // events
            this.#subscribeListeners();

            // configure job queue
            this.job = new CoalescedJobQueue();
            this.job.run();
        }

        #subscribeListeners() {
            /**
             * @param {Object} msg - The message object.
            */
            // @ts-ignore
            this.on(EVENT_INPUT, async function (msg) {
                const task = new WritePointJob(
                    this.client,
                    this.#eventEmitter,
                    msg.devices,
                    msg.points,
                    msg.writePoints,
                    this.maxConcurrentDeviceWrite,
                    this.maxConcurrentPointWrite,
                    this.concurrentTaskDelay
                );

                this.job.addJob({
                    id: (typeof msg.id === 'string' || typeof msg.id === 'number') ? msg.id : 'task',
                    task: task
                });
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
    RED.nodes.registerType('write point', WritePoint);
}
