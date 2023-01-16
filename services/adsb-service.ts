import {DatabaseService} from "./database-service";
import axios from "axios";
import {Plane} from "../models";
import {sleep} from "../index";
import {SettingsService} from "./settings-service";
import {EmailService} from "./email-service";

export class AdsbService {
    getRetryCount: number = 0;
    nextCheckTime: Date;
    newPlanes: boolean = false;
    isDay: boolean = true;

    constructor(private dbService: DatabaseService,
                private emailService: EmailService,
                private settingsService: SettingsService) {
        this.nextCheckTime = new Date(new Date().getTime() + this.settingsService.frequency);
    }

    async checkLocalAdsbTraffic() {
        let messageText = '';
        let flaggedCount = 0;

        if (this.settingsService.checkRequests()) {
            await this.dbService.logFrequency(this.settingsService.frequency);
        }
        const isDay = await this.checkIsDaylight();

        if (isDay && this.settingsService.requestCount > 5 && new Date() > this.nextCheckTime) {
            const planes = await this.getAircraft();
            for (let p of planes) {
                p.type = await this.dbService.getTypeFromTailNumber(p.reg) || p.type;
                const notable = this.isNotable(p);
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
            this.nextCheckTime = new Date(new Date().getTime() + this.settingsService.frequency);
        }
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
                await this.dbService.logError('getAircraft', 'getAircraft failed after 10 retries.');
                throw err;
            }
        }

        await this.dbService.logMessage('getAircraft', `Success. Retrieved ${result.length} records.`)
        this.getRetryCount = 0;
        return result;
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

    isNotable(plane: Plane): boolean {
        return this.settingsService.notableAircraft.typeCodes.includes(plane.type) ||
            this.settingsService.notableAircraft.aircraft.map(s => s.regNumber).includes(plane.reg);
    }
}