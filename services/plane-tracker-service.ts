import {DatabaseService} from "./database-service";
import {Client} from "pg";
import axios from "axios";
import {SettingsService} from "./settings-service";
import {EmailService} from "./email-service";
import {Plane} from "../models";
import {sleep} from "../index";

export class PlaneTrackerService {
    client: Client;
    newPlanes: boolean = false;
    getRetryCount = 0;
    isDay: boolean = true;

    constructor(private dbService: DatabaseService,
                private settingsService: SettingsService,
                private emailService: EmailService) {
        this.client = dbService.client;
    }

    async startTracker() {
        await this.dbService.checkTables();
        await this.getSunriseSunset();

        this.settingsService.setRequestCount(await this.dbService.getRequestCount());
        let messageText = `Plane Tracker is running. ${this.settingsService.requestCount} requests remaining.`
        await this.emailService.sendEmail('Plane Tracker is running', messageText);
        await this.dbService.logMessage('startTracker', messageText);

        await this.checkLocalTraffic();
    }

    async getSunriseSunset() {
        const options = {
            method: 'GET',
            url: `https://api.sunrise-sunset.org/json?lat=${this.settingsService.lat}&lng=${this.settingsService.lon}&date=today&formatted=0`
        }

        try {
            const request = await axios.request(options);
            const result = request['data']['results'];
            this.settingsService.setDay(new Date(result['sunrise']), new Date(result['sunset']))
        } catch (err) {
            if (err instanceof Error) {
                await this.dbService.logError('getSunriseSunset', err.message);
            }
            this.settingsService.setDefaultDay();
        }

        await this.dbService.logSunriseSunset();
    }

    async checkLocalTraffic() {
        let messageText = '';
        let flaggedCount = 0;

        if (this.settingsService.checkRequests()) {
            await this.dbService.logFrequency();
        }
        await this.updateNotables();
        const isDay = await this.checkIsDaylight();

        if (isDay && this.settingsService.requestCount > 5) {
            const planes = await this.getAircraft();
            for (let p of planes) {
                const notable = this.isNotableType(p);
                const isNew = await this.dbService.logPlane(p, notable);
                if (notable) {
                    if (isNew) {
                        flaggedCount++;
                        this.newPlanes = true;
                        messageText += `${p.type} ${p.reg} spotted ${p.dst} miles away\n`;
                    }
                }
            }
            await this.dbService.updateFlags(planes);

            if (this.newPlanes) {
                await this.dbService.logMessage('checkLocalTraffic', `Flagged ${flaggedCount} new aircraft`);
                await this.emailService.sendEmail('New  planes spotted', messageText);
                this.newPlanes = false;
            }
        }

        setTimeout(async () => {
            await this.updateSunriseSunset();
            await this.checkLocalTraffic();
        }, this.settingsService.frequency);
    }

    async getAircraft() {
        let result = [];
        const options = {
            method: 'GET',
            url: `https://adsbx-flight-sim-traffic.p.rapidapi.com/api/aircraft/json/lat/${this.settingsService.lat}/lon/${this.settingsService.lon}/dist/25/`,
            headers: {
                'X-RapidAPI-Key': process.env.KEY as string,
                'X-RapidAPI-Host': 'adsbx-flight-sim-traffic.p.rapidapi.com'
            }
        };

        try {
            const request = await axios.request(options);
            const requestCount = request.headers['x-ratelimit-requests-remaining'];
            await this.dbService.setRequestCount(requestCount);
            result = request.data?.ac.filter((p: Plane) => p.reg && p.reg !== '' && p.gnd !== '1');
        } catch (err) {
            if (err instanceof Error) {
                await this.dbService.logError('getAircraft', err.message);
            }
            if (this.getRetryCount < 10) {
                this.getRetryCount++;
                await this.dbService.logWarning('getAircraft', `Retrying. Attempt ${this.getRetryCount}.`)
                await sleep(2);
                await this.getAircraft();
            } else {
                await this.dbService.logError('getAircraft', 'getAircraft failed after 10 retries. Restarting.');
                await this.startTracker();
            }
        }

        await this.dbService.logMessage('getAircraft', `Success. Retrieved ${result.length} records.`)
        this.getRetryCount = 0;
        return result;
    }

    isNotableType(plane: Plane): boolean {
        return this.settingsService.notableAircraft.typeCodes.includes(plane.type);
    }

    async checkIsDaylight() {
        const now = new Date();
        const isDay = now > this.settingsService.sunrise && now < this.settingsService.sunset;
        if (isDay !== this.isDay) {
            if (!isDay) {
                await this.dbService.updateFlags([]);
            }
            const message = `Daylight status changed. ${isDay ? 'Now checking traffic.' : 'Shutting down for the night.'}`
            await this.dbService.logMessage('checkIsDaylight', message)
            this.isDay = isDay;
        }
        return isDay;
    }

    async updateSunriseSunset() {
        if (new Date().getDate() !== this.settingsService.currentDay || this.settingsService.setByFallback) {
            this.settingsService.updateCurrentDay();
            await this.getSunriseSunset();
        }
    }

    async updateNotables() {
        const notables = await this.dbService.getNotableAircraft();
        this.settingsService.updateNotables(notables);
        await this.dbService.logMessage('updateNotables', `Loaded ${notables.regNumbers.length + notables.typeCodes.length} notable types or reg nums`);
    }
}