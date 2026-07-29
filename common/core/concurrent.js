'use strict';
require('./_alias.js');

const { EVENT_OUTPUT, EVENT_ERROR } = require('@root/common/core/constant.js');
const { delay } = require('@root/common/core/util.js');

// ---------------------------------- type def ----------------------------------
/**
 * @typedef {import('events').EventEmitter} EventEmitter
 */

// ---------------------------------- export ----------------------------------
module.exports = {
    /**
     * Executes a list of tasks concurrently with a maximum concurrency limit.
     *
     * @param {EventEmitter} eventEmitter - The event emitter to emit events to.
     * @param {Array} tasks - The list of tasks to execute.
     * @param {number} maxConcurrent - The maximum number of concurrent tasks.
     * @param {number} concurrentTaskDelay - The delay between concurrent tasks.
     * @returns {Promise<Array>} - A promise that resolves with an array of results.
     * @async
    */
    concurrentTasks: async function (
        eventEmitter, tasks, maxConcurrent, concurrentTaskDelay = 50
    ) {
        const executing = new Set();
        const results = [];

        for (const { id, task } of tasks) {
            const promise = task()
                .then(result => {
                    executing.delete(promise);
                    eventEmitter.emit(EVENT_OUTPUT, { id, result });
                    results.push({ id, result });
                    return result;
                })
                .catch(error => {
                    executing.delete(promise);
                    eventEmitter.emit(EVENT_ERROR, { id, error });
                    results.push({ id, error });
                });

            executing.add(promise);

            if (executing.size >= maxConcurrent) {
                await Promise.race(executing);
            }

            if (concurrentTaskDelay > 0)
                await delay(concurrentTaskDelay)
        }

        await Promise.allSettled(executing);
        return results;
    },

    /**
     * Executes a list of tasks concurrently with IP address awareness.
     * Tasks targeting the same IP address will execute sequentially.
     * Tasks targeting different IP addresses can execute in parallel.
     * Invoke IDs are automatically managed per-task to avoid collisions.
     *
     * @param {EventEmitter} eventEmitter - The event emitter to emit events to.
     * @param {Array} tasks - The list of tasks to execute. Each task should have:
     *                        { id, device: { ipAddress, ... }, task: async (getNextInvokeId) => {...} }
     * @param {number} maxConcurrent - The maximum number of concurrent tasks.
     * @param {number} concurrentTaskDelay - The delay between concurrent tasks.
     * @returns {Promise<Array>} - A promise that resolves with an array of results.
     * @async
    */
    concurrentTasksWithNetworkAwareness: async function (
        eventEmitter, tasks, maxConcurrent, concurrentTaskDelay = 50
    ) {
        const executing = new Set();
        const results = [];
        const ipAddressInUse = new Set(); // Track which IPs are currently executing

        // Create a sequential invoke ID generator with tracking
        let invokeIdCounter = 1;
        const invokeIdsInUse = new Set(); // Track which invoke IDs are currently in use

        // Pending tasks that have not been started yet.
        // We keep them in a list and remove them once scheduled so that a
        // task blocked by a busy IP never blocks later tasks with free IPs.
        const pending = tasks.map(({ id, device, task }) => ({
            id,
            task,
            // Extract IP address from device (handle "ip:port" format)
            ipAddress: device?.ipAddress ? device.ipAddress.split(':')[0] : null,
        }));

        /**
         * Start a single task and wire up its lifecycle. When the task settles
         * it releases its IP so waiting tasks targeting the same IP can run.
         * Creates a per-task invoke ID generator that tracks and releases IDs.
         *
         * @param {{id: any, task: Function, ipAddress: string|null}} item
         */
        const startTask = (item) => {
            const { id, task, ipAddress } = item;
            if (ipAddress) ipAddressInUse.add(ipAddress);

            // Track invoke IDs issued to this specific task
            const taskInvokeIds = new Set();

            // Create a task-scoped getNextInvokeId function that:
            // 1. Finds the next available invoke ID (1-255)
            // 2. Skips IDs already in use
            // 3. Tracks the ID for later release
            const taskGetNextInvokeId = () => {
                let attempts = 0;
                while (attempts < 255) {
                    const candidateId = invokeIdCounter++;
                    if (invokeIdCounter > 255) invokeIdCounter = 1;

                    // If this ID is not in use, claim it
                    if (!invokeIdsInUse.has(candidateId)) {
                        invokeIdsInUse.add(candidateId);
                        taskInvokeIds.add(candidateId);
                        return candidateId;
                    }
                    attempts++;
                }

                // Fallback: if all 255 IDs are exhausted (shouldn't happen with proper concurrency limits),
                // just return the next ID anyway
                const fallbackId = invokeIdCounter++;
                if (invokeIdCounter > 255) invokeIdCounter = 1;
                invokeIdsInUse.add(fallbackId);
                taskInvokeIds.add(fallbackId);
                return fallbackId;
            };

            const promise = task(taskGetNextInvokeId)
                .then(result => {
                    eventEmitter.emit(EVENT_OUTPUT, { id, result });
                    results.push({ id, result });
                })
                .catch(error => {
                    eventEmitter.emit(EVENT_ERROR, { id, error });
                    results.push({ id, error });
                })
                .finally(() => {
                    executing.delete(promise);
                    // Release the IP address so waiting tasks can run
                    if (ipAddress) ipAddressInUse.delete(ipAddress);
                    // Release all invoke IDs that were issued to this task
                    for (const invokeId of taskInvokeIds) {
                        invokeIdsInUse.delete(invokeId);
                    }
                });

            executing.add(promise);
        };

        /**
         * Schedule as many pending tasks as possible, respecting both the
         * global concurrency limit and per-IP exclusivity. Scans the whole
         * pending list (not just the head) so a busy IP does not block later
         * tasks targeting free IPs.
         *
         * @async
         */
        const scheduleAvailable = async () => {
            let i = 0;
            while (i < pending.length && executing.size < maxConcurrent) {
                const candidate = pending[i];

                // Skip (leave in queue) if this IP is currently in use
                if (candidate.ipAddress && ipAddressInUse.has(candidate.ipAddress)) {
                    i++;
                    continue;
                }

                // Remove from pending and start it
                pending.splice(i, 1);
                startTask(candidate);

                if (concurrentTaskDelay > 0)
                    await delay(concurrentTaskDelay);
            }
        };

        // Keep pumping until every task has been scheduled and finished.
        // Each loop: schedule what we can, then wait for at least one task to
        // settle (which frees a concurrency slot and/or an IP) before retrying.
        while (pending.length > 0 || executing.size > 0) {
            await scheduleAvailable();

            if (executing.size > 0) {
                // Wait for one in-flight task to settle before scheduling more.
                await Promise.race(executing);
            } else if (pending.length > 0) {
                // Nothing running but tasks remain (all were blocked by busy
                // IPs that just got released). Yield briefly and retry.
                /* istanbul ignore next */
                await delay(concurrentTaskDelay > 0 ? concurrentTaskDelay : 1);
            }
        }

        // Safety net: ensure all promises have fully settled.
        await Promise.allSettled(executing);
        return results;
    },
};
