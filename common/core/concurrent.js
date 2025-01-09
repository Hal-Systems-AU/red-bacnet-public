'use strict';
require('./_alias.js');

const { EVENT_OUTPUT, EVENT_ERROR } = require('@root/common/core/constant.js');

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
     * @returns {Promise<Array>} - A promise that resolves with an array of results.
     * @async
    */
    concurrentTasks: async function (eventEmitter, tasks, maxConcurrent) {
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

            // need delay?
            // if (typeof delay === 'function') await delay(1);
        }

        await Promise.allSettled(executing);
        return results;
    },
};