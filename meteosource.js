(function (root, factory) {

    if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define(['meteosource'], function() { return factory({}) });
    } else if (typeof exports === 'object' && typeof exports.nodeName !== 'string') {
        // CommonJS
        factory(exports);
    } else {
        // Browser globals
        factory((root.meteosource = {}));
    }
}(typeof self !== 'undefined' ? self : this, function (exports) {

    class MeteosourceError {
        constructor(msg) {
            if(typeof msg === "string") {
                this.code = -1
                this.detail = msg
            } else if(typeof msg == "object" && "detail" in msg) {
                this.code = "code" in msg ? msg.code : -1
                this.detail = msg.detail
            } else {
                this.code = -1
                this.detail = msg.toString()
            }
        }
        toString() {
            return "MeteosourceError: " + this.detail + " (code " + this.code + ")"
        }
    }

    let tiersAvailable = ["free", "startup", "standard", "flexi"]
    Object.freeze(tiersAvailable)

    // determine function for an HTTP request
    let httpFunc
    if (typeof fetch === "function") {
        httpFunc = async function (url) {
            let res
            try {
                res = await fetch(url)
            } catch (e) {
                throw new MeteosourceError({code: -1, detail: e.toString()})
            }
            let statusCode = res.status
            let jsonRoot
            try {
                jsonRoot = await res.json()
            } catch (e) {
                try {
                    jsonRoot = {detail: await res.text()}
                } catch (e) {
                    jsonRoot = {detail: "Unknown error"}
                }
            }
            if (statusCode >= 200 && statusCode <= 299) {
                return jsonRoot
            } else {
                jsonRoot.code = statusCode
                throw new MeteosourceError(jsonRoot)
            }
        }
    } else if(typeof require === "function") {
        let https = require("https")
        httpFunc = async function (url) {
            let data = ""
            let statusCode = -1
            try {
                data = await new Promise((resolve, reject) => {
                    https.get(url, res => {
                        statusCode = res.statusCode
                        res.on("data", d => data = data + d)
                        res.on("end", () => resolve(data))
                    }).on("error", e => reject(e.message))
                })
            } catch(e) {
                throw new MeteosourceError({code: statusCode, detail: e.toString()})
            }

            let jsonRoot
            try {
                jsonRoot = JSON.parse(data)
            } catch(e) {
                jsonRoot = {detail: data.toString()}
            }

            if (statusCode >= 200 && statusCode <= 299) {
                return jsonRoot
            } else {
                jsonRoot.code = statusCode
                throw new MeteosourceError(jsonRoot)
            }
        }
    } else {
        throw new MeteosourceError("cannot use HTTP request methods; supporting fetch() or require('https')")
    }

    class Meteosource {
        #initialized = false
        #apiKey = null
        #tier = null
        #luxon = null
        #baseUrl = null

        constructor(apiKey, tier, baseUrl = "https://www.meteosource.com/api/v1/") {
            if(typeof apiKey !== "string")
                throw new MeteosourceError("wrong type of the apiKey parameter; is " + typeof apiKey)
            if(typeof tier !== "string")
                throw new MeteosourceError("wrong type of the tier parameter; is " + typeof tier)
            if(typeof baseUrl !== "string")
                throw new MeteosourceError("wrong type of the baseUrl parameter; is " + typeof tier)
            if(apiKey === "")
                throw new MeteosourceError("the apiKey parameter is empty")
            if(!tiersAvailable.includes(tier))
                throw new MeteosourceError("tier " + tier + " does not exist or is not supported")

            // load luxon library
            if(typeof window === "object" && typeof window.luxon === "object")
                this.#luxon = window.luxon
            else if(typeof require === "function")
                this.#luxon = require("luxon")
            else
                throw new MeteosourceError("luxon library is required")

            this.#apiKey = apiKey
            this.#tier = tier
            this.#baseUrl = baseUrl
            this.#initialized = true
        }

        async getPointForecast(options) {
            this.#checkInitialized()
            this.#checkLimitedOptions(options, ["lat", "lon", "placeId", "sections", "tz", "lang", "units"])
            let url = this.#baseUrl + this.#tier + "/point"
            let sectionsArg
            if(Array.isArray(options.sections))
                sectionsArg = options.sections.join(",")
            else
                sectionsArg = options.sections
            let args = {lat: options.lat, lon: options.lon, place_id: options.placeId, sections: sectionsArg,
                        timezone: "utc", language: options.lang, units: options.units}

            let res = await this.#httpComposed(url, args)

            let usedTimezone = options.tz ? options.tz : "UTC"
            res.toString = function() {
                return "<Forecast for lat: " + res.lat + ", lon: " + res.lon + ">"
            }
            if(res.hourly !== null) {
                res.hourly.toString = function() {
                    return "<Hourly data with " + res.hourly.data.length + " timesteps from " +
                        res.hourly.data[0].date.toISO().substr(0, 19) + " to " + res.hourly.data[res.hourly.data.length-1].date.toISO().substr(0, 19)
                }
                let hourStr2hourData = {}
                let luxon = this.#luxon
                res.hourly.data.forEach(hourData => {
                    hourStr2hourData[hourData.date] = hourData
                    hourData.date = this.#convertCheckDateTime(hourData.date, true).setZone(usedTimezone)
                })
                res.hourly.getData = hourDate => {
                    hourDate = this.#convertCheckDateTime(hourDate, false)
                    return hourStr2hourData[hourDate.setZone("UTC").startOf("hour").toISO().substr(0, 19)]
                }
            }
            if(res.daily !== null) {
                res.daily.toString = function() {
                    return "<Daily data with " + res.daily.data.length + " steps from " +
                        res.daily.data[0].day.toISO().substr(0, 10) +
                        " to " + res.daily.data[res.daily.data.length-1].day.toISO().substr(0, 10)
                }
                let dayStr2dayData = {}
                let luxon = this.#luxon
                res.daily.data.forEach(dayData => {
                    dayStr2dayData[dayData.day] = dayData
                    dayData.day = luxon.DateTime.fromISO(dayData.day, {zone: usedTimezone})
                })
                res.daily.getData = day => {
                    day = this.#convertCheckDateTime(day, false)
                    return dayStr2dayData[day.toISO().substr(0, 10)]
                }
            }
            if(res.minutely !== null) {
                let luxon = this.#luxon
                let str2minuteData = {}
                res.minutely.data.forEach(minuteData => {
                    str2minuteData[minuteData.date] = minuteData
                    minuteData.date = luxon.DateTime.fromISO(minuteData.date + "Z", {zone: usedTimezone})
                })
                res.minutely.toString = function() {
                    return "<Minutely data with " + res.minutely.data.length + " timesteps from " +
                        res.minutely.data[0].date.toISO().substr(0, 19) + " to " +
                        res.minutely.data[res.minutely.data.length-1].date.toISO().substr(0, 19)
                }
                res.minutely.getData = date => {
                    date = this.#convertCheckDateTime(date, false)
                    return str2minuteData[date.setZone("UTC").startOf("minute").toISO().substr(0, 19)]
                }
            }
            if(res.current !== null) {
                res.current.toString = function() {
                    return "<Current data>"
                }
            }
            if(res.alerts !== null) {
                res.alerts.data.forEach(alertData => {
                    alertData.onset = this.#luxon.DateTime.fromISO(alertData.onset + "Z", {zone: usedTimezone})
                    alertData.expires = this.#luxon.DateTime.fromISO(alertData.expires + "Z", {zone: usedTimezone})
                })
                res.alerts.toString = function() {
                    return "<Alerts (" + res.alerts.data.length + " alerts available>"
                }
                res.alerts.getActiveAlerts = date => {
                    if(date === null || date === undefined)
                        date = this.#luxon.DateTime.now()
                    date = this.#convertCheckDateTime(date, false)
                    return res.alerts.data.filter(alert => alert.onset <= date && date <= alert.expires)
                }
            }
            return res
        }

        #convertCheckDateTime(date, forceUTCString) {
            let utcPostfix = forceUTCString ? "Z" : ""
            if(typeof date === "string")
                date = this.#luxon.DateTime.fromISO(date + utcPostfix)

            if(!this.#luxon.DateTime.isDateTime(date))
                throw new MeteosourceError("either a string (DateTime ISO format like YYYY-MM-DDTHH:mm:ss) or a luxon.DateTime required")
            else if(!date.isValid)
                throw new MeteosourceError("passed DateTime (or string) is not valid")
            else
                return date
        }

        async getTimeMachine(options) {
            this.#checkInitialized()
            this.#checkLimitedOptions(options, [
                "date", "dateFrom", "dateTo", "lat", "lon", "placeId", "tz", "units", "progressFunc", "strictMode"
            ])
            let url = this.#baseUrl + this.#tier + "/time_machine"

            let date, dateFrom, dateTo
            if(Array.isArray(options.date))
                date = options.date.map(d => this.#convertCheckDateTime(d, false).toISO().substr(0, 10))
            else if(options.date !== null && options.date !== undefined)
                date = this.#convertCheckDateTime(options.date, false).toISO().substr(0, 10)
            else
                date = options.date
            if(options.dateFrom !== null && options.dateFrom !== undefined)
                dateFrom = this.#convertCheckDateTime(options.dateFrom, false).toISO().substr(0, 10)
            else
                dateFrom = options.dateFrom
            if(options.dateTo !== null && options.dateTo !== undefined)
                dateTo = this.#convertCheckDateTime(options.dateTo, false).toISO().substr(0, 10)
            else
                dateTo = options.dateTo

            let datesToLoad = []
            if(dateFrom && dateTo && !date) {
                let dateFromTime = new Date(dateFrom).getTime()
                let dateToTime = new Date(dateTo).getTime()
                if(dateFromTime > dateToTime)
                    throw new MeteosourceError("dateFrom must be lower or equal to dateTo")
                for(let d = dateFromTime; d <= dateToTime; d += 24 * 3600 * 1000)
                    datesToLoad.push(new Date(d).toISOString().split("T")[0])
            }
            else if(!dateFrom && !dateTo && date) {
                if(Array.isArray(date))
                    datesToLoad = date
                else
                    datesToLoad.push(date)
            } else {
                throw new MeteosourceError("either date, or dateFrom+dateTo parameters must be specified")
            }

            if(datesToLoad.length === 0)
                throw new MeteosourceError("no dates range to load")

            let completeRes = null
            let dateIdx = 0
            let failedDates = []
            let lastError = null
            for(const date of datesToLoad) {
                let args = {date: date, lat: options.lat, lon: options.lon, place_id: options.placeId,
                    timezone: "utc", units: options.units}
                if(options.progressFunc)
                    options.progressFunc(Math.round((dateIdx++/datesToLoad.length) * 100))
                let res
                try {
                    res = await this.#httpComposed(url, args)
                } catch(e) {
                    if(!("strictMode" in options) || options.strictMode)
                        throw e
                    else {
                        failedDates.push(date)
                        lastError = e
                        continue
                    }
                }
                if(completeRes === null) {
                    completeRes = res
                } else {
                    for (const dateItem of res.data)
                        completeRes.data.push(dateItem)
                }
            }
            if(options.progressFunc)
                options.progressFunc(100)
            if(completeRes === null)
                throw lastError
            completeRes.failedDates = failedDates

            let hourStr2hourData = {}
            let usedTimezone = options.tz ? options.tz : "UTC"
            for(const dateItem of completeRes.data) {
                hourStr2hourData[dateItem.date] = dateItem
                dateItem.date = this.#convertCheckDateTime(dateItem.date, true).setZone(usedTimezone)
            }
            completeRes.getData = hourDate => {
                hourDate = this.#convertCheckDateTime(hourDate, false)
                return hourStr2hourData[hourDate.setZone("UTC").startOf("hour").toISO().substr(0, 19)]
            }
            completeRes.toString = function() {
                return "<TimeMachine for lat: " + completeRes.lat + ", lon: " + completeRes.lon + ">"
            }
            completeRes.data.toString = function() {
                return "<TimeMachine data with " + completeRes.data.length + " steps from " + completeRes.data[0].date.toISO().substr(0, 19) +
                    " to " + completeRes.data[completeRes.data.length-1].date.toISO().substr(0, 19)
            }
            return completeRes
        }
        #httpComposed(url, args) {
            let argsCleaned = "?key=" + this.#apiKey
            Object.keys(args).forEach(key => {
                if(args[key] !== null && args[key] !== undefined) {
                    argsCleaned += "&" + key + "=" + args[key].toString()
                }
            })
            return httpFunc(url + argsCleaned)
        }

        #checkLimitedOptions(options, optionsAllowed) {
            let optionsAllowedHash = {}
            optionsAllowed.forEach(opt => optionsAllowedHash[opt] = 1)
            Object.keys(options).forEach(opt => {
                if(!optionsAllowedHash[opt])
                    throw new MeteosourceError("cannot use option '" + opt + "'")
            })
        }

        #checkInitialized() {
            if(!this.#initialized)
                throw new MeteosourceError("cannot use, there was an error in the constructor")
        }
    }

    exports.Meteosource = Meteosource
    exports.version = "1.0.1"
    exports.tiersAvailable = tiersAvailable

    return exports
}));
