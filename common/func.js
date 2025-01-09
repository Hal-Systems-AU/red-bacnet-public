'use strict';

// ---------------------------------- export ----------------------------------
module.exports = {
    /**
     * Convert BACnet facets string to object.
     * @param {string} str - The BACnet facets string.
     * @returns {Object} - The BACnet facets object.
     */
    facetsStrToObj: function (str) {
        /* eg
        unit:L/s;precision:1
        falseText:Off;trueText:On
        range:{1:Reserved;2:Warning}
        */
        try {
            if (str.includes("range:{")) {
                const content = str.match(/\{(.+)\}/)[1];
                const ranges = Object.fromEntries(content.split(";").map(pair => {
                    const [key, value] = pair.split(":");
                    return [key.trim(), value.trim()];
                }));
                return {
                    range: ranges
                };
            }

            return Object.fromEntries(str.split(";").map(pair => {
                const [key, value] = pair.split(":");
                return [key.trim(), value.trim()];
            }));
        }
        catch (e) {
            /* istanbul ignore next */
            {
                void e
                return {};
            }
        }
    },

    /**
     * Create an error message object.
     * @param {string} funcName - The name of the function.
     * @param {string} errName - The name of the error.
     * @param {any} errDesc - The description of the error.
     * @returns {Object} - The error message object.
     */
    errMsg: function (funcName, errName, errDesc) {
        return {
            [`[${funcName}] ${errName}`]: errDesc
        }
    },

    /**
     * Get error message from error object.
     * @param {any} err - The error object.
     * @returns {string} - The error message.
     */
    getErrMsg: function (err) {
        if (err instanceof Error)
            return err.message
        else
            return err
    },
};