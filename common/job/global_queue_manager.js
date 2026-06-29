'use strict';

require('./_alias.js');

const { CoalescedJobQueue } = require('@root/common/job/core.js');
const { ERR_GLOBAL_QUEUE_WORKER_ERROR } = require('@root/common/core/constant.js');

// ---------------------------------- Singleton State ----------------------------------
let globalQueue = null;
let workerPromise = null;
let workerRunning = false;
let stopping = false;

// ---------------------------------- Worker Control ----------------------------------
function startWorker() {
    if (!globalQueue || stopping || workerRunning) return;

    workerRunning = true;

    const loop = async () => {
        try {
            await globalQueue.run();
        } catch (error) {
            console.error(`${ERR_GLOBAL_QUEUE_WORKER_ERROR}:`, error);
        } finally {
            workerRunning = false;
            workerPromise = null;
        }

        // Self-healing: restart after short delay if still active
        if (globalQueue && !stopping) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
            startWorker();
        }
    };

    workerPromise = loop();
}

// ---------------------------------- Teardown Helper ----------------------------------
/**
 * Shared teardown logic used by both shutdown() and reset().
 * Returns a promise that resolves once any in-flight worker has finished.
 */
async function teardown() {
    stopping = true;

    if (globalQueue) {
        globalQueue.stop();
        globalQueue = null;
    }

    // Await in-flight work rather than abandoning it
    if (workerPromise) {
        try {
            await workerPromise;
        } catch {
            // Worker errors are already logged inside loop(); swallow here
        }
    }

    workerPromise = null;
    workerRunning = false;
}

// ---------------------------------- Module Exports ----------------------------------
module.exports = {
    /**
     * Get or create the global queue singleton.
     * Safe to call multiple times; starts the worker if not already running.
     */
    getQueue() {
        if (!globalQueue) {
            stopping = false;
            globalQueue = new CoalescedJobQueue(100, true, 5);
        }

        if (!globalQueue.isRunning && !stopping) {
            startWorker();
        }

        return globalQueue;
    },

    /**
     * Initialize queue (Node-RED startup hook).
     */
    async initialize() {
        this.getQueue();
    },

    /**
     * Graceful shutdown. Stops the queue and awaits any in-flight worker.
     * After this, the module is inert until getQueue() is called again.
     *
     * @returns {Promise<void>}
     */
    async shutdown() {
        await teardown();
    },

    /**
     * Full cycle reset (testing utility).
     * Tears down the current queue and immediately initialises a fresh one.
     *
     * @returns {Promise<void>}
     */
    async reset() {
        await teardown();
        this.getQueue();
    },
};