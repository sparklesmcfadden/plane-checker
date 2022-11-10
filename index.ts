import axios from "axios";
import nodemailer from "nodemailer";
import {Client} from "pg";
import { config } from 'dotenv';
config();

const client = new Client({
    user: process.env.DBLOGIN,
    host: process.env.DBHOST,
    database: process.env.DBNAME,
    password: process.env.DBPASS,
    port: Number(process.env.DBPORT),
})

type Plane = {
    posttime: number;
    icao: string;
    reg: string;
    type: string;
    wtc: number
    spd: number;
    altt: number;
    alt: number;
    galt: number;
    talt: number;
    lat: number;
    lon: number;
    vsit: number;
    vsi: number;
    trkh: number;
    ttrk: number;
    trak: number;
    sqk: number;
    call: string;
    gnd: number;
    trt: number;
    pos: number;
    mlat: number;
    tisb: number;
    sat: number;
    opicao: string;
    cou: string;
    mil: number;
    interested: number;
    dst: number;
};

async function getRequestCount() {
    const requestCountQuery = {
        text: `SELECT "int_value" FROM "options" WHERE "type" = 'request_count'`
    }

    const result = await client.query(requestCountQuery);
    return result.rows[0].int_value;
}

async function setRequestCount(value: string) {
    const resetRequestCountQuery = {
        text: `UPDATE "options" SET "int_value" = $1, "date_value" = $2 WHERE "type" = 'request_count'`,
        values: [value, new Date()]
    }

    await client.query(resetRequestCountQuery);
}

async function getTypeCodes() {
    const planesQuery = {
        text: `SELECT "str_value" FROM "options" WHERE "type" = 'type_code'`
    }

    const result = await client.query(planesQuery);
    return result.rows.map(r => r.str_value);
}

async function logPlane(plane: Plane) {
    const logQuery = {
        text: `INSERT INTO "options" ("type", "str_value", "date_value") VALUES ('plane', $1, $2)`,
        values: [JSON.stringify(plane), new Date()]
    }

    await client.query(logQuery);
}

async function logSunriseSunset() {
    const insertValue = JSON.stringify({
        sunrise: sunrise,
        sunset: sunset,
        day: currentDay
    })
    const logQuery = {
        text: `UPDATE "options" SET "str_value" = $1, "date_value" = $2 WHERE "type" = 'date_log'`,
        values: [insertValue, new Date()]
    }

    await client.query(logQuery);
}

async function logError(type: string, message: string) {
    const errQuery = {
        text: `INSERT INTO "options" ("type", "str_value", "date_value") VALUES ($1, $2, $3)`,
        values: [`error ${type}`, message, new Date()]
    };

    await client.query(errQuery);
}

async function cleanupLogs() {
    const cleanupQuery = {
        text: `DELETE FROM "options" WHERE "type" = 'plane' AND "date_value" < $1`,
        values: [new Date(new Date().getTime() - (24 * 60 * 60 * 1000))]
    }

    await client.query(cleanupQuery);
}

let frequency = 5 * 60000; // 5 minutes

const lat = process.env.LAT;
const lon = process.env.LON;

let currentDay = new Date().getDate();

let sunrise = new Date();
let sunset = new Date();
let setByFallback = false;

let recentlySeen: Array<{ reg: string, plane: Plane }> = [];

tryStartup().then(async () => {
    await checkLocalTraffic();
});

function sendEmail(subject: string, text: string) {
    const smtpTransport = nodemailer.createTransport({
        service: "Gmail",
        auth: {
            user: process.env.GMAILADDR,
            pass: process.env.GMAILPASS
        }
    });
    const mailOptions = {
        from: process.env.GMAILADDR,
        to: process.env.TARGETEMAIL,
        subject: subject,
        text: text
    };
    smtpTransport.sendMail(mailOptions, function (error) {
        if (error) {
            console.log(error);
        }
    });
}

async function tryStartup() {
    let requests = 0;
    let messageText;

    await client.connect();
    await getSunriseSunset();

    try {
        requests = await getRequestCount();
        messageText = `${new Date()}\n\nplane-tracker is running. ${requests} requests remaining.`
        sendEmail('plane-checker is running', messageText);
    } catch {
        messageText = 'Database connection failed.'
        await logError('tryStartup', messageText);
    }
}

async function getAircraft() {
    let result = [];
    const options = {
        method: 'GET',
        url: `https://adsbx-flight-sim-traffic.p.rapidapi.com/api/aircraft/json/lat/${lat}/lon/${lon}/dist/25/`,
        headers: {
            'X-RapidAPI-Key': process.env.KEY as string,
            'X-RapidAPI-Host': 'adsbx-flight-sim-traffic.p.rapidapi.com'
        }
    };

    try {
        const request = await axios.request(options);
        const requestCount = request.headers['x-ratelimit-requests-remaining'];
        await setRequestCount(requestCount);
        result = request.data?.ac;
    } catch (err) {
        console.log(err);
        if (err instanceof Error) {
            await logError('getAircraft', err.message);
        }
    }

    return result;
}

async function checkLocalTraffic() {
    let planes = [];
    let messageText = '';
    let newPlanes = false;

    const typeCodes = await getTypeCodes();
    const requestCount = await getRequestCount();
    if (requestCount <= 200) {
        frequency = 30 * 60000; // 30 minutes
    }
    if (requestCount <= 25) {
        frequency = 4 * 60 * 60000; // 4 hours
    }
    if (checkIsDaylight() && requestCount > 5) {
        planes = await getAircraft();
        for (let p of planes) {
            if (typeCodes.includes(p.type)) {
                await logPlane(p);
                if (!isInRecentlySeen(p.reg)) {
                    newPlanes = true;
                    messageText += `${p.type} ${p.reg} spotted ${p.dst} miles away\n`;
                }
                addToRecentlySeen(p);
            }
        }
        cleanupRecentlySeen(planes);

        if (newPlanes) {
            sendEmail('New  planes spotted', messageText);
        }
    }
    await cleanupLogs();

    setTimeout(async () => {
        await updateSunriseSunset();
        await checkLocalTraffic();
    }, frequency);
}

async function updateSunriseSunset() {
    if (new Date().getDate() !== currentDay || setByFallback) {
        currentDay = new Date().getDate();
        await getSunriseSunset();
    }
}

async function getSunriseSunset() {
    const options = {
        method: 'GET',
        url: `https://api.sunrise-sunset.org/json?lat=${lat}&lng=${lon}&date=today&formatted=0`
    }

    try {
        const request = await axios.request(options);
        const result = request['data']['results'];
        sunrise = new Date(result['sunrise'])
        sunset = new Date(result['sunset'])
        setByFallback = false;
    } catch (err) {
        console.log(err);
        if (err instanceof Error) {
            await logError('getSunriseSunset', err.message);
        }
        sunset = new Date();
        sunset.setHours(20, 0, 0);
        sunrise = new Date();
        sunrise.setHours(9, 0, 0);
        setByFallback = true;
    }

    await logSunriseSunset();
}

function checkIsDaylight() {
    const now = new Date();
    return now > sunrise && now < sunset;
}

function isInRecentlySeen(reg: string) {
    return recentlySeen.filter(r => r.reg === reg).length > 0;
}

function addToRecentlySeen(plane: Plane) {
    recentlySeen.push({
        reg: plane.reg,
        plane: plane
    })
}

function cleanupRecentlySeen(planes: Plane[]) {
    const regNums = planes.map(p => p.reg);
    recentlySeen.forEach((s, i) => {
        if (!regNums.includes(s.reg)) {
            recentlySeen.splice(i, 1);
        }
    })
}