// CsWeather.js -- forecast lookup for the callout card.
//
// Part of the Cave Survey Core library. The request builders and parsers
// are pure; only fetchText touches the network (a blocking curl through
// QProcess, the pattern CsSurfaceData.fetch proved in this bridge).
//
// PRIVACY: only a coordinate rounded to 0.1 degree (about 10 km), or a
// typed place name, ever leaves the machine. The exact entrance never
// does, and the result carries no place label.
//
// The 'Cs' prefix is mandatory: include() dedupes by basename.

var CsWeather = {};

CsWeather.TIMEOUT_S = 5;

/** A coordinate to 0.1 degree, as text ("35.1", "-86.0"). */
CsWeather.round = function(v) {
    return (Math.round(v * 10) / 10).toFixed(1);
};

CsWeather.forecastUrl = function(lat, lon, startDate, endDate) {
    return "https://api.open-meteo.com/v1/forecast?latitude=" +
        CsWeather.round(lat) + "&longitude=" + CsWeather.round(lon) +
        "&daily=temperature_2m_max,temperature_2m_min,precipitation_sum," +
        "precipitation_probability_max,weather_code&temperature_unit=fahrenheit" +
        "&precipitation_unit=inch&timezone=auto&start_date=" + startDate +
        "&end_date=" + endDate;
};

CsWeather.geocodeUrl = function(name) {
    return "https://geocoding-api.open-meteo.com/v1/search?count=1&language=en" +
        "&format=json&name=" + encodeURIComponent(name);
};

/** \return {lat, lon} (unrounded here, rounded when used) or null */
CsWeather.parseGeocode = function(text) {
    try {
        var data = JSON.parse(String(text));
        var hit = data.results[0];
        if (typeof hit.latitude === "number" && typeof hit.longitude === "number") {
            return { lat: hit.latitude, lon: hit.longitude };
        }
    } catch (e) {
    }
    return null;
};

/** \return [{date, high, low, rainTotal, rainChance, code}] or null */
CsWeather.parseForecast = function(text) {
    try {
        var daily = JSON.parse(String(text)).daily;
        var num = function(list, i) {
            var v = list[i];
            return typeof v === "number" ? v : null;
        };
        var out = [];
        for (var i = 0; i < daily.time.length; i++) {
            out.push({ date: daily.time[i],
                high: num(daily.temperature_2m_max, i),
                low: num(daily.temperature_2m_min, i),
                rainTotal: num(daily.precipitation_sum, i),
                rainChance: num(daily.precipitation_probability_max, i),
                code: daily.weather_code ? num(daily.weather_code, i) : null });
        }
        return out;
    } catch (e) {
        return null;
    }
};

// WMO weather code -> icon kind and one-word label. [codes, kind, label]
CsWeather.CODES = [
    [[0], "clear", "Clear"], [[1], "clear", "Mostly clear"],
    [[2], "partly", "Partly cloudy"], [[3], "cloud", "Overcast"],
    [[45, 48], "fog", "Fog"], [[51, 53, 55, 56, 57], "drizzle", "Drizzle"],
    [[61, 63], "rain", "Rain"], [[65], "rain", "Heavy rain"],
    [[66, 67], "rain", "Freezing rain"], [[71, 73, 75, 77], "snow", "Snow"],
    [[80, 81], "showers", "Showers"], [[82], "showers", "Heavy showers"],
    [[85, 86], "snow", "Snow showers"], [[95], "thunder", "Thunderstorm"],
    [[96, 99], "thunder", "Thunderstorm, hail"]
];

/** \return {kind, label}, or null when code is not a number */
CsWeather.describeCode = function(code) {
    if (typeof code !== "number" || code !== code) { return null; }
    for (var i = 0; i < CsWeather.CODES.length; i++) {
        var row = CsWeather.CODES[i];
        for (var k = 0; k < row[0].length; k++) {
            if (row[0][k] === code) { return { kind: row[1], label: row[2] }; }
        }
    }
    return { kind: "cloud", label: "Cloudy" };
};

/** For a day with no code: a wet-looking day still gets a rain icon. */
CsWeather.fallbackKind = function(day) {
    if ((typeof day.rainChance === "number" && day.rainChance >= 50) ||
            (typeof day.rainTotal === "number" && day.rainTotal >= 0.25)) {
        return { kind: "rain", label: "Rain likely" };
    }
    return null;
};

/**
 * GET a URL and return {text, error}. Blocking, 5 s, never throws.
 * Written to a temp file and read back: the bridge stringifies process
 * output as "QByteArray [JS]" (see CsSurfaceData.fetch).
 */
CsWeather.fetchText = function(url) {
    var path = QDir.tempPath() + "/cavecad-weather.json";
    try {
        if (new QFileInfo(path).exists()) { QFile.remove(path); }
        var process = new QProcess();
        process.start("/usr/bin/curl", ["-s", "--fail", "--max-time",
            String(CsWeather.TIMEOUT_S), "-o", path, url]);
        if (!process.waitForFinished((CsWeather.TIMEOUT_S + 3) * 1000)) {
            var never = process.state() === QProcess.NotRunning;
            process.kill();
            QFile.remove(path);
            return { text: "", error: never ? "curl could not be started" : "timed out" };
        }
        if (process.exitCode() !== 0) {
            QFile.remove(path);
            return { text: "", error: "no answer from the forecast service" };
        }
        var file = new QFile(path);
        if (!file.open(QIODevice.ReadOnly | QIODevice.Text)) {
            return { text: "", error: "forecast file could not be read" };
        }
        var stream = new QTextStream(file);
        var text = String(stream.readAll());
        file.close();
        QFile.remove(path);
        return { text: text, error: "" };
    } catch (e) {
        return { text: "", error: "forecast lookup failed (" + e + ")" };
    }
};

/**
 * The forecast for the trip's dates.
 * \param dates ["YYYY-MM-DD", ...] first to last
 * \param anchor {lat, lon} of the drawing's geo anchor, or null
 * \param place typed place name, or "" (a typed place wins over the anchor)
 * \param fetcher optional replacement for fetchText, for tests
 * \return {days: [...] | null, error: ""|reason}. Never throws.
 */
CsWeather.lookup = function(dates, anchor, place, fetcher) {
    var get = fetcher || CsWeather.fetchText;
    if (dates.length === 0) { return { days: null, error: "no trip dates" }; }
    var lat = null, lon = null;
    if (place !== "") {
        var g = get(CsWeather.geocodeUrl(place));
        if (g.error !== "") { return { days: null, error: g.error }; }
        var where = CsWeather.parseGeocode(g.text);
        if (where === null) { return { days: null, error: "place not found" }; }
        lat = where.lat; lon = where.lon;
    } else if (anchor !== null && anchor !== undefined) {
        lat = anchor.lat; lon = anchor.lon;
    } else {
        return { days: null, error: "no location" };
    }
    var r = get(CsWeather.forecastUrl(lat, lon, dates[0], dates[dates.length - 1]));
    if (r.error !== "") { return { days: null, error: r.error }; }
    var days = CsWeather.parseForecast(r.text);
    if (days === null) { return { days: null, error: "forecast could not be read" }; }
    return { days: days, error: "" };
};
