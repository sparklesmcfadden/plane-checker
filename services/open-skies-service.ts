import {DatabaseService} from "./database-service";
import {SettingsService} from "./settings-service";
import axios, {AxiosRequestConfig} from "axios";
import {OpenSkiesState, OpenSkiesStateResponse, OpenSkiesTrackResponse, Plane} from "../models";
import {EmailService} from "./email-service";

// 0 time integer Time which the given waypoint is associated with in seconds since epoch (Unix time).
// 1 latitude float WGS-84 latitude in decimal degrees. Can be null.
// 2 longitude float WGS-84 longitude in decimal degrees. Can be null.
// 3 baro_altitude float Barometric altitude in meters. Can be null.
// 4 true_track float True track in decimal degrees clockwise from north (north=0°). Can be null.
// 5 on_ground boolean Boolean value which indicates if the position was retrieved from a surface position report.


export class OpenSkiesService {
    nextCheckTime: Date;
    isDay: boolean = true;

    constructor(private dbService: DatabaseService,
                private emailService: EmailService,
                private settingsService: SettingsService) {
        this.nextCheckTime = new Date(new Date().getTime() + this.settingsService.interval);
    }

    mapState(result: any): OpenSkiesStateResponse {
        const stateOjb: OpenSkiesStateResponse = {
            responseCode: result.responseCode,
            time: result.time,
            states: []
        };

        result.states?.forEach((stateArray: any[]) => {
            stateOjb.states.push({
                icao24: stateArray[0].toUpperCase(),
                callsign: stateArray[1],
                origin_country: stateArray[2],
                time_position: stateArray[3],
                last_contact: stateArray[4],
                longitude: stateArray[5],
                latitude: stateArray[6],
                baro_altitude: stateArray[7],
                on_ground: stateArray[8],
                velocity: stateArray[9],
                true_track: stateArray[10],
                vertical_rate: stateArray[11],
                sensors: stateArray[12],
                geo_altitude: stateArray[13],
                squawk: stateArray[14],
                spi: stateArray[15],
                position_source: stateArray[16]
            });
        });

        return stateOjb;
    }

    mapStateToPlane(state: OpenSkiesState, reg: string, type: string): Plane {
        return {
            posttime: state.time_position.toString(),
            icao: state.icao24,
            reg: reg,
            type: type,
            spd: state.velocity.toString(),
            alt: state.baro_altitude.toString(),
            lat: state.latitude.toString(),
            lon: state.longitude.toString(),
            trak: state.true_track.toString(),
            call: state.callsign,
            dst: "-1"
        };
    }

    async getStatesByHex() {
        const isDay = await this.checkIsDaylight();
        if (!isDay) {
            return;
        }

        let messageText = '';
        let flaggedCount = 0;
        let isNew = false;

        const hexCodes = this.settingsService.notableAircraft.aircraft.map(a => a.hexCode.toLowerCase()).join('&icao24=');
        const options = {
            method: 'GET',
            url: `https://opensky-network.org/api/states/all?icao24=${hexCodes}`,
            authorization: {
                username: process.env.OSNUSER,
                password: process.env.OSNPASS
            }
        }
        const result = this.mapState(await this.getAsync(options));
        if (result.states) {
            for (let state of result.states) {
                const reg = this.settingsService.notableAircraft.aircraft.find(s => s.hexCode === state.icao24)?.regNumber!;
                const type = await this.dbService.getTypeFromHex(state.icao24) || 'Unknown';
                const plane = this.mapStateToPlane(state, reg, type);
                isNew = await this.dbService.logPlane(plane, true);
                if (!state.on_ground) {
                    flaggedCount++;
                    const location = await this.reverseGeocode(state.latitude, state.longitude);
                    messageText += `${type} ${reg} located near ${location}`;
                }
            }

            if (flaggedCount > 0) {
                await this.dbService.logMessage('checkLocalTraffic', `Flagged ${flaggedCount} new aircraft`);
                if (isNew) {
                    await this.emailService.sendEmail('New  planes being tracked', messageText);
                }
            }
            this.nextCheckTime = new Date(new Date().getTime() + this.settingsService.frequency);
        }
    }

    async getTrackByHex(hexCode: string) {
        const options = {
            method: 'GET',
            url: `https://opensky-network.org/api/tracks/all?icao24=${hexCode.toLowerCase()}&time=0`,
            authorization: {
                username: process.env.OSNUSER,
                password: process.env.OSNPASS
            }
        }
        const result: OpenSkiesTrackResponse = await this.getAsync(options);
        if (result.responseCode !== 0) {
            if (result.responseCode === 1) {
                // plane is not in the air
            }

        }
    }

    async reverseGeocode(lat: number, lon: number) {
        const options = {
            method: 'GET',
            url: `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/reverseGeocode?f=pjson&featureTypes=&location=${lon},${lat}`
        }
        try {
            const request = await axios.request(options);
            if (request.status === 200) {
                const result = request.data;
                return `${result.address.City}, ${result.address.Region}, ${result.address.CountryCode}`;
            } else {
                return `${lat}, ${lon}`;
            }
        } catch (err) {
            if (err instanceof Error) {
                await this.dbService.logError('openSkies_reverseGeocode', err.message);
            }
            return `${lat}, ${lon}`;
        }
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

    async getAsync(options: AxiosRequestConfig) {
        let result;
        try {
            const request = await axios.request(options);
            if (request.status === 200) {
                result = request.data;
                return result;
            } else if (request.status === 404) {
                result = { responseCode: 1 };
                return result;
            } else if (request.status === 429) {
                const timeToAvailable = request.headers['X-Rate-Limit-Retry-After-Seconds']; // this will become the new interval
                this.settingsService.setInterval(+timeToAvailable);
            } else {
                await this.dbService.logWarning('openSkies_getAsync', `Request returned ${request.status}`);
            }
            result = { responseCode: 0 };
            return result;
        } catch (err) {
            if (err instanceof Error) {
                await this.dbService.logError('openSkies_getAsync', err.message);
            }
            result = { responseCode: 0 };
            return result;
        }
    }
}