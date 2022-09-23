var assert = require('assert')
var luxon = require('luxon')
var meteosource = require(".")

if(process.env.API_KEY)
    var apiKey = process.env.API_KEY
else
    throw new Error("ENV variable API_KEY must be set")

describe('meteosource.Meteosource', function () {
    this.timeout(5000)
    describe('#getPointForecast', function () {
        it('completes', function (done) {
            let m = new meteosource.Meteosource(apiKey, "premium")
            m.getPointForecast({placeId: "prague"}).then(() => done())
        })
        it('converts all dates to luxon.DateTime', async function () {
            let m = new meteosource.Meteosource(apiKey, "premium")
            let p = await m.getPointForecast({placeId: "prague", sections: "all"})
            assert.ok(luxon.DateTime.isDateTime(p.hourly.data[0].date))
            assert.ok(luxon.DateTime.isDateTime(p.daily.data[0].day))
            assert.ok(luxon.DateTime.isDateTime(p.minutely.data[0].date))
        })
        it('when the timezone is default, use UTC dates everywhere', async function () {
            let m = new meteosource.Meteosource(apiKey, "premium")
            let p = await m.getPointForecast({placeId: "prague", sections: "all"})
            assert.equal(p.hourly.data[0].date.zoneName, "UTC")
            assert.equal(p.daily.data[0].day.zoneName, "UTC")
            assert.equal(p.minutely.data[0].date.zoneName, "UTC")
        })
        it('when the timezone is non-default, use dates for that timezone everywhere', async function () {
            let m = new meteosource.Meteosource(apiKey, "premium")
            let p = await m.getPointForecast({placeId: "prague", sections: "all", tz: "Europe/Prague"})
            assert.equal(p.hourly.data[0].date.zoneName, "Europe/Prague")
            assert.equal(p.daily.data[0].day.zoneName, "Europe/Prague")
            assert.equal(p.minutely.data[0].date.zoneName, "Europe/Prague")
        })
        it('the first hour/minute is the current one', async function () {
            let m = new meteosource.Meteosource(apiKey, "premium")
            let p = await m.getPointForecast({placeId: "prague", sections: "all"})
            assert.equal(+p.hourly.data[0].date, +luxon.DateTime.now().startOf("hour"))
            assert.equal(+p.minutely.data[0].date, +luxon.DateTime.now().startOf("minute"))
        })
        it('querying the functions for the current hour/minute yields it', async function () {
            let m = new meteosource.Meteosource(apiKey, "premium")
            let p = await m.getPointForecast({placeId: "prague", sections: "all"})
            assert.equal(+p.hourly.data[0].date, +p.hourly.getData(luxon.DateTime.now()).date)
            assert.equal(+p.hourly.data[0].date, +p.hourly.getData(luxon.DateTime.now().setZone("Europe/Athens")).date)
            assert.equal(+p.minutely.data[0].date, +p.minutely.getData(luxon.DateTime.now()).date)
            assert.equal(+p.minutely.data[0].date, +p.minutely.getData(luxon.DateTime.now().setZone("Europe/Athens")).date)
        })
        it('querying the daily for the first date by string yields it', async function () {
            let m = new meteosource.Meteosource(apiKey, "premium")
            let p = await m.getPointForecast({placeId: "prague", sections: "all"})
            let firstDay = p.daily.data[0].day.toISO().substr(0, 10)
            assert.equal(firstDay, p.daily.getData(firstDay).day.toISO().substr(0, 10))
        })
    })
    describe('#getTimeMachine', function () {
        it('completes for a single date', async function () {
            let m = new meteosource.Meteosource(apiKey, "premium")
            let q = await m.getTimeMachine({placeId: "prague", date: "2022-03-03"})
            assert.equal(q.data.length, 24)
        })
        it('completes for a range of dates', async function () {
            let m = new meteosource.Meteosource(apiKey, "premium")
            let q = await m.getTimeMachine({placeId: "prague", dateFrom: "2022-03-03", dateTo: "2022-03-05"})
            assert.equal(q.data.length, 3*24)
        })
        it('completes for an array of dates', async function () {
            let m = new meteosource.Meteosource(apiKey, "premium")
            let q = await m.getTimeMachine({placeId: "prague", date: ["2022-03-03", "2022-03-04"]})
            assert.equal(q.data.length, 2*24)
        })
        it('converts all dates to luxon.DateTime in UTC', async function () {
            let m = new meteosource.Meteosource(apiKey, "premium")
            let q = await m.getTimeMachine({placeId: "prague", dateFrom: "2022-03-03", dateTo: "2022-03-05"})
            assert.ok(q.data.every(h => luxon.DateTime.isDateTime(h.date)))
            assert.ok(q.data.every(h => h.date.zoneName === "UTC"))
        })
        it('converts to a different timezone when specified', async function () {
            let m = new meteosource.Meteosource(apiKey, "premium")
            let q = await m.getTimeMachine({placeId: "prague", dateFrom: "2022-03-03", dateTo: "2022-03-05", tz: "Europe/Prague"})
            assert.ok(q.data.every(h => h.date.zoneName === "Europe/Prague"))
        })
        it('can use the function to search in the data (local timezone)', async function () {
            let m = new meteosource.Meteosource(apiKey, "premium")
            let q = await m.getTimeMachine({placeId: "prague", dateFrom: "2022-03-03", dateTo: "2022-03-05", tz: "Europe/Prague"})
            assert.equal(+q.getData("2022-03-03T00:00:00Z").date, +q.data[0].date)
        })
        it('can use the function to search in the data (UTC)', async function () {
            let m = new meteosource.Meteosource(apiKey, "premium")
            let q = await m.getTimeMachine({placeId: "prague", dateFrom: "2022-03-03", dateTo: "2022-03-05"})
            assert.equal(+q.getData("2022-03-03T00:00:00Z").date, +q.data[0].date)
        })
    })
});
