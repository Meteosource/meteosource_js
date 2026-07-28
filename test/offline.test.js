var assert = require('assert')
var fs = require('fs')
var path = require('path')
var luxon = require('luxon')
var meteosource = require("..")

var apiKey = "test-api-key"

function loadFixture(name) {
    // parses a fresh copy on every call, because the library mutates the response
    return JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", name + ".json")))
}

// The library resolves the global fetch() at call time, so replacing global.fetch
// routes all its requests to local fixtures without any network access or API key.
var realFetch = global.fetch
var requestedUrls = []

function installFakeFetch(fixtureByEndpoint) {
    requestedUrls = []
    global.fetch = async function (urlStr) {
        let url = new URL(urlStr)
        requestedUrls.push(url)
        let endpoint = url.pathname.split("/").pop()
        let spec = fixtureByEndpoint ? fixtureByEndpoint[endpoint] : undefined
        if(typeof spec === "function")
            return spec(url)
        let body = loadFixture(spec ? spec : endpoint)
        if(endpoint === "time_machine") {
            // reuse the single-day fixture for whatever date was requested
            let date = url.searchParams.get("date")
            body.data.forEach(item => item.date = date + item.date.substr(10))
        }
        return {status: 200, json: async () => body}
    }
}

describe('meteosource offline', function () {
    beforeEach(function () {
        installFakeFetch()
    })
    afterEach(function () {
        global.fetch = realFetch
    })

    describe('constructor', function () {
        it('rejects a non-string API key', function () {
            assert.throws(() => new meteosource.Meteosource(42, "flexi"), e => e.code === -1)
        })
        it('rejects an empty API key', function () {
            assert.throws(() => new meteosource.Meteosource("", "flexi"), e => e.code === -1)
        })
        it('rejects an unknown tier', function () {
            assert.throws(() => new meteosource.Meteosource(apiKey, "gold"), e => e.code === -1)
        })
    })

    describe('#getPointForecast', function () {
        it('composes the request URL from the options', async function () {
            let m = new meteosource.Meteosource(apiKey, "flexi")
            await m.getPointForecast({placeId: "prague", sections: ["current", "hourly"], lang: "en"})
            assert.equal(requestedUrls.length, 1)
            let url = requestedUrls[0]
            assert.equal(url.pathname, "/api/v1/flexi/point")
            assert.equal(url.searchParams.get("key"), apiKey)
            assert.equal(url.searchParams.get("place_id"), "prague")
            assert.equal(url.searchParams.get("sections"), "current,hourly")
            assert.equal(url.searchParams.get("language"), "en")
            assert.equal(url.searchParams.get("timezone"), "utc")
        })
        it('rejects unknown options', async function () {
            let m = new meteosource.Meteosource(apiKey, "flexi")
            await assert.rejects(m.getPointForecast({placeId: "prague", foo: 1}), e => e.code === -1)
        })
        it('converts hourly dates to luxon.DateTime in UTC by default', async function () {
            let m = new meteosource.Meteosource(apiKey, "flexi")
            let p = await m.getPointForecast({placeId: "prague"})
            assert.ok(p.hourly.data.every(h => luxon.DateTime.isDateTime(h.date)))
            assert.ok(p.hourly.data.every(h => h.date.zoneName === "UTC"))
        })
        it('converts dates to the requested timezone', async function () {
            let m = new meteosource.Meteosource(apiKey, "flexi")
            let p = await m.getPointForecast({placeId: "prague", tz: "Europe/Prague"})
            assert.equal(p.hourly.data[0].date.zoneName, "Europe/Prague")
            // the instant must stay the same, only the zone changes
            assert.equal(+p.hourly.data[0].date, +luxon.DateTime.fromISO("2022-08-12T10:00:00Z"))
        })
        it('tolerates sections that are null or missing entirely', async function () {
            // the point fixture has daily: null and no minutely/alerts keys at all
            let m = new meteosource.Meteosource(apiKey, "flexi")
            let p = await m.getPointForecast({placeId: "prague"})
            assert.equal(p.daily, null)
            assert.equal(p.minutely, undefined)
            assert.equal(p.alerts, undefined)
        })
        it('can look up an hour by ISO string or luxon.DateTime', async function () {
            let m = new meteosource.Meteosource(apiKey, "flexi")
            let p = await m.getPointForecast({placeId: "prague"})
            assert.equal(+p.hourly.getData("2022-08-12T11:00:00Z").date, +p.hourly.data[1].date)
            assert.equal(+p.hourly.getData(luxon.DateTime.fromISO("2022-08-12T11:30:00Z")).date, +p.hourly.data[1].date)
        })
        it('converts daily, minutely and alerts sections when present', async function () {
            installFakeFetch({point: "point_all"})
            let m = new meteosource.Meteosource(apiKey, "flexi")
            let p = await m.getPointForecast({placeId: "prague", sections: "all"})
            assert.ok(luxon.DateTime.isDateTime(p.daily.data[0].day))
            assert.ok(luxon.DateTime.isDateTime(p.minutely.data[0].date))
            assert.ok(p.alerts.data.every(a => luxon.DateTime.isDateTime(a.onset) && luxon.DateTime.isDateTime(a.expires)))
            assert.equal(p.daily.getData("2022-08-13").day.toISO().substr(0, 10), "2022-08-13")
            assert.equal(+p.minutely.getData("2022-08-12T10:02:30Z").date, +p.minutely.data[2].date)
        })
        it('finds active alerts for a given time', async function () {
            installFakeFetch({point: "point_all"})
            let m = new meteosource.Meteosource(apiKey, "flexi")
            let p = await m.getPointForecast({placeId: "prague", sections: "all"})
            let active = p.alerts.getActiveAlerts(luxon.DateTime.fromISO("2022-08-12T12:00:00Z"))
            assert.equal(active.length, 1)
            assert.equal(active[0].event, "Heat warning")
            assert.equal(p.alerts.getActiveAlerts(luxon.DateTime.fromISO("2022-08-20T00:00:00Z")).length, 0)
        })
        it('throws a MeteosourceError with the status code on an API error', async function () {
            installFakeFetch({point: () => ({status: 402, json: async () => ({detail: "Payment required"})})})
            let m = new meteosource.Meteosource(apiKey, "flexi")
            await assert.rejects(m.getPointForecast({placeId: "prague"}),
                e => e.code === 402 && e.detail === "Payment required")
        })
    })

    describe('#getTimeMachine', function () {
        it('completes for a single date', async function () {
            let m = new meteosource.Meteosource(apiKey, "flexi")
            let q = await m.getTimeMachine({placeId: "prague", date: "2022-03-03"})
            assert.equal(q.data.length, 24)
            assert.equal(requestedUrls[0].pathname, "/api/v1/flexi/time_machine")
            assert.equal(requestedUrls[0].searchParams.get("date"), "2022-03-03")
        })
        it('makes one request per day for a range of dates', async function () {
            let m = new meteosource.Meteosource(apiKey, "flexi")
            let q = await m.getTimeMachine({placeId: "prague", dateFrom: "2022-03-03", dateTo: "2022-03-05"})
            assert.equal(q.data.length, 3*24)
            assert.equal(requestedUrls.length, 3)
            assert.deepEqual(requestedUrls.map(u => u.searchParams.get("date")),
                ["2022-03-03", "2022-03-04", "2022-03-05"])
        })
        it('completes for an array of dates', async function () {
            let m = new meteosource.Meteosource(apiKey, "flexi")
            let q = await m.getTimeMachine({placeId: "prague", date: ["2022-03-03", "2022-03-04"]})
            assert.equal(q.data.length, 2*24)
        })
        it('converts all dates to luxon.DateTime in UTC', async function () {
            let m = new meteosource.Meteosource(apiKey, "flexi")
            let q = await m.getTimeMachine({placeId: "prague", date: "2022-03-03"})
            assert.ok(q.data.every(h => luxon.DateTime.isDateTime(h.date)))
            assert.ok(q.data.every(h => h.date.zoneName === "UTC"))
        })
        it('can use the function to search in the data', async function () {
            let m = new meteosource.Meteosource(apiKey, "flexi")
            let q = await m.getTimeMachine({placeId: "prague", date: "2022-03-03", tz: "Europe/Prague"})
            assert.equal(+q.getData("2022-03-03T00:00:00Z").date, +q.data[0].date)
        })
        it('requires either date or dateFrom+dateTo', async function () {
            let m = new meteosource.Meteosource(apiKey, "flexi")
            await assert.rejects(m.getTimeMachine({placeId: "prague"}), e => e.code === -1)
            await assert.rejects(m.getTimeMachine({placeId: "prague", date: "2022-03-03", dateFrom: "2022-03-01"}),
                e => e.code === -1)
        })
        it('rejects dateFrom greater than dateTo', async function () {
            let m = new meteosource.Meteosource(apiKey, "flexi")
            await assert.rejects(m.getTimeMachine({placeId: "prague", dateFrom: "2022-03-05", dateTo: "2022-03-03"}),
                e => e.code === -1)
        })
        it('collects failed dates when strictMode is off', async function () {
            installFakeFetch({time_machine: url => {
                let date = url.searchParams.get("date")
                if(date === "2022-03-04")
                    return {status: 500, json: async () => ({detail: "Server error"})}
                let body = loadFixture("time_machine")
                body.data.forEach(item => item.date = date + item.date.substr(10))
                return {status: 200, json: async () => body}
            }})
            let m = new meteosource.Meteosource(apiKey, "flexi")
            let q = await m.getTimeMachine({placeId: "prague", dateFrom: "2022-03-03", dateTo: "2022-03-05", strictMode: false})
            assert.equal(q.data.length, 2*24)
            assert.deepEqual(q.failedDates, ["2022-03-04"])
        })
    })

    describe('#getAirQuality', function () {
        it('composes the request URL from the options', async function () {
            let m = new meteosource.Meteosource(apiKey, "flexi")
            await m.getAirQuality({placeId: "london", lang: "en"})
            let url = requestedUrls[0]
            assert.equal(url.pathname, "/api/v1/flexi/air_quality")
            assert.equal(url.searchParams.get("key"), apiKey)
            assert.equal(url.searchParams.get("place_id"), "london")
            assert.equal(url.searchParams.get("language"), "en")
            assert.equal(url.searchParams.get("timezone"), "utc")
        })
        it('accepts lat+lon instead of placeId', async function () {
            let m = new meteosource.Meteosource(apiKey, "flexi")
            await m.getAirQuality({lat: 51.50853, lon: -0.12574})
            assert.equal(requestedUrls[0].searchParams.get("lat"), "51.50853")
            assert.equal(requestedUrls[0].searchParams.get("lon"), "-0.12574")
        })
        it('converts all dates to luxon.DateTime in UTC by default', async function () {
            let m = new meteosource.Meteosource(apiKey, "flexi")
            let q = await m.getAirQuality({placeId: "london"})
            assert.ok(q.data.every(h => luxon.DateTime.isDateTime(h.date)))
            assert.ok(q.data.every(h => h.date.zoneName === "UTC"))
        })
        it('converts dates to the requested timezone', async function () {
            let m = new meteosource.Meteosource(apiKey, "flexi")
            let q = await m.getAirQuality({placeId: "london", tz: "Europe/London"})
            assert.ok(q.data.every(h => h.date.zoneName === "Europe/London"))
        })
        it('can use the function to search in the data', async function () {
            let m = new meteosource.Meteosource(apiKey, "flexi")
            let q = await m.getAirQuality({placeId: "london"})
            assert.equal(q.getData("2026-07-28T02:00:00Z").air_quality, q.data[2].air_quality)
            assert.equal(+q.getData(luxon.DateTime.fromISO("2026-07-28T02:30:00Z")).date, +q.data[2].date)
        })
        it('rejects unknown options', async function () {
            let m = new meteosource.Meteosource(apiKey, "flexi")
            await assert.rejects(m.getAirQuality({placeId: "london", units: "us"}), e => e.code === -1)
        })
    })

    describe('#getNearestPlace', function () {
        it('returns the place for given coordinates', async function () {
            let m = new meteosource.Meteosource(apiKey, "flexi")
            let place = await m.getNearestPlace({lat: 51.50853, lon: -0.1257, lang: "en"})
            let url = requestedUrls[0]
            assert.equal(url.pathname, "/api/v1/flexi/nearest_place")
            assert.equal(url.searchParams.get("lat"), "51.50853")
            assert.equal(url.searchParams.get("lon"), "-0.1257")
            assert.equal(url.searchParams.get("language"), "en")
            assert.equal(place.place_id, "london")
            assert.equal(place.toString(), "<Place London (london), United Kingdom>")
        })
        it('rejects unknown options', async function () {
            let m = new meteosource.Meteosource(apiKey, "flexi")
            await assert.rejects(m.getNearestPlace({placeId: "london"}), e => e.code === -1)
        })
    })

    describe('#findPlaces', function () {
        it('returns the list of matching places', async function () {
            let m = new meteosource.Meteosource(apiKey, "flexi")
            let places = await m.findPlaces({text: "london", lang: "en"})
            let url = requestedUrls[0]
            assert.equal(url.pathname, "/api/v1/flexi/find_places")
            assert.equal(url.searchParams.get("text"), "london")
            assert.equal(url.searchParams.get("language"), "en")
            assert.ok(Array.isArray(places))
            assert.ok(places.length > 0)
            assert.equal(places[0].place_id, "london")
            assert.equal(places[0].toString(), "<Place London (london), United Kingdom>")
        })
        it('rejects unknown options', async function () {
            let m = new meteosource.Meteosource(apiKey, "flexi")
            await assert.rejects(m.findPlaces({placeId: "london"}), e => e.code === -1)
        })
    })

    describe('#findPlacesPrefix', function () {
        it('returns the list of matching places', async function () {
            let m = new meteosource.Meteosource(apiKey, "flexi")
            let places = await m.findPlacesPrefix({text: "lond"})
            let url = requestedUrls[0]
            assert.equal(url.pathname, "/api/v1/flexi/find_places_prefix")
            assert.equal(url.searchParams.get("text"), "lond")
            assert.ok(Array.isArray(places))
            assert.ok(places.every(p => p.place_id))
        })
    })
});
