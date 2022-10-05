meteosource - Weather API library for Javascript
==========

Javascript wrapper library for [Meteosource weather API](https://www.meteosource.com) that provides detailed hyperlocal weather forecasts for any location on earth. The library supports both Web and Node.JS runtimes.


### Installation: web

The source code is available in the file ``meteosource.js`` and requires the datetime library ``luxon``.

```HTML
<script src="https://www.meteosource.com/js/libs/meteosource.js"></script>
<script src="https://cdn.jsdelivr.net/npm/luxon@2.4.0/build/global/luxon.min.js"></script>

<script>document.write(meteosource.version)</script> <!-- returns 1.0.1 -->
```

### Installation: NPM (Node.js)

To add the library to your project, run the following command in the directory tree of the project:

```shell
$ npm install meteosource
$ node
> meteosource = require("meteosource")
> meteosource.version
1.0.1
```


### Get started

To use this library, you need to obtain your Meteosource API key. You can [sign up](https://www.meteosource.com/client/sign-up) or get the API key of existing account in [your dashboard](https://www.meteosource.com/client).

# Library usage

## Initialization

To initialize the `Meteosource` object, you need your API key and the name of your subscription plan (tier). Basic example of initialization is shown below:

```javascript
let apiKey = 'abcdefghijklmnopqrstuvwxyz0123456789ABCD'
let tier = 'flexi'

let m = new meteosource.Meteosource(apiKey, tier)
```

## Get the weather data

Using the library, you can get weather forecasts or archive weather data (if you have a paid subscription).

### Forecast
To get the weather data for given place, use `getPointForecast()` async method of the `Meteosource` object. You have to specify either the coordinates of the place (`lat` + `lon`) or the `placeId`. Detailed description of the parameters can be found in the [API documentation](https://www.meteosource.com/documentation).

Note that the default timezone is always `UTC`, as opposed to the API itself (which defaults to the point's local timezone). This is because the library always queries the API for the `UTC` timezone to avoid ambiguous datetimes problems. If you specify the ``tz`` parameter to specify a different timezone, the library still requests the API for `UTC`, and then converts the ``luxon.DateTime`` objects to the desired timezone.

Because most of the parameters are optional and Javascript does not support named function parameters, an object is passed as a single parameter.

```javascript
let forecast = await m.getPointForecast({
    lat: 37.7775,  // Latitude of the point
    lon: -122.416389,  // Longitude of the point
    placeId: null,  // You can specify place_id instead of lat+lon
    sections: ["current", "hourly"],  // is converted to "current,hourly"
    tz: 'US/Pacific',
    lang: 'en',
    units: 'us',  // Defaults to 'auto'
})

// NOTE: The command above works in an async/wait context only
// (async function, Node.JS REPL)
// elsewhere you run:
m.getPointForecast({...}).then(forecast => console.log(forecast))
```

### Historical weather
Users with paid subscription to Meteosource can retrieve historical weather from the `time_machine` endpoint, using the `getTimeMachine()` method:

```javascript
let timeMachine = await m.getTimeMachine({
    date: '2019-12-25',  // either a string, or a luxon.DateTime object or an array of these
    dateFrom: null,  // You can specify the range for dates you need, instead of list
    dateTo: null,  // You can specify the range for dates you need, instead of list
    placeId: 'london', // ID of the place you want the historical weather for
    lat: null,  // You can specify lat instead of placeId
    lon: null,  // You can specify lon instead of placeId
    tz: 'UTC',  // Defaults to 'UTC', regardless of the point location
    units: 'us',  // Defaults to 'auto'
})
```
Note that the historical weather data are always retrieved for full UTC days. If you specify a different timezone, the datetimes get converted, but they will cover the full UTC, not the local day.

If you pass an array of dates to the `date` parameter, the days will be inserted into the inner structures in the order they are being iterated over. This affects time indexing by integer (see below). An API request is made for each day, even when you specify a date range.

## Working with the weather data
All of the data objects have overloaded `toString()` methods, so you can use them get useful information about the objects:

```javascript
console.log(forecast.toString())  // <Forecast for lat: 37.7775N, lon: 122.416389W>
console.log(timeMachine.toString())  // <TimeMachine for lat: 51.50853N, lon: 0.12574W>
```

### Attribute access

The methods ``getPointForecast`` and ``getTimeMachine`` return an object structure which is equivalent to the JSON response of the API (see the docs for the appropriate tier).

You can access the attributes using the dot operator (`.`), or the index operator (`[]`):

```javascript
// You can access all of the attributes with dot operator:
forecast.lat  // "37.7775N"

// ... or with index operator:
forecast['lon']  // "122.416389W"

// There is also information about the elevation of the point and the timezone
timeMachine.elevation  // 82
timeMachine.timezone  // 'utc'
```

### Weather data sections

There are 5 weather forecast sections (`current`, `minutely`, `hourly`, `daily` and `alerts`) as attributes in the root object from ``getPointForecast``.

The `current` data contains data for many variables for a single point in time:

```javascript
console.log(forecast.current)
```

The `minutely`, `hourly` and `daily` sections contain forecasts for more points in time. The sections that were not requested are empty (set to ``null``):

```javascript
console.log(forecast.minutely)  // null
console.log(forecast.daily)  // null
```

The sections that were requested can also be printed, to view number of available timesteps and their range (inclusive):

```javascript
console.log(forecast.hourly.toString())  // <Hourly data with 162 timesteps from 2022-05-20T11:00:00 to 2022-05-27T04:00:00
```

The `alerts` section contain meteorological alerts and warnings, if there are any issued for the location. You can print the object or iterate over it:
```javascript
console.log(forecast.alerts.toString())  // <Alerts (2 alerts available>
for(let alert of forecast.alerts.data)
    console.log(alert)
```

There is a single section `data` for historical weather in the root object returned by ``getTimeMachine``.

```javascript
console.log(timeMachine.data.toString())  // <TimeMachine data with 24 steps from 2019-12-25T00:00:00 to 2019-12-25T23:00:00
```

### Time indexing

As mentioned above, the ``data`` objects contain data for more timesteps. To get the data for a single time, you have two options.

  **1. Indexing with integer**

You can simply index the ``data`` objects with `int`, as the offset from the current time:

```javascript
forecast.hourly.data[0]
timeMachine.data[0]
```

  **2. Indexing with `datetime` or a string**

You can also use `luxon.DateTime` as a parameter to the function ``getData``, the time zone of the object does not matter. A string datetime in the ISO format can be also used as the parameter, in such a case it is converted to ``luxon.DateTime``.

The ``Datetime`` object does not have to be padded to the exact start of an hour (or a minute or a day).

```javascript
// get data for the current hour
forecast.hourly.getData(luxon.DateTime.now())

// for another hour -- beware, without an explicit timezone specification the local
// timezone is used
forecast.hourly.getData(luxon.DateTime.fromISO("2022-03-03T01:00:00")) // local TZ
forecast.hourly.getData(luxon.DateTime.fromISO("2022-03-03T01:00:00Z")) // UTC
forecast.hourly.getData(luxon.DateTime.fromISO("2022-03-03T01:00:00", {zone: "Europe/Prague"})) // a specific time zone

// is equivalent to the previous UTC case
forecast.hourly.getData("2022-03-03T01:00:00Z")

// get historical weather
timeMachine.getData(luxon.DateTime.fromISO("2019-12-25T01:00:00"))
```


### Variable access

To access the variable, you can use the dot operator (`.`), or the index operator (`[]`):

```javascript
forecast.current.temperature
forecast.hourly.data[0]['temperature']
timeMachine.data[0]['weather']
```

Some variables are grouped into logical groups, just like in the API response. You can access the actual data with chained dot or index operators:

```javascript
Object.keys(forecast.current.wind)  // ['angle', 'dir', 'gusts', 'speed']
forecast.current.wind.speed
timeMachine.data[0]['wind'].dir  // WNW
```


### Contact us

You can contact us [here](https://www.meteosource.com/contact).
