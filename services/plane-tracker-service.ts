import {DatabaseService} from "./database-service";
import {Client} from "pg";
import axios from "axios";
import {SettingsService} from "./settings-service";
import {EmailService} from "./email-service";
import {NotableAircraft, Plane} from "../models";

export class PlaneTrackerService {
    client: Client;
    notableAircraft: NotableAircraft = new NotableAircraft();
    newPlanes: boolean = false;

    constructor(private dbService: DatabaseService,
                private settingsService: SettingsService,
                private emailService: EmailService) {
        this.client = dbService.client;
    }

    async startTracker() {
        await this.dbService.checkTables();
        await this.getSunriseSunset();
        this.notableAircraft = await this.dbService.getNotableAircraft();

        this.settingsService.setRequestCount(await this.dbService.getRequestCount());
        let messageText = `${new Date()}\n\nPlane Tracker is running. ${this.settingsService.requestCount} requests remaining.`
        await this.emailService.sendEmail('Plane Tracker is running', messageText);

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

        if (this.settingsService.checkRequests()) {
            await this.dbService.logFrequency();
        }

        if (this.checkIsDaylight() && this.settingsService.requestCount > 5) {
            const planes = await this.getAircraft();
            for (let p of planes) {
                if (!p.reg || p.reg === '' || p.gnd === '1') {
                    continue;
                }
                const notable = this.isNotable(p);
                const recentlySeen = await this.dbService.logPlane(p, notable);
                if (notable) {
                    if (!recentlySeen) {
                        this.newPlanes = true;
                        messageText += `${p.type} ${p.reg} spotted ${p.dst} miles away\n`;
                    }
                }
            }
            await this.dbService.updateFlags(planes);

            if (this.newPlanes) {
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
            result = request.data?.ac;
        } catch (err) {
            if (err instanceof Error) {
                await this.dbService.logError('getAircraft', err.message);
            }
        }

        return result;
    }

    isNotable(plane: Plane): boolean {
        return this.notableAircraft.typeCodes.includes(plane.type) ||
            this.notableAircraft.regNumbers.includes(plane.reg);
    }

    checkIsDaylight() {
        const now = new Date();
        return now > this.settingsService.sunrise && now < this.settingsService.sunset;
    }

    async updateSunriseSunset() {
        if (new Date().getDate() !== this.settingsService.currentDay || this.settingsService.setByFallback) {
            this.settingsService.updateCurrentDay();
            await this.healthCheck();
            await this.getSunriseSunset();
        }
    }

    async healthCheck() {
        const lastModified = await this.dbService.healthCheck();

        if (lastModified < new Date(Date.now() - 86400000)) {
            await this.dbService.logWarning('health_check', 'No updates in 24 hours');
            await this.emailService.sendEmail('Plane Tracker is not responding', 'No new updates in 24 hours.')
        }
    }
}