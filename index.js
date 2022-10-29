const express = require('express');
const axios = require("axios");
const nodemailer = require("nodemailer");
const {Client} = require("pg");
require('dotenv').config();

const client = new Client({
    user: process.env.DBLOGIN,
    host: process.env.DBHOST,
    database: process.env.DBNAME,
    password: process.env.DBPASS,
    port: process.env.DBPORT,
})
client.connect()

async function getRequestCount() {
    const requestCountQuery = {
        text: `SELECT "int_value" FROM "options" WHERE "type" = 'request_count'`
    }

    const result = await client.query(requestCountQuery);
    return result.rows[0].int_value;
}

async function setRequestCount(value) {
    const resetRequestCountQuery = {
        text: `UPDATE "options" SET "int_value" = $1 WHERE "type" = 'request_count'`,
        values: [value]
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

const app = express();
const port = 3000;
let frequency = 5 * 60000; // 5 minutes

const lat = process.env.LAT;
const lon = process.env.LON;

let currentDay = new Date().getDate();

let sunrise = new Date();
let sunset = new Date();

let recentlySeen = [];

app.get('/', (req, res) => {
    res.send(recentlySeen);
})

app.listen(port, async function() {
    await getSunriseSunset();
    await updateSunriseSunset();
    await tryStartup();
})

setInterval(async () =>{
    await checkLocalTraffic();
}, frequency);

function sendEmail(subject, text) {
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
    smtpTransport.sendMail(mailOptions, function(error, response){
        if (error) {
            console.log(error);
        }
    });
}

async function tryStartup() {
    let requests = 0;
    let messageText;

    try {
        requests = await getRequestCount();
        messageText = `${new Date()}\n\nplane-tracker is running. ${getRequestCount()} requests remaining.`
        sendEmail('plane-checker is running', messageText);
    } catch {
        messageText = 'Database connection failed.'
        sendEmail('plane-checker startup failed', messageText);
    }
}

async function getAircraft() {
    const options = {
        method: 'GET',
        url: `https://adsbx-flight-sim-traffic.p.rapidapi.com/api/aircraft/json/lat/${lat}/lon/${lon}/dist/25/`,
        headers: {
            'X-RapidAPI-Key': process.env.KEY,
            'X-RapidAPI-Host': 'adsbx-flight-sim-traffic.p.rapidapi.com'
        }
    };

    const result = await axios.request(options);
    const requestCount = result.headers['x-ratelimit-requests-remaining'];
    await setRequestCount(requestCount);
    return result.data?.ac;
}

async function checkLocalTraffic() {
    let planes = [];
    let messageText;
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
        planes.forEach(p => {
            if (typeCodes.includes(p.type)) {
                if (!isInRecentlySeen(p.reg)) {
                    newPlanes = true;
                    messageText += `${p.type} ${p.reg} spotted ${p.dst} miles away\n`;
                }
                addToRecentlySeen(p);
            }
        })
        cleanupRecentlySeen(planes);

        if (newPlanes) {
            sendEmail('New  planes spotted', messageText);
        }
    }
}




async function updateSunriseSunset() {
    if (new Date().getDate() !== currentDay) {
        await getSunriseSunset();
    }
}

async function getSunriseSunset() {
    const options = {
        method: 'GET',
        url: `https://api.sunrise-sunset.org/json?lat=${lat}&lng=${lon}&date=today&formatted=0`
    }
    const request = await axios.request(options);
    const result = request['data']['results'];

    sunrise = new Date(result['sunrise'])
    sunset = new Date(result['sunset'])
}

function checkIsDaylight() {
    const now = new Date();
    return now > sunrise && now < sunset;
}



function isInRecentlySeen(reg) {
    return recentlySeen.filter(r => r.reg === reg).length > 0;
}

function addToRecentlySeen(plane) {
    recentlySeen.push({
        reg: plane.reg,
        plane: plane
    })
}

function cleanupRecentlySeen(planes) {
    const regNums = planes.map(p => p.reg);
    recentlySeen.forEach((s, i) => {
        if (!regNums.includes(s.reg)) {
            recentlySeen.splice(i, 1);
        }
    })
}