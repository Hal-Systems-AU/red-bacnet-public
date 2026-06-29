'use strict';
require('./_alias.js');

const { print } = require('@root/common/core/util.js');
const {
    ERR_CONSTRUCT_ABSTRACT_JOB, ERR_ONSTART_NOT_IMPLEMENTED,
    ERR_ONSTOP_NOT_IMPLEMENTED, ERR_EXECUTE_NOT_IMPLEMENTED
} = require('@root/common/core/constant.js')

/**
 * Abstract base class for job implementations.
 *
 * This is an abstract class that cannot be instantiated directly. Subclasses must implement
 * the lifecycle methods: onStart(), execute(), and onStop().
 *
 * @abstract
 * @class BaseJob
 * @example
 * class MyJob extends BaseJob {
 *     async onStart() {
 *         // Initialize job resources
 *     }
 *
 *     async execute() {
 *         // Perform the job's main work
 *     }
 *
 *     async onStop() {
 *         // Clean up job resources
 *     }
 * }
 */
class BaseJob {
    /**
     * Creates a new BaseJob instance.
     *
     * @constructor
     * @throws {TypeError} If attempting to instantiate BaseJob directly (must subclass it).
     */
    constructor() {
        if (new.target === BaseJob) {
            throw new TypeError(ERR_CONSTRUCT_ABSTRACT_JOB);
        }
    }

    /**
     * Lifecycle method called when the job starts.
     *
     * Subclasses should override this method to perform initialization tasks such as
     * setting up resources, connections, or state.
     *
     * @async
     * @returns {Promise<void>}
     * @throws {Error} If not implemented by subclass.
     */
    async onStart() {
        throw new Error(ERR_ONSTART_NOT_IMPLEMENTED);
    }

    /**
     * Main execution method for the job.
     *
     * Subclasses must override this method to implement the core job logic.
     * This method is called by the job queue to execute the job's work.
     *
     * @async
     * @returns {Promise<void>}
     * @throws {Error} If not implemented by subclass.
     */
    async execute() {
        throw new Error(ERR_EXECUTE_NOT_IMPLEMENTED);
    }

    /**
     * Lifecycle method called when the job stops.
     *
     * Subclasses should override this method to perform cleanup tasks such as
     * closing connections, releasing resources, or saving state.
     *
     * @async
     * @returns {Promise<void>}
     * @throws {Error} If not implemented by subclass.
     */
    async onStop() {
        throw new Error(ERR_ONSTOP_NOT_IMPLEMENTED);
    }
}

/**
 * A priority-based job queue that coalesces duplicate jobs.
 *
 * This class manages a queue of jobs that are executed asynchronously with support for:
 * - Priority-based execution (lower priority number = higher execution priority)
 * - Job coalescing (duplicate job IDs are not added to the queue)
 * - FIFO ordering for jobs with equal priority
 * - Configurable delay between job processing cycles
 *
 * @class CoalescedJobQueue
 * @example
 * const queue = new CoalescedJobQueue(1000, true, 5);
 * queue.addJob({ id: 'job1', task: myJobInstance, priority: 2 });
 * queue.addJob({ id: 'job2', task: anotherJobInstance, priority: 5 });
 * await queue.run(); // Starts processing jobs indefinitely
 */
class CoalescedJobQueue {
    /**
     * Whether the job queue is currently running.
     * @type {boolean}
     */
    isRunning = false

    /**
     * Creates a new CoalescedJobQueue instance.
     *
     * @constructor
     * @param {number} [delay=100] - Delay in milliseconds between job processing cycles.
     * @param {boolean} [showLog=true] - Whether to log when jobs are coalesced (duplicate IDs).
     * @param {number} [defaultPriority=10] - Default priority for jobs when not specified (0-10, lower = higher priority).
     */
    constructor(delay = 100, showLog = true, defaultPriority = 10) {
        this.queue = [];
        this.delay = delay;
        this.showLog = showLog;
        this.defaultPriority = defaultPriority;
    }

    /**
     * Starts indefinitely running jobs from the queue.
     *
     * Continuously processes jobs in the queue until stop() is called. Jobs are executed
     * in priority order (lower priority number = higher execution priority). If multiple
     * jobs have the same priority, they are executed in FIFO order (earliest first).
     * If the queue is empty, waits for the configured delay before checking again.
     *
     * @async
     * @returns {Promise<void>}
     * @example
     * const queue = new CoalescedJobQueue();
     * // Start the queue in the background
     * queue.run().catch(err => console.error('Queue error:', err));
     * // Add jobs...
     * // Later, stop the queue
     * queue.stop();
     */
    async run() {
        this.isRunning = true;
        while (this.isRunning) {
            if (this.queue.length > 0) {
                // Get the job with the lowest priority number (highest priority)
                // If priorities are equal, use FIFO (earliest timestamp first)
                const jobIndex = this.queue.reduce((minIndex, job, index) => {
                    const minJob = this.queue[minIndex];
                    if (job.priority < minJob.priority) {
                        return index;
                    } else if (job.priority === minJob.priority && job.timestamp < minJob.timestamp) {
                        return index;
                    }
                    return minIndex;
                }, 0);

                const job = this.queue.splice(jobIndex, 1)[0];
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
     * Adds a job to the queue with optional priority.
     *
     * If a job with the same ID already exists in the queue, it will not be added again
     * (job coalescing). If showLog is enabled, a message will be logged when a job is coalesced.
     *
     * @param {Object} job - The job object to add to the queue.
     * @param {string} job.id - Unique identifier for the job. Duplicate IDs will be coalesced.
     * @param {Object} job.task - The job task instance (must be a subclass of BaseJob).
     * @param {number} [job.priority] - Priority level for execution (0-10, lower = higher priority).
     *                                   If not specified, uses this.defaultPriority.
     * @returns {void}
     * @example
     * queue.addJob({
     *     id: 'discover-points',
     *     task: new DiscoverPointsJob(),
     *     priority: 3
     * });
     */
    addJob(job) {
        if (this.queue.map(item => item.id).includes(job.id)) {
            if (this.showLog)
                print(`Coalesced job: ${job.id}`, true)
            return
        }

        const priority = typeof job.priority === 'number' ? job.priority : this.defaultPriority;

        this.queue.push({
            id: job.id,
            task: job.task,
            priority: priority,
            timestamp: Date.now()
        })
    }

    /**
     * Stops the job queue process.
     *
     * Sets isRunning to false, which will cause the run() loop to exit after the current
     * job completes and the next delay cycle finishes.
     *
     * @returns {void}
     * @example
     * queue.stop();
     */
    stop() {
        this.isRunning = false;
    }
}

// ---------------------------------- export ----------------------------------
module.exports = {
    BaseJob,
    CoalescedJobQueue
};
