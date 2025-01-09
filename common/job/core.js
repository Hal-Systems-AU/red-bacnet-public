'use strict';
require('./_alias.js');

const { print } = require('@root/common/core/util.js');
const {
    ERR_CONSTRUCT_ABSTRACT_JOB, ERR_ONSTART_NOT_IMPLEMENTED,
    ERR_ONSTOP_NOT_IMPLEMENTED, ERR_EXECUTE_NOT_IMPLEMENTED
} = require('@root/common/core/constant.js')

// ---------------------------------- export ----------------------------------
module.exports = {
    BaseJob: class {
        constructor() {
            if (new.target === module.exports.BaseJob) {
                throw new TypeError(ERR_CONSTRUCT_ABSTRACT_JOB);
            }
        }

        async onStart() {
            throw new Error(ERR_ONSTART_NOT_IMPLEMENTED);
        }

        async execute() {
            throw new Error(ERR_EXECUTE_NOT_IMPLEMENTED);
        }

        async onStop() {
            throw new Error(ERR_ONSTOP_NOT_IMPLEMENTED);
        }
    },

    CoalescedJobQueue: class {
        isRunning = false

        /**
         * Create a new CoalescedJob.
         * @param {number} [delay=1000] - Delay in milliseconds between coalesced job runs.
         * @param {boolean} [showLog=true] - Whether to log coalesced jobs.
         */
        constructor(delay = 1000, showLog = true,) {
            this.queue = [];
            this.delay = delay;
            this.showLog = showLog;
        }

        /**
         * Start indefinitely running the first job in the queue.
         * If there are no jobs in the queue, wait for the delay before checking again.
         * @async
         */
        async run() {
            this.isRunning = true;
            while (this.isRunning) {
                if (this.queue.length > 0) {
                    const job = this.queue.shift();
                    try {
                        await job.task.execute();
                    } catch (error) {
                        console.error(`Error executing job ${job.id}:`, error);
                    }
                }
                await new Promise(resolve => setTimeout(resolve, this.delay));
            }
        }

        /**
         * Add a job to the queue.
         * If the job with the same id is already in the queue, do not add it.
         * If showLog is true, log a message when a job is coalesced.
         * @param {Object} job - { id: string, task: BaseJob }
         */
        addJob(job) {
            if (this.queue.map(item => item.id).includes(job.id)) {
                if (this.showLog)
                    print(`Coalesced job: ${job.id}`, true)
                return
            }

            this.queue.push({
                id: job.id,
                task: job.task
            })
        }

        /**
         * Stops the job queue process.
         */
        stop() {
            this.isRunning = false;
        }
    }
}