'use strict';

// ---------------------------------- export ----------------------------------
/* istanbul ignore next */
module.exports = {
    /**
     * Prints a message to the console.
     *
     * @param {string} msg - The message to be printed.
     */
    print: function (msg, time = false) {
        if (time) {
            const now = new Date();
            const dateString = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
            const timeString = now.toTimeString().split(' ')[0];
            console.log(`${dateString} ${timeString} - [info] ${msg}`);
        } else {
            console.log(msg);
        }
    },

    /**
     * Returns a formatted string of the current date and time.
     * @returns {string} - The formatted string of the current date and time.
     */
    nowFormatted: function () {
        const now = new Date();
        const day = String(now.getDate()).padStart(2, '0');
        const month = String(now.getMonth() + 1).padStart(2, '0'); // Months are 0-based
        const year = now.getFullYear() % 100;
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');

        return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
    },

    /**
     * Async delay function.
     *
     * @param {number} ms - The number of milliseconds to wait.
     * @returns {Promise<void>} - A promise that resolves after the specified number of milliseconds.
     */
    delay: function (ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    },

    /**
     * Generates a random number between min and max.
     *
     * @param {number} min - Minimum value
     * @param {number} max - Maximum value
     * @param {number} decimal - Decimal places
     * @returns {number} - Result
     */
    randNum: function (min, max, decimal = 1) {
        return +(Math.random() * (max - min) + min).toFixed(decimal)
    },

    /**
     * Generates a random boolean value.
     *
     * @returns {boolean} - Result
     */
    randBool: function () {
        return Math.random() >= 0.5
    },

    /**
     * Generates a random integer between min and max.
     *
     * @param {number} min - Minimum value
     * @param {number} max - Maximum value
     * @returns {number} - Result
     */
    randInt: function (min, max) {
        min = Math.ceil(min);
        max = Math.floor(max);
        return Math.floor(Math.random() * (max - min + 1)) + min;
    },

    /**
     *
     * @param {number} millis - The number of milliseconds to format.
     * @returns {string} - The formatted string of the duration.
     */
    formatDuration: function (millis) {
        const ms = Math.floor(millis % 1000).toString().padStart(3, '0');
        const s = Math.floor((millis / 1000) % 60);
        const m = Math.floor((millis / (1000 * 60)) % 60);
        const h = Math.floor(millis / (1000 * 60 * 60));

        let result = '';
        if (h > 0) result += `${h}h `;
        if (m > 0) result += `${m}m `;
        if (s > 0) result += `${s}s `;
        result += `${ms}ms`;

        return result.trim(); // Remove any trailing spaces
    },
}